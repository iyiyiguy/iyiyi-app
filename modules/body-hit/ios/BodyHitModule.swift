import CoreGraphics
import ExpoModulesCore
import Foundation
import ImageIO
import Vision

// Detects people in a still photo with Apple Vision for Laser Tag hit tests.
//
// JS: detectBodies(uri: string, deleteAfter: boolean) -> Promise<Body[]>
// Body = {
//   box:   { x, y, w, h }      whole person, normalized 0..1, TOP-LEFT origin
//   head:  { x, y, w, h }?     from nose/eyes/ears (+ neck for scale), padded
//   torso: { x, y, w, h }?     from shoulders/hips/neck/root, padded
//   joints: { name: { x, y } } normalized, top-left origin
//   confidence, source: "pose" | "rect", imageWidth, imageHeight
// }
// Coordinates are for the upright image (EXIF orientation is applied while
// decoding), so they match what the user saw in the portrait camera preview.
public class BodyHitModule: Module {
  public func definition() -> ModuleDefinition {
    Name("BodyHit")

    AsyncFunction("detectBodies") { (uri: String, deleteAfter: Bool, promise: Promise) in
      DispatchQueue.global(qos: .userInitiated).async {
        let url = BodyDetector.fileURL(from: uri)
        let bodies = BodyDetector.detect(url: url)
        if deleteAfter, let fileUrl = url, fileUrl.isFileURL {
          try? FileManager.default.removeItem(at: fileUrl)
        }
        promise.resolve(bodies)
      }
    }

    // JS: detectFaces(uri: string, deleteAfter: boolean) -> Promise<Face[]>
    // Face = {
    //   box: { x, y, w, h }        normalized 0..1, TOP-LEFT origin, upright image
    //   roll?, yaw?, pitch?        radians (Vision; pitch needs iOS 15 / revision 3)
    //   landmarks?: { nose?, leftEye?, rightEye? }  centroids, normalized, top-left origin
    //   confidence, imageWidth, imageHeight
    // }
    AsyncFunction("detectFaces") { (uri: String, deleteAfter: Bool, promise: Promise) in
      DispatchQueue.global(qos: .userInitiated).async {
        let url = BodyDetector.fileURL(from: uri)
        let faces = FaceDetector.detect(url: url)
        if deleteAfter, let fileUrl = url, fileUrl.isFileURL {
          try? FileManager.default.removeItem(at: fileUrl)
        }
        promise.resolve(faces)
      }
    }
  }
}

// Fast face boxes + head angles for the camera's AR filters. Decodes a small upright thumbnail
// (EXIF orientation applied, like BodyDetector), so coordinates match the unmirrored photo;
// the JS side mirrors them for the front-camera preview.
enum FaceDetector {
  static let maxPixelSize: Int = 640

  static func detect(url: URL?) -> [[String: Any]] {
    guard let fileUrl = url, let source = CGImageSourceCreateWithURL(fileUrl as CFURL, nil) else {
      return []
    }
    let options: [CFString: Any] = [
      kCGImageSourceCreateThumbnailFromImageAlways: true,
      kCGImageSourceCreateThumbnailWithTransform: true,
      kCGImageSourceThumbnailMaxPixelSize: maxPixelSize,
    ]
    guard let image = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary) else {
      return []
    }
    let width = CGFloat(image.width)
    let height = CGFloat(image.height)
    if width < 1 || height < 1 {
      return []
    }

