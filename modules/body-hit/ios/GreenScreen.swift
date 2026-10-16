import AVFoundation
import CoreImage
import ExpoCamera
import Foundation
import ImageIO
import QuartzCore
import UIKit
import Vision

// Live green screen for the camera: cuts the person out of every camera frame (Apple Vision
// person segmentation, iOS 15+) and puts them on a background (a picture, a blur of the room,
// or a colour), shown live on top of expo-camera's preview.
//
// Same attach pattern as LiveFaceTracker: we add an AVCaptureVideoDataOutput to the session
// behind the on-screen preview, on expo-camera's own sessionQueue, and catch any AVFoundation
// exception (BHTry). The composite goes into a CALayer on top of the preview layer.
//
// expo-camera's movie output records the raw camera, so while the green screen is on the JS
// keeps the camera in photo mode and captures through here instead:
//   capturePhoto()      -> JPEG of the current composite
//   startRecording()    -> AVAssetWriter of the composites + microphone (AVAudioRecorder),
//   stopRecording()        muxed into one .mov when it stops
final class GreenScreen: NSObject, AVCaptureVideoDataOutputSampleBufferDelegate {
  static let shared = GreenScreen()

  private let queue = DispatchQueue(label: "xyz.iyiyi.greenscreen", qos: .userInitiated)
  private let ci = CIContext(options: [.cacheIntermediates: false])
  private lazy var request: VNGeneratePersonSegmentationRequest = {
    let r = VNGeneratePersonSegmentationRequest()
    r.qualityLevel = .balanced
    r.outputPixelFormat = kCVPixelFormatType_OneComponent8
    return r
  }()

  // main thread
  private weak var previewLayer: AVCaptureVideoPreviewLayer?
  private weak var session: AVCaptureSession?
  private var output: AVCaptureVideoDataOutput?
  private var overlay: CALayer?

  // queue
  private var active = false
  private var mode = "image" // image | blur | color
  private var bgSource: CIImage?
  private var bgColor = CIColor(red: 0, green: 0.8, blue: 0.3)
  private var bgCache: (size: CGSize, image: CIImage)?
  private var lastFrame: CIImage?
  private var frameCount = 0

  // recording (queue)
  private var writer: AVAssetWriter?
  private var writerInput: AVAssetWriterInput?
  private var adaptor: AVAssetWriterInputPixelBufferAdaptor?
  private var recordURL: URL?
  private var audioURL: URL?
  private var audioRecorder: AVAudioRecorder?
  private var wantRecording = false
  private var sessionStarted = false
  private var lastPTS: CMTime = .invalid

  // MARK: start / stop (main thread)

