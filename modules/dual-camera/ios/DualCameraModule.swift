import AVFoundation
import AudioToolbox
import ExpoModulesCore
import ReplayKit
import UIKit

// Laser Tag "selfie bubble": the back camera fills the view (aim + shoot) while the front
// camera shows the player's face in a small rounded bubble. Needs AVCaptureMultiCamSession
// (iPhone XS / XR and newer); JS only shows the toggle when isSupported() is true.
public class DualCameraModule: Module {
  public func definition() -> ModuleDefinition {
    Name("DualCamera")

    Function("isSupported") { () -> Bool in
      return AVCaptureMultiCamSession.isMultiCamSupported
    }

    // Gameplay recording (ReplayKit): the app's screen + game sound, plus your voice when
    // mic is true. iOS asks the player once to allow screen recording.
    Function("isRecordingSupported") { () -> Bool in
      return RPScreenRecorder.shared().isAvailable
    }

    AsyncFunction("startRecording") { (mic: Bool, promise: Promise) in
      DispatchQueue.main.async {
        let rec = RPScreenRecorder.shared()
        guard rec.isAvailable else {
          promise.reject("E_REC_UNAVAILABLE", "Screen recording isn't available right now")
          return
        }
        if rec.isRecording {
          promise.resolve(true)
          return
        }
        rec.isMicrophoneEnabled = mic
        rec.startRecording { error in
          if let error = error {
            promise.reject("E_REC_START", error.localizedDescription)
          } else {
            promise.resolve(true)
          }
        }
      }
    }

    // Stops and writes the clip to a temp .mp4; resolves its file URL (JS saves it to Photos).
    AsyncFunction("stopRecording") { (promise: Promise) in
      DispatchQueue.main.async {
        let rec = RPScreenRecorder.shared()
        guard rec.isRecording else {
          promise.resolve(nil)
          return
        }
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("iyiyi-gameplay-\(UUID().uuidString).mp4")
        rec.stopRecording(withOutput: url) { error in
          if let error = error {
            promise.reject("E_REC_STOP", error.localizedDescription)
          } else {
            promise.resolve(url.absoluteString)
          }
        }
      }
    }

    View(DualCameraView.self) {
      Events("onCameraReady", "onCameraError")

      Prop("selfieEnabled") { (view: DualCameraView, enabled: Bool) in
        view.setSelfieEnabled(enabled)
      }

      // [x, y, width, height] in points, relative to the view.
      Prop("selfieFrame") { (view: DualCameraView, frame: [Double]) in
        view.setSelfieFrame(frame)
      }

      AsyncFunction("takePicture") { (view: DualCameraView, quality: Double, promise: Promise) in
        view.takePicture(quality: quality, promise: promise)
      }
    }
  }
}

final class DualCameraView: ExpoView, AVCapturePhotoCaptureDelegate {
  let onCameraReady = EventDispatcher()
  let onCameraError = EventDispatcher()

  private let session = AVCaptureMultiCamSession()
  private let sessionQueue = DispatchQueue(label: "xyz.iyiyi.dualcamera.session")
  private let backLayer = AVCaptureVideoPreviewLayer()
  private let frontLayer = AVCaptureVideoPreviewLayer()
  private let bubble = UIView()
  private let photoOutput = AVCapturePhotoOutput()
  private var frontConnection: AVCaptureConnection?
  private var configured = false
  private var selfieEnabled = true
  private var selfieFrame = CGRect(x: 12, y: 220, width: 104, height: 140)
  private var pending: [Int64: (Promise, Double)] = [:]
  private let pendingLock = NSLock()

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    clipsToBounds = true
    backgroundColor = .black

    backLayer.setSessionWithNoConnection(session)
    backLayer.videoGravity = .resizeAspectFill
    layer.addSublayer(backLayer)