    let rectRequest = VNDetectFaceRectanglesRequest()
    if #available(iOS 15.0, *) {
      rectRequest.revision = VNDetectFaceRectanglesRequestRevision3
    }
    let handler = VNImageRequestHandler(cgImage: image, orientation: .up, options: [:])
    do {
      try handler.perform([rectRequest])
    } catch {
      return []
    }
    var faces: [VNFaceObservation] = []
    for case let face as VNFaceObservation in (rectRequest.results ?? []) {
      faces.append(face)
    }
    if faces.isEmpty {
      return []
    }

    // Landmarks for the faces just found (nose / eyes give a stable yaw and roll).
    var landmarked: [VNFaceObservation] = []
    let landmarksRequest = VNDetectFaceLandmarksRequest()
    landmarksRequest.inputFaceObservations = faces
    do {
      try handler.perform([landmarksRequest])
      for case let face as VNFaceObservation in (landmarksRequest.results ?? []) {
        landmarked.append(face)
      }
    } catch {
      landmarked = []
    }

    var output: [[String: Any]] = []
    for face in faces {
      let r = face.boundingBox
      var item: [String: Any] = [
        "box": [
          "x": Double(r.minX),
          "y": Double(1 - r.maxY),
          "w": Double(r.width),
          "h": Double(r.height),
        ],
        "confidence": Double(face.confidence),
        "imageWidth": Double(width),
        "imageHeight": Double(height),
      ]
      if let roll = face.roll {
        item["roll"] = roll.doubleValue
      }
      if let yaw = face.yaw {
        item["yaw"] = yaw.doubleValue
      }
      if #available(iOS 15.0, *) {
        if let pitch = face.pitch {
          item["pitch"] = pitch.doubleValue
        }
      }

      var best: VNFaceObservation? = nil
      var bestScore: CGFloat = 0.3
      for candidate in landmarked {
        let score = BodyDetector.iou(candidate.boundingBox, r)
        if score > bestScore {
          bestScore = score
          best = candidate
        }
      }
      if let match = best, let landmarks = match.landmarks {
        let box = match.boundingBox
        var points: [String: [String: Double]] = [:]
        if let p = centroid(landmarks.nose, box: box) {
          points["nose"] = p
        }
        if let p = centroid(landmarks.leftEye, box: box) {
          points["leftEye"] = p
        }
        if let p = centroid(landmarks.rightEye, box: box) {
          points["rightEye"] = p
        }
        if !points.isEmpty {
          item["landmarks"] = points
        }
      }
      output.append(item)
    }
    return output
  }

  // Centroid of a landmark region in whole-image coordinates (normalized, top-left origin).
  static func centroid(_ region: VNFaceLandmarkRegion2D?, box: CGRect) -> [String: Double]? {
    guard let region = region else {
      return nil
    }
    let points = region.normalizedPoints
    if points.isEmpty {
      return nil
    }
    var sx: CGFloat = 0
    var sy: CGFloat = 0
    for p in points {
      sx += p.x
      sy += p.y
    }
    let n = CGFloat(points.count)
    let x = box.minX + (sx / n) * box.width
    let y = box.minY + (sy / n) * box.height
    return ["x": Double(x), "y": Double(1 - y)]
  }
}

enum BodyDetector {
  static let minJointConfidence: Float = 0.25
  static let maxPixelSize: Int = 1024

  static let jointNames: [(String, VNHumanBodyPoseObservation.JointName)] = [
    ("nose", .nose), ("leftEye", .leftEye), ("rightEye", .rightEye), ("leftEar", .leftEar), ("rightEar", .rightEar),
    ("neck", .neck), ("leftShoulder", .leftShoulder), ("rightShoulder", .rightShoulder),
    ("leftElbow", .leftElbow), ("rightElbow", .rightElbow), ("leftWrist", .leftWrist), ("rightWrist", .rightWrist),
    ("root", .root), ("leftHip", .leftHip), ("rightHip", .rightHip),
    ("leftKnee", .leftKnee), ("rightKnee", .rightKnee), ("leftAnkle", .leftAnkle), ("rightAnkle", .rightAnkle),
  ]
  static let headJoints: Set<String> = ["nose", "leftEye", "rightEye", "leftEar", "rightEar"]
  static let torsoJoints: Set<String> = ["neck", "leftShoulder", "rightShoulder", "root", "leftHip", "rightHip"]

  static func fileURL(from uri: String) -> URL? {
    if uri.hasPrefix("/") {
      return URL(fileURLWithPath: uri)
    }
    return URL(string: uri)
  }