  /// opts: { mode: "image" | "blur" | "color", uri?: string, color?: "#rrggbb" }
  func start(opts: [String: Any], completion: @escaping (Bool) -> Void) {
    configure(opts)
    guard let layer = LiveFaceTracker.findPreviewLayer(), let session = layer.session else {
      completion(false)
      return
    }
    previewLayer = layer
    ensureOverlay(on: layer)
    if let out = output, self.session === session, session.outputs.contains(out) {
      queue.async { self.active = true }
      completion(true)
      return
    }
    self.session = session
    let sessionQueue = (layer.delegate as? CameraView)?.sessionQueue ?? DispatchQueue.main
    sessionQueue.async { [weak self] in
      guard let self = self else { return }
      var added: AVCaptureVideoDataOutput?
      let failure = BHTry.run {
        guard session.isRunning else { return }
        let out = AVCaptureVideoDataOutput()
        out.videoSettings = [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA]
        out.alwaysDiscardsLateVideoFrames = true
        session.beginConfiguration()
        if session.canAddOutput(out) {
          session.addOutput(out)
          added = out
          if let c = out.connection(with: .video) {
            if #available(iOS 17.0, *) {
              if c.isVideoRotationAngleSupported(90) { c.videoRotationAngle = 90 }
            } else if c.isVideoOrientationSupported {
              c.videoOrientation = .portrait
            }
          }
        }
        session.commitConfiguration()
        added?.setSampleBufferDelegate(self, queue: self.queue)
      }
      DispatchQueue.main.async {
        self.output = added
        let ok = failure == nil && added != nil
        if ok {
          self.queue.async { self.active = true }
        } else {
          self.removeOverlay()
        }
        completion(ok)
      }
    }
  }

  func update(opts: [String: Any]) {
    configure(opts)
  }

  func stop() {
    queue.async {
      self.active = false
      self.lastFrame = nil
      self.bgCache = nil
    }
    removeOverlay()
    guard let out = output, let session = session else { output = nil; return }
    output = nil
    let sessionQueue = (previewLayer?.delegate as? CameraView)?.sessionQueue ?? DispatchQueue.main
    sessionQueue.async {
      _ = BHTry.run {
        out.setSampleBufferDelegate(nil, queue: nil)
        if session.outputs.contains(out) {
          session.beginConfiguration()
          session.removeOutput(out)
          session.commitConfiguration()
        }
      }
    }
  }

  private func configure(_ opts: [String: Any]) {
    let m = (opts["mode"] as? String) ?? "image"
    var img: CIImage?
    if m == "image", let uri = opts["uri"] as? String, let url = GreenScreen.fileURL(uri) {
      img = CIImage(contentsOf: url, options: [.applyOrientationProperty: true])
    }
    let color = GreenScreen.color(opts["color"] as? String)
    queue.async {
      self.mode = (m == "image" && img == nil) ? "blur" : m
      self.bgSource = img
      if let c = color { self.bgColor = c }
      self.bgCache = nil
    }
  }

  private func ensureOverlay(on layer: AVCaptureVideoPreviewLayer) {
    if let o = overlay, o.superlayer === layer { o.frame = layer.bounds; return }
    removeOverlay()
    let o = CALayer()
    o.frame = layer.bounds
    o.contentsGravity = .resizeAspectFill
    o.masksToBounds = true
    o.actions = ["contents": NSNull(), "bounds": NSNull(), "position": NSNull()]
    layer.addSublayer(o)
    overlay = o
  }

  private func removeOverlay() {
    overlay?.removeFromSuperlayer()
    overlay = nil
  }

  // MARK: frames (queue)

  func captureOutput(_ output: AVCaptureOutput, didOutput sampleBuffer: CMSampleBuffer, from connection: AVCaptureConnection) {
    guard active, let pixels = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }
    let pts = CMSampleBufferGetPresentationTimeStamp(sampleBuffer)
    let front = (connection.inputPorts.first?.input as? AVCaptureDeviceInput)?.device.position == .front

    var cam = CIImage(cvPixelBuffer: pixels)
    let extent = cam.extent
    if front {
      cam = cam.transformed(by: CGAffineTransform(scaleX: -1, y: 1).translatedBy(x: -extent.width, y: 0))
    }

    let handler = VNImageRequestHandler(cvPixelBuffer: pixels, orientation: .up, options: [:])
    var composite = cam
    if (try? handler.perform([request])) != nil, let maskPixels = request.results?.first?.pixelBuffer {
      var mask = CIImage(cvPixelBuffer: maskPixels)
      let sx = extent.width / mask.extent.width
      let sy = extent.height / mask.extent.height
      mask = mask.transformed(by: CGAffineTransform(scaleX: sx, y: sy))
      if front {
        mask = mask.transformed(by: CGAffineTransform(scaleX: -1, y: 1).translatedBy(x: -extent.width, y: 0))
      }
      let bg = background(for: extent, camera: cam)
      composite = cam.applyingFilter("CIBlendWithMask", parameters: [
        kCIInputBackgroundImageKey: bg,
        kCIInputMaskImageKey: mask,
      ]).cropped(to: extent)
    }
    lastFrame = composite

    if wantRecording { append(composite, extent: extent, pts: pts) }

    frameCount += 1
    guard let cg = ci.createCGImage(composite, from: extent) else { return }
    DispatchQueue.main.async { [weak self] in
      guard let self = self, let o = self.overlay else { return }
      if let layer = self.previewLayer, o.frame != layer.bounds { o.frame = layer.bounds }
      o.contents = cg
    }
  }

  private func background(for extent: CGRect, camera: CIImage) -> CIImage {
    switch mode {
    case "blur":
      return camera.clampedToExtent().applyingGaussianBlur(sigma: 24).cropped(to: extent)
    case "color":
      return CIImage(color: bgColor).cropped(to: extent)
    default:
      if let cached = bgCache, cached.size == extent.size { return cached.image }
      guard let src = bgSource else {
        return camera.clampedToExtent().applyingGaussianBlur(sigma: 24).cropped(to: extent)
      }
      // aspect-fill the picture into the frame
      let s = max(extent.width / src.extent.width, extent.height / src.extent.height)
      var img = src.transformed(by: CGAffineTransform(translationX: -src.extent.minX, y: -src.extent.minY))
        .transformed(by: CGAffineTransform(scaleX: s, y: s))
      let dx = (img.extent.width - extent.width) / 2
      let dy = (img.extent.height - extent.height) / 2
      img = img.transformed(by: CGAffineTransform(translationX: -dx, y: -dy)).cropped(to: extent)
      bgCache = (extent.size, img)
      return img
    }
  }

  // MARK: photo

  func capturePhoto(completion: @escaping (String?) -> Void) {
    queue.async {
      guard let frame = self.lastFrame,
            let cs = CGColorSpace(name: CGColorSpace.sRGB),
            let data = self.ci.jpegRepresentation(of: frame, colorSpace: cs, options: [CIImageRepresentationOption(rawValue: kCGImageDestinationLossyCompressionQuality as String): 0.9]) else {
        completion(nil)
        return
      }
      let url = FileManager.default.temporaryDirectory.appendingPathComponent("greenscreen-\(UUID().uuidString).jpg")
      do {
        try data.write(to: url)
        completion(url.absoluteString)
      } catch {
        completion(nil)
      }
    }
  }

  // MARK: recording

  func startRecording(withAudio: Bool, completion: @escaping (Bool) -> Void) {
    queue.async {
      guard self.active, self.writer == nil, let frame = self.lastFrame else { completion(false); return }
      let w = Int(frame.extent.width) & ~1
      let h = Int(frame.extent.height) & ~1
      let url = FileManager.default.temporaryDirectory.appendingPathComponent("greenscreen-\(UUID().uuidString).mov")
      guard let writer = try? AVAssetWriter(outputURL: url, fileType: .mov) else { completion(false); return }
      let input = AVAssetWriterInput(mediaType: .video, outputSettings: [
        AVVideoCodecKey: AVVideoCodecType.h264,
        AVVideoWidthKey: w,
        AVVideoHeightKey: h,
        AVVideoCompressionPropertiesKey: [AVVideoAverageBitRateKey: max(4_000_000, w * h * 4)],
      ])
      input.expectsMediaDataInRealTime = true
      let adaptor = AVAssetWriterInputPixelBufferAdaptor(assetWriterInput: input, sourcePixelBufferAttributes: [
        kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
        kCVPixelBufferWidthKey as String: w,
        kCVPixelBufferHeightKey as String: h,
      ])
      guard writer.canAdd(input) else { completion(false); return }
      writer.add(input)
      guard writer.startWriting() else { completion(false); return }
      self.writer = writer
      self.writerInput = input
      self.adaptor = adaptor
      self.recordURL = url
      self.sessionStarted = false
      self.lastPTS = .invalid
      self.audioURL = nil
      self.audioRecorder = nil
      if withAudio { self.startAudio() }
      self.wantRecording = true
      completion(true)
    }
  }

  private func startAudio() {
    let url = FileManager.default.temporaryDirectory.appendingPathComponent("greenscreen-\(UUID().uuidString).m4a")
    do {
      let s = AVAudioSession.sharedInstance()
      try s.setCategory(.playAndRecord, mode: .videoRecording, options: [.defaultToSpeaker, .mixWithOthers, .allowBluetoothA2DP])
      try s.setActive(true)
      let rec = try AVAudioRecorder(url: url, settings: [
        AVFormatIDKey: kAudioFormatMPEG4AAC,
        AVSampleRateKey: 44_100,
        AVNumberOfChannelsKey: 1,
        AVEncoderAudioQualityKey: AVAudioQuality.high.rawValue,
      ])
      if rec.record() {
        audioRecorder = rec
        audioURL = url
      }
    } catch {
      audioRecorder = nil
      audioURL = nil
    }
  }

  private func append(_ image: CIImage, extent: CGRect, pts: CMTime) {
    guard let writer = writer, let input = writerInput, let adaptor = adaptor, writer.status == .writing else { return }
    if !sessionStarted {
      writer.startSession(atSourceTime: pts)
      sessionStarted = true
    }
    guard input.isReadyForMoreMediaData, let pool = adaptor.pixelBufferPool else { return }
    if lastPTS.isValid && CMTimeCompare(pts, lastPTS) <= 0 { return }
    var out: CVPixelBuffer?
    CVPixelBufferPoolCreatePixelBuffer(nil, pool, &out)
    guard let buffer = out else { return }
    ci.render(image, to: buffer, bounds: CGRect(x: 0, y: 0, width: CVPixelBufferGetWidth(buffer), height: CVPixelBufferGetHeight(buffer)), colorSpace: CGColorSpace(name: CGColorSpace.sRGB))
    if adaptor.append(buffer, withPresentationTime: pts) { lastPTS = pts }
  }

  func stopRecording(completion: @escaping (String?) -> Void) {
    queue.async {
      self.wantRecording = false
      guard let writer = self.writer, let input = self.writerInput, let url = self.recordURL else {
        completion(nil)
        return
      }
      let audio = self.audioURL
      self.audioRecorder?.stop()
      self.audioRecorder = nil
      self.writer = nil
      self.writerInput = nil
      self.adaptor = nil
      guard self.sessionStarted, writer.status == .writing else {
        writer.cancelWriting()
        completion(nil)
        return
      }
      input.markAsFinished()
      writer.finishWriting {
        guard writer.status == .completed else { completion(nil); return }
        guard let audioURL = audio else { completion(url.absoluteString); return }
        GreenScreen.mux(video: url, audio: audioURL) { muxed in
          completion((muxed ?? url).absoluteString)
        }
      }
    }
  }

  private static func mux(video: URL, audio: URL, completion: @escaping (URL?) -> Void) {
    let v = AVURLAsset(url: video)
    let a = AVURLAsset(url: audio)
    let comp = AVMutableComposition()
    guard let vTrack = v.tracks(withMediaType: .video).first,
          let cv = comp.addMutableTrack(withMediaType: .video, preferredTrackID: kCMPersistentTrackID_Invalid) else {
      completion(nil)
      return
    }
    let duration = v.duration
    do {
      try cv.insertTimeRange(CMTimeRange(start: .zero, duration: duration), of: vTrack, at: .zero)
      cv.preferredTransform = vTrack.preferredTransform
      if let aTrack = a.tracks(withMediaType: .audio).first,
         let ca = comp.addMutableTrack(withMediaType: .audio, preferredTrackID: kCMPersistentTrackID_Invalid) {
        let len = CMTimeMinimum(duration, a.duration)
        try ca.insertTimeRange(CMTimeRange(start: .zero, duration: len), of: aTrack, at: .zero)
      }
    } catch {
      completion(nil)
      return
    }
    let out = FileManager.default.temporaryDirectory.appendingPathComponent("greenscreen-\(UUID().uuidString).mov")
    guard let export = AVAssetExportSession(asset: comp, presetName: AVAssetExportPresetPassthrough) else {
      completion(nil)
      return
    }
    export.outputURL = out
    export.outputFileType = .mov
    export.exportAsynchronously {
      completion(export.status == .completed ? out : nil)
    }
  }

  // MARK: helpers

  static func fileURL(_ uri: String) -> URL? {
    if uri.hasPrefix("file://") || uri.hasPrefix("http") { return URL(string: uri) }
    if uri.hasPrefix("/") { return URL(fileURLWithPath: uri) }
    return URL(string: uri)
  }

  static func color(_ hex: String?) -> CIColor? {
    guard var h = hex?.trimmingCharacters(in: .whitespaces) else { return nil }
    if h.hasPrefix("#") { h.removeFirst() }
    guard h.count == 6, let v = UInt32(h, radix: 16) else { return nil }
    return CIColor(red: CGFloat((v >> 16) & 0xff) / 255, green: CGFloat((v >> 8) & 0xff) / 255, blue: CGFloat(v & 0xff) / 255)
  }
}