    frontLayer.setSessionWithNoConnection(session)
    frontLayer.videoGravity = .resizeAspectFill
    bubble.layer.addSublayer(frontLayer)
    bubble.layer.cornerRadius = 18
    bubble.layer.masksToBounds = true
    bubble.layer.borderWidth = 2
    bubble.layer.borderColor = UIColor(white: 1, alpha: 0.85).cgColor
    bubble.isUserInteractionEnabled = false
    addSubview(bubble)
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    backLayer.frame = bounds
    bubble.frame = selfieFrame
    frontLayer.frame = bubble.bounds
    CATransaction.commit()
  }

  override func didMoveToWindow() {
    super.didMoveToWindow()
    if window != nil { start() } else { stop() }
  }

  deinit {
    let s = session
    sessionQueue.async { if s.isRunning { s.stopRunning() } }
  }

  // MARK: props

  func setSelfieEnabled(_ on: Bool) {
    selfieEnabled = on
    bubble.isHidden = !on
    sessionQueue.async { [weak self] in self?.frontConnection?.isEnabled = on }
  }

  func setSelfieFrame(_ f: [Double]) {
    guard f.count == 4, f.allSatisfy({ $0.isFinite }), f[2] > 0, f[3] > 0 else { return }
    selfieFrame = CGRect(x: f[0], y: f[1], width: f[2], height: f[3])
    setNeedsLayout()
  }

  // MARK: session

  private func start() {
    sessionQueue.async { [weak self] in
      guard let self = self else { return }
      if !self.configured {
        do {
          try self.configure()
          self.configured = true
        } catch {
          self.fail(error.localizedDescription)
          return
        }
      }
      if !self.session.isRunning { self.session.startRunning() }
      DispatchQueue.main.async { self.onCameraReady([:]) }
    }
  }

  private func stop() {
    sessionQueue.async { [weak self] in
      guard let self = self else { return }
      if self.session.isRunning { self.session.stopRunning() }
    }
  }

  private func fail(_ message: String) {
    DispatchQueue.main.async { [weak self] in self?.onCameraError(["message": message]) }
  }

  private func portrait(_ c: AVCaptureConnection) {
    if #available(iOS 17.0, *) {
      if c.isVideoRotationAngleSupported(90) { c.videoRotationAngle = 90 }
    } else if c.isVideoOrientationSupported {
      c.videoOrientation = .portrait
    }
  }

  private func configure() throws {
    guard AVCaptureMultiCamSession.isMultiCamSupported else { throw DualCameraError.unsupported }
    session.beginConfiguration()
    defer { session.commitConfiguration() }

    // Back camera → full-screen preview + photos.
    guard let back = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .back) else { throw DualCameraError.noCamera }
    let backInput = try AVCaptureDeviceInput(device: back)
    guard session.canAddInput(backInput) else { throw DualCameraError.cannotAdd }
    session.addInputWithNoConnections(backInput)
    guard let backPort = backInput.ports(for: .video, sourceDeviceType: back.deviceType, sourceDevicePosition: .back).first else { throw DualCameraError.noPort }

    let backPreview = AVCaptureConnection(inputPort: backPort, videoPreviewLayer: backLayer)
    guard session.canAddConnection(backPreview) else { throw DualCameraError.cannotAdd }
    session.addConnection(backPreview)
    portrait(backPreview)

    guard session.canAddOutput(photoOutput) else { throw DualCameraError.cannotAdd }
    session.addOutputWithNoConnections(photoOutput)
    let photoConn = AVCaptureConnection(inputPorts: [backPort], output: photoOutput)
    guard session.canAddConnection(photoConn) else { throw DualCameraError.cannotAdd }
    session.addConnection(photoConn)
    portrait(photoConn)
    photoOutput.maxPhotoQualityPrioritization = .speed

    // Front camera → selfie bubble (optional: if it can't be added, the back camera still works).
    if let front = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .front),
       let frontInput = try? AVCaptureDeviceInput(device: front),
       session.canAddInput(frontInput) {
      session.addInputWithNoConnections(frontInput)
      if let frontPort = frontInput.ports(for: .video, sourceDeviceType: front.deviceType, sourceDevicePosition: .front).first {
        let fc = AVCaptureConnection(inputPort: frontPort, videoPreviewLayer: frontLayer)
        if session.canAddConnection(fc) {
          session.addConnection(fc)
          portrait(fc)
          if fc.isVideoMirroringSupported {
            fc.automaticallyAdjustsVideoMirroring = false
            fc.isVideoMirrored = true
          }
          fc.isEnabled = selfieEnabled
          frontConnection = fc
        }
      }
    }
  }

  // MARK: photos (back camera, for hit detection)

  func takePicture(quality: Double, promise: Promise) {
    sessionQueue.async { [weak self] in
      guard let self = self else { return }
      guard self.session.isRunning, self.photoOutput.connection(with: .video) != nil else {
        promise.reject("E_NOT_READY", "Camera isn't running yet")
        return
      }
      let settings: AVCapturePhotoSettings
      if self.photoOutput.availablePhotoCodecTypes.contains(.jpeg) {
        settings = AVCapturePhotoSettings(format: [AVVideoCodecKey: AVVideoCodecType.jpeg])
      } else {
        settings = AVCapturePhotoSettings()
      }
      settings.photoQualityPrioritization = .speed
      self.pendingLock.lock()
      self.pending[settings.uniqueID] = (promise, quality)
      self.pendingLock.unlock()
      self.photoOutput.capturePhoto(with: settings, delegate: self)
    }
  }

  // Silence the shutter sound (same approach expo-camera uses).
  func photoOutput(_ output: AVCapturePhotoOutput, willCapturePhotoFor resolvedSettings: AVCaptureResolvedPhotoSettings) {
    AudioServicesDisposeSystemSoundID(1108)
  }

  func photoOutput(_ output: AVCapturePhotoOutput, didFinishProcessingPhoto photo: AVCapturePhoto, error: Error?) {
    let id = photo.resolvedSettings.uniqueID
    pendingLock.lock()
    let entry = pending.removeValue(forKey: id)
    pendingLock.unlock()
    guard let (promise, quality) = entry else { return }
    if let error = error {
      promise.reject("E_CAPTURE", error.localizedDescription)
      return
    }
    guard let data = photo.fileDataRepresentation(), let image = UIImage(data: data) else {
      promise.reject("E_CAPTURE", "No photo data")
      return
    }
    // Re-encode upright (bakes in the orientation) at the requested quality.
    let upright = image.normalizedUp()
    guard let jpeg = upright.jpegData(compressionQuality: CGFloat(max(0.05, min(1.0, quality)))) else {
      promise.reject("E_CAPTURE", "Couldn't encode photo")
      return
    }
    let url = FileManager.default.temporaryDirectory.appendingPathComponent("dualcam-\(UUID().uuidString).jpg")
    do {
      try jpeg.write(to: url)
      promise.resolve([
        "uri": url.absoluteString,
        "width": Int(upright.size.width * upright.scale),
        "height": Int(upright.size.height * upright.scale),
      ])
    } catch {
      promise.reject("E_CAPTURE", error.localizedDescription)
    }
  }
}

enum DualCameraError: LocalizedError {
  case unsupported, noCamera, cannotAdd, noPort
  var errorDescription: String? {
    switch self {
    case .unsupported: return "This iPhone can't use two cameras at once"
    case .noCamera: return "No back camera"
    case .cannotAdd: return "Couldn't set up both cameras"
    case .noPort: return "Camera port unavailable"
    }
  }
}

private extension UIImage {
  func normalizedUp() -> UIImage {
    if imageOrientation == .up { return self }
    let format = UIGraphicsImageRendererFormat.default()
    format.scale = scale
    return UIGraphicsImageRenderer(size: size, format: format).image { _ in draw(in: CGRect(origin: .zero, size: size)) }
  }
}