  // Decodes a downscaled, upright CGImage (EXIF orientation applied).
  static func loadUprightImage(url: URL) -> CGImage? {
    guard let source = CGImageSourceCreateWithURL(url as CFURL, nil) else {
      return nil
    }
    let options: [CFString: Any] = [
      kCGImageSourceCreateThumbnailFromImageAlways: true,
      kCGImageSourceCreateThumbnailWithTransform: true,
      kCGImageSourceThumbnailMaxPixelSize: maxPixelSize,
    ]
    return CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary)
  }

  static func detect(url: URL?) -> [[String: Any]] {
    guard let fileUrl = url, let image = loadUprightImage(url: fileUrl) else {
      return []
    }
    let width = CGFloat(image.width)
    let height = CGFloat(image.height)
    if width < 1 || height < 1 {
      return []
    }

    let poseRequest = VNDetectHumanBodyPoseRequest()
    let rectRequest = VNDetectHumanRectanglesRequest()
    if #available(iOS 15.0, *) {
      rectRequest.upperBodyOnly = false
    }
    let handler = VNImageRequestHandler(cgImage: image, orientation: .up, options: [:])
    do {
      try handler.perform([poseRequest, rectRequest])
    } catch {
      return []
    }

    var output: [[String: Any]] = []
    var poseBoxes: [CGRect] = []

    for case let observation as VNHumanBodyPoseObservation in (poseRequest.results ?? []) {
      guard let body = describePose(observation, width: width, height: height) else {
        continue
      }
      poseBoxes.append(body.box)
      output.append(body.dictionary(width: width, height: height))
    }

    // Fallback for partly visible people the pose model missed.
    for case let observation as VNHumanObservation in (rectRequest.results ?? []) {
      let box = toPixels(observation.boundingBox, width: width, height: height)
      if poseBoxes.contains(where: { iou($0, box) > 0.3 }) {
        continue
      }
      let body = BodyHitDetection(box: box, head: nil, torso: nil, joints: [:], confidence: Double(observation.confidence), source: "rect")
      output.append(body.dictionary(width: width, height: height))
    }
    return output
  }

  // Vision normalized rect (bottom-left origin) -> pixel rect (top-left origin).
  static func toPixels(_ r: CGRect, width: CGFloat, height: CGFloat) -> CGRect {
    return CGRect(x: r.minX * width, y: (1 - r.maxY) * height, width: r.width * width, height: r.height * height)
  }

  static func describePose(_ observation: VNHumanBodyPoseObservation, width: CGFloat, height: CGFloat) -> BodyHitDetection? {
    var joints: [String: CGPoint] = [:]
    for (name, joint) in jointNames {
      guard let point = try? observation.recognizedPoint(joint), point.confidence >= minJointConfidence else {
        continue
      }
      // Vision: normalized, bottom-left origin. Convert to pixels, top-left origin.
      joints[name] = CGPoint(x: point.location.x * width, y: (1 - point.location.y) * height)
    }
    if joints.count < 3 {
      return nil
    }

    let all = Array(joints.values)
    guard var box = boundingRect(all) else {
      return nil
    }
    let pad = max(box.width, box.height) * 0.08 + width * 0.01
    box = box.insetBy(dx: -pad, dy: -pad)

    // Head: from face joints; size from their spread or the neck distance.
    var head: CGRect? = nil
    let headPoints = joints.filter { headJoints.contains($0.key) }.map { $0.value }
    if let headBounds = boundingRect(headPoints) {
      let center = CGPoint(x: headBounds.midX, y: headBounds.midY)
      var size = max(headBounds.width, headBounds.height) * 1.8
      if let neck = joints["neck"] {
        size = max(size, hypot(neck.x - center.x, neck.y - center.y) * 1.3)
      }
      size = max(size, width * 0.035)
      let headRect = CGRect(x: center.x - size / 2, y: center.y - size * 0.6, width: size, height: size)
      head = headRect
      box = box.union(headRect)
    }

    // Torso: shoulders, hips, neck and root.
    var torso: CGRect? = nil
    let torsoPoints = joints.filter { torsoJoints.contains($0.key) }.map { $0.value }
    if torsoPoints.count >= 2, let torsoBounds = boundingRect(torsoPoints) {
      let tpad = max(torsoBounds.width * 0.15, width * 0.02)
      torso = torsoBounds.insetBy(dx: -tpad, dy: -tpad)
    }

    return BodyHitDetection(box: box, head: head, torso: torso, joints: joints, confidence: Double(observation.confidence), source: "pose")
  }

  static func boundingRect(_ points: [CGPoint]) -> CGRect? {
    guard let first = points.first else {
      return nil
    }
    var minX = first.x
    var maxX = first.x
    var minY = first.y
    var maxY = first.y
    for p in points {
      minX = min(minX, p.x)
      maxX = max(maxX, p.x)
      minY = min(minY, p.y)
      maxY = max(maxY, p.y)
    }
    return CGRect(x: minX, y: minY, width: maxX - minX, height: maxY - minY)
  }

  static func iou(_ a: CGRect, _ b: CGRect) -> CGFloat {
    let inter = a.intersection(b)
    if inter.isNull || inter.isEmpty {
      return 0
    }
    let interArea = inter.width * inter.height
    let unionArea = a.width * a.height + b.width * b.height - interArea
    return unionArea > 0 ? interArea / unionArea : 0
  }
}

struct BodyHitDetection {
  let box: CGRect
  let head: CGRect?
  let torso: CGRect?
  let joints: [String: CGPoint]
  let confidence: Double
  let source: String

  func dictionary(width: CGFloat, height: CGFloat) -> [String: Any] {
    func norm(_ r: CGRect) -> [String: Double] {
      let clipped = r.intersection(CGRect(x: 0, y: 0, width: width, height: height))
      let rect = clipped.isNull ? r : clipped
      return [
        "x": Double(rect.minX / width),
        "y": Double(rect.minY / height),
        "w": Double(rect.width / width),
        "h": Double(rect.height / height),
      ]
    }
    var jointDict: [String: [String: Double]] = [:]
    for (name, p) in joints {
      jointDict[name] = ["x": Double(p.x / width), "y": Double(p.y / height)]
    }
    var out: [String: Any] = [
      "box": norm(box),
      "joints": jointDict,
      "confidence": confidence,
      "source": source,
      "imageWidth": Double(width),
      "imageHeight": Double(height),
    ]
    if let h = head {
      out["head"] = norm(h)
    }
    if let t = torso {
      out["torso"] = norm(t)
    }
    return out
  }
}
