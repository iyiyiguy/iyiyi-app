import AVFoundation
import CoreGraphics
import ExpoCamera
import Foundation
import QuartzCore
import UIKit

// Real-time people tracking for Laser Tag's target brackets and aim assist.
//
// Same attach pattern as LiveFaceTracker: an AVCaptureMetadataOutput on the session behind the
// on-screen camera preview (expo-camera's CameraView, or the dual-camera view's back layer).
// AVFoundation runs Apple's own person detectors on every camera frame (no photos, no pixel
// buffers through JS) and gives each person a stable bodyID:
//   .humanBody      head + upper body (iOS 13+)
//   .humanFullBody  whole person (iOS 17+)
//   .face           faces, used as the head zone of the matching body
// Emits "onLiveBodies" at <= 15/s:
//   { bodies: [{ id, x, y, w, h, head?: { x, y, w, h }, conf, kind }], layerW, layerH }
// x/y/w/h are normalized 0..1 of the preview layer (top-left origin, aspect-fill and mirroring
// already applied by transformedMetadataObject), so they line up with the preview on screen.
// kind: "full" | "upper" | "face" (a face with no body around it: a person standing very close).
// An empty list is sent once when everyone leaves the view.
final class LiveBodyTracker: NSObject, AVCaptureMetadataOutputObjectsDelegate {
  private let emit: ([String: Any]) -> Void
  private weak var previewLayer: AVCaptureVideoPreviewLayer?
  private weak var session: AVCaptureSession?
  private var output: AVCaptureMetadataOutput?
  private var usable = false
  private var lastEmptySent = false
  private var lastSent: CFTimeInterval = 0
  private static let minInterval: CFTimeInterval = 1.0 / 15.0

  init(emit: @escaping ([String: Any]) -> Void) {
    self.emit = emit
  }

  // The detector types this output supports, in the order we want them.
  static func wantedTypes(_ available: [AVMetadataObject.ObjectType]) -> [AVMetadataObject.ObjectType] {
    var wanted: [AVMetadataObject.ObjectType] = [.humanBody, .face]
    if #available(iOS 17.0, *) {
      wanted.append(.humanFullBody)
    }
    return wanted.filter { available.contains($0) }
  }

  // Main thread. Resolves true when people tracking is running on the visible preview.
  // Safe to call repeatedly: on the same session it only re-attaches the delegate.
  func start(completion: @escaping (Bool) -> Void) {
    guard let layer = LiveFaceTracker.findPreviewLayer(), let session = layer.session else {
      completion(false)
      return
    }
    previewLayer = layer
    if let out = output, self.session === session, session.outputs.contains(out) {
      if usable {
        out.setMetadataObjectsDelegate(self, queue: DispatchQueue.main)
      }
      completion(usable)
      return
    }
    let queue = (layer.delegate as? CameraView)?.sessionQueue ?? DispatchQueue.main
    queue.async { [weak self] in
      guard let self = self else { return }
      var ok = false
      var attached: AVCaptureMetadataOutput?
      let failure = BHTry.run {
        guard session.isRunning, !session.isInterrupted else { return }
        let out = AVCaptureMetadataOutput()
        guard session.canAddOutput(out) else { return }
        session.addOutput(out)
        attached = out
        let types = LiveBodyTracker.wantedTypes(out.availableMetadataObjectTypes)
        guard types.contains(.humanBody) || types.count > 1 else { return }
        out.metadataObjectTypes = types
        ok = true
      }
      DispatchQueue.main.async {
        if let out = attached {
          self.output?.setMetadataObjectsDelegate(nil, queue: nil)
          self.output = out // remembered even if unusable, so we never stack outputs
          self.session = session
          self.usable = ok && failure == nil
          if self.usable {
            out.setMetadataObjectsDelegate(self, queue: DispatchQueue.main)
            self.lastEmptySent = false
          }
        }
        completion(ok && failure == nil)
      }
    }
  }

  // Detaches the delegate; the output stays on the session (it dies with it) so a later
  // start() on the same session re-uses it.
  func stop() {
    output?.setMetadataObjectsDelegate(nil, queue: nil)
    previewLayer = nil
  }

  private struct Det {
    let id: Int
    var rect: CGRect
    let kind: String
    var head: CGRect?
  }

  func metadataOutput(_ output: AVCaptureMetadataOutput, didOutput metadataObjects: [AVMetadataObject], from connection: AVCaptureConnection) {
    guard let layer = previewLayer else { return }
    let lw = layer.bounds.width
    let lh = layer.bounds.height
    guard lw > 1, lh > 1 else { return }
    let now = CACurrentMediaTime()

    var full: [Det] = []
    var upper: [Det] = []
    var faces: [(id: Int, rect: CGRect)] = []
    for obj in metadataObjects {
      guard let t = layer.transformedMetadataObject(for: obj) else { continue }
      let b = t.bounds
      guard b.minX.isFinite, b.minY.isFinite, b.width.isFinite, b.height.isFinite, b.width > 2, b.height > 2 else { continue }
      let r = CGRect(x: b.minX / lw, y: b.minY / lh, width: b.width / lw, height: b.height / lh)
      if obj.type == .face {
        let fid = (obj as? AVMetadataFaceObject)?.faceID ?? -1
        faces.append((id: fid, rect: r))
        continue
      }
      var id = -1
      if let body = obj as? AVMetadataBodyObject {
        id = body.bodyID
      }
      var isFull = false
      if #available(iOS 17.0, *) {
        isFull = obj.type == .humanFullBody
      }
      if isFull {
        full.append(Det(id: id, rect: r, kind: "full", head: nil))
      } else if obj.type == .humanBody {
        upper.append(Det(id: id, rect: r, kind: "upper", head: nil))
      }
    }

    // One box per person: a full-body box replaces the upper-body box inside it.
    var people = full
    for u in upper {
      let covered = full.contains { f in
        BodyDetector.iou(f.rect, u.rect) > 0.25 || (f.rect.contains(CGPoint(x: u.rect.midX, y: u.rect.midY)) && u.rect.minY < f.rect.minY + f.rect.height * 0.5)
      }
      if !covered {
        // Upper-body ids live in their own range so they never collide with full-body ids.
        people.append(Det(id: u.id >= 0 ? u.id + 100_000 : -1, rect: u.rect, kind: "upper", head: nil))
      }
    }

    // Heads: the biggest face whose centre sits in the top part of the person's box.
    var usedFaces = Set<Int>()
    for i in 0..<people.count {
      let p = people[i].rect
      let band = people[i].kind == "full" ? 0.4 : 0.65
      var best: Int? = nil
      var bestArea: CGFloat = 0
      for (j, f) in faces.enumerated() where !usedFaces.contains(j) {
        let c = CGPoint(x: f.rect.midX, y: f.rect.midY)
        guard c.x >= p.minX, c.x <= p.maxX, c.y >= p.minY - p.height * 0.05, c.y <= p.minY + p.height * CGFloat(band) else { continue }
        let area = f.rect.width * f.rect.height
        if area > bestArea {
          bestArea = area
          best = j
        }
      }
      if let j = best {
        usedFaces.insert(j)
        people[i].head = faces[j].rect
        // The face can stick out of a loose body box: keep the head inside the person.
        people[i].rect = people[i].rect.union(faces[j].rect)
      }
    }

    // A face with no body around it (someone right in front of the camera): a body box
    // estimated from the face.
    for (j, f) in faces.enumerated() where !usedFaces.contains(j) {
      let r = f.rect
      let body = CGRect(x: r.minX - r.width * 0.9, y: r.minY - r.height * 0.15, width: r.width * 2.8, height: r.height * 7.5)
      people.append(Det(id: f.id >= 0 ? f.id + 1_000_000 : -1, rect: body, kind: "face", head: r))
    }

    if people.isEmpty {
      if lastEmptySent { return }
      lastEmptySent = true
    } else {
      lastEmptySent = false
      if now - lastSent < LiveBodyTracker.minInterval { return }
    }
    lastSent = now

    let unit = CGRect(x: 0, y: 0, width: 1, height: 1)
    func norm(_ r: CGRect) -> [String: Double]? {
      let c = r.intersection(unit)
      if c.isNull || c.width <= 0.002 || c.height <= 0.002 { return nil }
      return ["x": Double(c.minX), "y": Double(c.minY), "w": Double(c.width), "h": Double(c.height)]
    }
    var list: [[String: Any]] = []
    for p in people.prefix(8) {
      guard let box = norm(p.rect) else { continue }
      var item: [String: Any] = [
        "id": p.id,
        "x": box["x"] ?? 0,
        "y": box["y"] ?? 0,
        "w": box["w"] ?? 0,
        "h": box["h"] ?? 0,
        "conf": p.kind == "face" ? 0.6 : 0.9,
        "kind": p.kind,
      ]
      if let h = p.head, let hn = norm(h) {
        item["head"] = hn
      }
      list.append(item)
    }
    emit([
      "bodies": list,
      "layerW": Double(lw),
      "layerH": Double(lh),
    ])
  }
}
