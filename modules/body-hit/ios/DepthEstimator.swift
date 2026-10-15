import AVFoundation
import CoreGraphics
import CoreML
import CoreVideo
import CryptoKit
import Foundation
import ImageIO
import Vision

// Surface scanner for Laser Tag cover (walls, buildings, objects): monocular depth from one
// still camera frame with Apple's Core ML release of Depth Anything V2 Small (Float16).
//
// The model is DATA (spec + weights) and SHIPS INSIDE THE APP: BodyHit.podspec fetches Apple's
// .mlpackage at `pod install` (pinned commit, size + SHA-256 verified), compiles it with
// coremlcompiler and declares DepthAnythingV2SmallF16.mlmodelc as a pod resource, so it lands in
// the .app (bundledModelURL). It is loaded straight from there: no network, status "ready" at once.
//
// Fallback, only for a binary built without it (the build couldn't fetch it): the same files are
// downloaded once on demand, silently, from Apple's Hugging Face repository, pinned to one
// commit. Every file is checked against its expected byte size and SHA-256 before it is used;
// anything that doesn't match is deleted. Download:
// 8 MB HTTP Range chunks appended to a .part file (resumes after a failure, a kill or the next
// launch), Wi-Fi / unconstrained networks only until `cellularAfter` Laser Tag sessions have
// waited for Wi-Fi. Then MLModel.compileModel(at:) once; the compiled .mlmodelc is kept in
// Application Support (excluded from backup) and the package is deleted.
//
// Needs iOS 17 (the model is an ML Program, Core ML 7); older systems report "unsupported".
//
// LiDAR: not used. AVCaptureDepthDataOutput can only attach to a session whose input is a
// depth-capable device (the LiDAR / TrueDepth / dual cameras), and expo-camera's session uses
// the wide-angle camera; switching its input would mean reconfiguring expo-camera's session.
// `lidar` in the status only reports whether the hardware exists.
//
// estimate(uri:) -> [w, h, data (row-major, top row first), imageWidth, imageHeight, ...]:
// relative INVERSE depth (bigger = nearer, arbitrary scale and offset) averaged over a
// 24 x 32 (portrait) / 32 x 24 (landscape) grid of the upright photo. nil on any failure.
final class DepthEstimator {
  static let shared = DepthEstimator()

  struct RemoteFile {
    let path: String // inside the .mlpackage
    let size: Int64
    let sha256: String
  }

  static let modelName = "DepthAnythingV2SmallF16"
  static let revision = "cfef6f6f2a70783dedc0bfae40cecbc2052285d3"
  static let baseURL = "https://huggingface.co/apple/coreml-depth-anything-v2-small/resolve/\(revision)/\(modelName).mlpackage/"
  static let files: [RemoteFile] = [
    RemoteFile(path: "Manifest.json", size: 617, sha256: "2883ae290c48fe916dc5ececac03a7d847fa277165a49ef5652fa1d2b9cb55f7"),
    RemoteFile(path: "Data/com.apple.CoreML/model.mlmodel", size: 399_433, sha256: "44ac97a3efcfd52113183fb2862ff59cd0368e9ec2e30a90a54980dd11407042"),
    RemoteFile(path: "Data/com.apple.CoreML/weights/weight.bin", size: 49_419_072, sha256: "fa60d9b6a155734f59029ebb882fd54e549bfaee3539c1a9cbd2cbbab64a0fed"),
  ]
  static let versionTag = "\(modelName)@\(revision)"
  static let chunkSize: Int64 = 8 * 1024 * 1024
  static let gridLong = 32
  static let gridShort = 24
  static let maxPixelSize = 640
  static let waitsKey = "BodyHitDepthWifiWaits"

  // The compiled model shipped inside the app (see BodyHit.podspec), or nil. Static libraries /
  // static frameworks: the root of the .app; dynamic frameworks: BodyHit.framework.
  static let bundledModelURL: URL? = {
    var bundles: [Bundle] = [Bundle.main, Bundle(for: DepthEstimator.self)]
    for b in [Bundle.main, Bundle(for: DepthEstimator.self)] {
      if let u = b.url(forResource: "BodyHit", withExtension: "bundle"), let rb = Bundle(url: u) {
        bundles.append(rb)
      }
    }
    for b in bundles {
      if let u = b.url(forResource: modelName, withExtension: "mlmodelc") {
        return u
      }
    }
    return nil
  }()

  static var totalBytes: Int64 {
    return files.reduce(Int64(0)) { $0 + $1.size }
  }

  static let lidarHardware: Bool = {
    if #available(iOS 15.4, *) {
      return AVCaptureDevice.default(.builtInLiDARDepthCamera, for: .video, position: .back) != nil
    }
    return false
  }()

  private enum FetchResult {
    case ok
    case expensive
    case failed(String)
  }

  private let queue = DispatchQueue(label: "expo.bodyhit.depth", qos: .utility)
  private let inferQueue = DispatchQueue(label: "expo.bodyhit.depth.infer", qos: .userInitiated)
  private let lock = NSLock()
  private let bundleLock = NSLock() // one load of the bundled model at a time

  // Guarded by `lock`.
  private var state = "idle"
  private var errorText: String?
  private var bytesDone: Int64 = 0
  private var vnModel: VNCoreMLModel?
  private var busy = false
  private var bundledFailed = false

  // Only touched on `queue`.
  private var working = false
  private var countedWait = false
  private var transientRetries = 0
  private var integrityRetries = 0

  private lazy var session: URLSession = {
    let config = URLSessionConfiguration.default
    config.timeoutIntervalForRequest = 45
    config.timeoutIntervalForResource = 300
    config.requestCachePolicy = .reloadIgnoringLocalCacheData
    config.urlCache = nil
    config.httpMaximumConnectionsPerHost = 1
    return URLSession(configuration: config)
  }()

  // MARK: - status

  func status() -> [String: Any] {
    let bundled = bundledUsable()
    lock.lock()
    var s = state
    var e = errorText
    var done = bytesDone
    lock.unlock()
    let total = DepthEstimator.totalBytes
    if bundled && s != "ready" {
      // Shipped inside the app: ready at once (it is loaded on first use, no network).
      s = "ready"
      e = nil
      done = total
    }
    var out: [String: Any] = [
      "state": s,
      "bytes": Double(done),
      "total": Double(total),
      "progress": total > 0 ? min(1.0, Double(done) / Double(total)) : 0.0,
      "model": DepthEstimator.modelName,
      "lidar": DepthEstimator.lidarHardware,
      "lidarUsed": false,
      "bundled": bundled,
    ]
    if let e = e {
      out["error"] = e
    }
    return out
  }

  private func setState(_ s: String, error: String? = nil) {
    lock.lock()
    state = s
    errorText = error
    lock.unlock()
  }

  private func setBytes(_ b: Int64) {
    lock.lock()
    bytesDone = b
    lock.unlock()
  }

  private func currentState() -> String {
    lock.lock()
    let s = state
    lock.unlock()
    return s
  }

  private func hasModel() -> Bool {
    lock.lock()
    let ok = vnModel != nil
    lock.unlock()
    return ok
  }

  // MARK: - bundled model

  // There is a model inside the app that hasn't failed to load (iOS 17+ only).
  private func bundledUsable() -> Bool {
    guard #available(iOS 17.0, *), DepthEstimator.bundledModelURL != nil else {
      return false
    }
    lock.lock()
    let failed = bundledFailed
    lock.unlock()
    return !failed
  }

  private func currentModel() -> VNCoreMLModel? {
    lock.lock()
    let m = vnModel
    lock.unlock()
    return m
  }

  // Loads the model shipped inside the app (any thread). false when there is none, or it doesn't
  // load (then the runtime download takes over).
  @discardableResult
  private func loadBundled() -> Bool {
    if hasModel() {
      return true
    }
    guard bundledUsable(), let url = DepthEstimator.bundledModelURL else {
      return false
    }
    bundleLock.lock()
    defer {
      bundleLock.unlock()
    }
    if hasModel() {
      return true
    }
    do {
      let config = MLModelConfiguration()
      config.computeUnits = .all
      let ml = try MLModel(contentsOf: url, configuration: config)
      let vn = try VNCoreMLModel(for: ml)
      lock.lock()
      vnModel = vn
      state = "ready"
      errorText = nil
      bytesDone = DepthEstimator.totalBytes
      lock.unlock()
      return true
    } catch {
      lock.lock()
      bundledFailed = true
      lock.unlock()
      return false
    }
  }

  // MARK: - prepare (download + compile), all on `queue`

  // Starts (or resumes) getting the model ready in the background. Returns at once. With the
  // model shipped inside the app this only loads it (no network).
  func prepare(cellularAfter: Int) {
    queue.async {
      guard #available(iOS 17.0, *) else {
        self.setState("unsupported")
        return
      }
      if self.loadBundled() {
        return
      }
      if self.working || self.currentState() == "ready" {
        return
      }
      self.working = true
      self.transientRetries = 0
      self.integrityRetries = 0
      self.run(cellularAfter: cellularAfter)
    }
  }

  private func finish(_ s: String, _ err: String?) {
    working = false
    setState(s, error: err)
  }

  private func baseDir() -> URL? {
    let fm = FileManager.default
    guard let support = try? fm.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true) else {
      return nil
    }
    var dir = support.appendingPathComponent("BodyHitDepth", isDirectory: true)
    if !fm.fileExists(atPath: dir.path) {
      do {
        try fm.createDirectory(at: dir, withIntermediateDirectories: true, attributes: nil)
      } catch {
        return nil
      }
      var values = URLResourceValues()
      values.isExcludedFromBackup = true
      try? dir.setResourceValues(values)
    }
    return dir
  }

  private func packageDir(_ base: URL) -> URL {
    return base.appendingPathComponent("\(DepthEstimator.modelName).mlpackage", isDirectory: true)
  }

  private func compiledDir(_ base: URL) -> URL {
    return base.appendingPathComponent("\(DepthEstimator.modelName).mlmodelc", isDirectory: true)
  }

  private func markerFile(_ base: URL) -> URL {
    return base.appendingPathComponent("compiled.txt")
  }

  private func run(cellularAfter: Int) {
    guard let base = baseDir() else {
      finish("failed", "storage")
      return
    }
    if loadCompiled(base) {
      setBytes(DepthEstimator.totalBytes)
      finish("ready", nil)
      return
    }
    let pkg = packageDir(base)
    var missing: [RemoteFile] = []
    var have: Int64 = 0
    for f in DepthEstimator.files {
      let dest = pkg.appendingPathComponent(f.path)
      if DepthEstimator.fileSize(dest) == f.size {
        have += f.size
      } else {
        missing.append(f)
        have += DepthEstimator.fileSize(dest.appendingPathExtension("part")) ?? 0
      }
    }
    setBytes(have)
    if missing.isEmpty {
      compileAndLoad(base)
      return
    }
    let waits = UserDefaults.standard.integer(forKey: DepthEstimator.waitsKey)
    let cellular = waits >= max(0, cellularAfter)
    setState("downloading")
    download(missing, index: 0, base: base, cellular: cellular)
  }

  private func download(_ list: [RemoteFile], index: Int, base: URL, cellular: Bool) {
    if index >= list.count {
      compileAndLoad(base)
      return
    }
    let f = list[index]
    let fm = FileManager.default
    let dest = packageDir(base).appendingPathComponent(f.path)
    let part = dest.appendingPathExtension("part")
    try? fm.createDirectory(at: dest.deletingLastPathComponent(), withIntermediateDirectories: true, attributes: nil)
    var have = DepthEstimator.fileSize(part) ?? 0
    if have > f.size {
      try? fm.removeItem(at: part)
      have = 0
    }
    if have == f.size {
      // Complete: verify, then give it its final name (only verified files ever have it).
      if DepthEstimator.sha256Hex(part) == f.sha256 {
        try? fm.removeItem(at: dest)
        do {
          try fm.moveItem(at: part, to: dest)
        } catch {
          finish("failed", "write")
          return
        }
        download(list, index: index + 1, base: base, cellular: cellular)
      } else {
        try? fm.removeItem(at: part)
        refreshBytes(base)
        integrityRetries += 1
        if integrityRetries <= 1 {
          download(list, index: index, base: base, cellular: cellular)
        } else {
          finish("failed", "integrity")
        }
      }
      return
    }
    guard let url = URL(string: DepthEstimator.baseURL + f.path) else {
      finish("failed", "url")
      return
    }
    let length = min(DepthEstimator.chunkSize, f.size - have)
    fetchRange(url, offset: have, length: length, total: f.size, part: part, cellular: cellular) { [weak self] result in
      guard let self = self else { return }
      switch result {
      case .ok:
        self.transientRetries = 0
        self.refreshBytes(base)
        self.download(list, index: index, base: base, cellular: cellular)
      case .expensive:
        if !self.countedWait {
          self.countedWait = true
          let waits = UserDefaults.standard.integer(forKey: DepthEstimator.waitsKey)
          UserDefaults.standard.set(waits + 1, forKey: DepthEstimator.waitsKey)
        }
        self.finish("waiting-wifi", nil)
      case .failed(let msg):
        if self.transientRetries < 3 {
          self.transientRetries += 1
          let delay = Double(5 * self.transientRetries * self.transientRetries)
          self.queue.asyncAfter(deadline: .now() + delay) {
            self.download(list, index: index, base: base, cellular: cellular)
          }
        } else {
          self.finish("failed", msg)
        }
      }
    }
  }

  private func refreshBytes(_ base: URL) {
    let pkg = packageDir(base)
    var have: Int64 = 0
    for f in DepthEstimator.files {
      let dest = pkg.appendingPathComponent(f.path)
      if DepthEstimator.fileSize(dest) == f.size {
        have += f.size
      } else {
        have += DepthEstimator.fileSize(dest.appendingPathExtension("part")) ?? 0
      }
    }
    setBytes(have)
  }

  // One Range request. `done` runs on `queue`.
  private func fetchRange(_ url: URL, offset: Int64, length: Int64, total: Int64, part: URL, cellular: Bool, done: @escaping (FetchResult) -> Void) {
    var req = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 45)
    req.setValue("bytes=\(offset)-\(offset + length - 1)", forHTTPHeaderField: "Range")
    req.setValue("identity", forHTTPHeaderField: "Accept-Encoding")
    req.allowsExpensiveNetworkAccess = cellular
    req.allowsConstrainedNetworkAccess = cellular
    let task = session.downloadTask(with: req) { [weak self] tmp, response, error in
      // The temporary file is deleted when this returns, so it is stored right here.
      var result: FetchResult = .failed("network")
      if let urlError = error as? URLError, let reason = urlError.networkUnavailableReason, reason == .expensive || reason == .constrained {
        result = .expensive
      } else if let tmp = tmp, let http = response as? HTTPURLResponse {
        result = DepthEstimator.store(tmp: tmp, http: http, offset: offset, total: total, part: part)
      } else if let error = error {
        result = .failed(String(error.localizedDescription.prefix(80)))
      }
      guard let self = self else { return }
      let outcome = result
      self.queue.async {
        done(outcome)
      }
    }
    task.resume()
  }

  private static func store(tmp: URL, http: HTTPURLResponse, offset: Int64, total: Int64, part: URL) -> FetchResult {
    let fm = FileManager.default
    guard let got = fileSize(tmp), got > 0 else {
      return .failed("empty")
    }
    if http.statusCode == 206 {
      if let range = http.value(forHTTPHeaderField: "Content-Range"), let start = parseRangeStart(range), start != offset {
        return .failed("range")
      }
      if offset + got > total {
        return .failed("size")
      }
      return append(tmp, to: part, at: offset) ? .ok : .failed("write")
    }
    if http.statusCode == 200 {
      // The server ignored the range and sent the whole file: keep it only when complete.
      guard got == total else {
        return .failed("size")
      }
      try? fm.removeItem(at: part)
      do {
        try fm.moveItem(at: tmp, to: part)
      } catch {
        return .failed("write")
      }
      return .ok
    }
    return .failed("http \(http.statusCode)")
  }

  // "bytes 1000-1999/49419072" -> 1000
  static func parseRangeStart(_ header: String) -> Int64? {
    guard let r = header.range(of: "bytes ") else {
      return nil
    }
    let rest = header[r.upperBound...]
    guard let dash = rest.firstIndex(of: "-") else {
      return nil
    }
    let digits = String(rest[rest.startIndex..<dash]).trimmingCharacters(in: .whitespaces)
    return Int64(digits)
  }

  private static func append(_ src: URL, to part: URL, at offset: Int64) -> Bool {
    let fm = FileManager.default
    let current = fileSize(part) ?? 0
    if current != offset {
      return false
    }
    if !fm.fileExists(atPath: part.path) {
      if !fm.createFile(atPath: part.path, contents: nil, attributes: nil) {
        return false
      }
    }
    guard let data = try? Data(contentsOf: src, options: .alwaysMapped) else {
      return false
    }
    guard let handle = try? FileHandle(forWritingTo: part) else {
      return false
    }
    defer {
      try? handle.close()
    }
    do {
      _ = try handle.seekToEnd()
      try handle.write(contentsOf: data)
    } catch {
      return false
    }
    return true
  }

  static func fileSize(_ url: URL) -> Int64? {
    guard let attrs = try? FileManager.default.attributesOfItem(atPath: url.path) else {
      return nil
    }
    if let n = attrs[.size] as? NSNumber {
      return n.int64Value
    }
    return nil
  }

  static func sha256Hex(_ url: URL) -> String? {
    guard let handle = try? FileHandle(forReadingFrom: url) else {
      return nil
    }
    defer {
      try? handle.close()
    }
    var hasher = SHA256()
    while true {
      var chunk: Data? = nil
      do {
        chunk = try handle.read(upToCount: 1 << 20)
      } catch {
        return nil
      }
      guard let data = chunk, !data.isEmpty else {
        break
      }
      hasher.update(data: data)
    }
    let digest = hasher.finalize()
    return digest.map { String(format: "%02x", $0) }.joined()
  }

  private func compileAndLoad(_ base: URL) {
    setState("compiling")
    let fm = FileManager.default
    let pkg = packageDir(base)
    let dest = compiledDir(base)
    do {
      let compiled = try MLModel.compileModel(at: pkg)
      if fm.fileExists(atPath: dest.path) {
        try fm.removeItem(at: dest)
      }
      try fm.moveItem(at: compiled, to: dest)
      try DepthEstimator.versionTag.write(to: markerFile(base), atomically: true, encoding: .utf8)
    } catch {
      // A package that doesn't compile is no use: fetch it again next time.
      try? fm.removeItem(at: pkg)
      try? fm.removeItem(at: dest)
      finish("failed", "compile")
      return
    }
    if loadCompiled(base) {
      try? fm.removeItem(at: pkg) // the compiled model has its own copy of the weights
      setBytes(DepthEstimator.totalBytes)
      finish("ready", nil)
    } else {
      finish("failed", "load")
    }
  }

  private func loadCompiled(_ base: URL) -> Bool {
    if hasModel() {
      return true
    }
    let fm = FileManager.default
    let dest = compiledDir(base)
    guard fm.fileExists(atPath: dest.path) else {
      return false
    }
    guard let tag = try? String(contentsOf: markerFile(base), encoding: .utf8), tag == DepthEstimator.versionTag else {
      try? fm.removeItem(at: dest) // an older / unfinished compile
      return false
    }
    do {
      let config = MLModelConfiguration()
      config.computeUnits = .all
      let ml = try MLModel(contentsOf: dest, configuration: config)
      let vn = try VNCoreMLModel(for: ml)
      lock.lock()
      vnModel = vn
      lock.unlock()
      return true
    } catch {
      try? fm.removeItem(at: dest)
      try? fm.removeItem(at: markerFile(base))
      return false
    }
  }

  // MARK: - inference

  // One frame at a time; a request while one runs (or before the model is ready) gets nil.
  func estimate(uri: String, deleteAfter: Bool, done: @escaping ([String: Any]?) -> Void) {
    let url: URL? = uri.isEmpty ? nil : BodyDetector.fileURL(from: uri)
    let bundled = bundledUsable()
    lock.lock()
    let model = vnModel
    let canRun = (model != nil || bundled) && url != nil && !busy
    if canRun {
      busy = true
    }
    lock.unlock()
    guard canRun, let fileUrl = url else {
      if deleteAfter, let u = url, u.isFileURL {
        try? FileManager.default.removeItem(at: u)
      }
      done(nil)
      return
    }
    inferQueue.async {
      // The bundled model is loaded on first use when prepare() hasn't done it yet.
      let vn: VNCoreMLModel? = model ?? (self.loadBundled() ? self.currentModel() : nil)
      let out: [String: Any]? = vn.flatMap { DepthEstimator.infer(model: $0, url: fileUrl) }
      if deleteAfter, fileUrl.isFileURL {
        try? FileManager.default.removeItem(at: fileUrl)
      }
      self.lock.lock()
      self.busy = false
      self.lock.unlock()
      done(out)
    }
  }

  static func loadImage(_ url: URL) -> CGImage? {
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

  static func infer(model: VNCoreMLModel, url: URL) -> [String: Any]? {
    let started = Date()
    guard let image = loadImage(url) else {
      return nil
    }
    let iw = image.width
    let ih = image.height
    if iw < 8 || ih < 8 {
      return nil
    }
    let request = VNCoreMLRequest(model: model)
    // The model takes a fixed 518 x 392 frame: stretch the whole photo into it (no crop, so
    // every grid cell maps straight back onto the photo).
    request.imageCropAndScaleOption = .scaleFill
    let handler = VNImageRequestHandler(cgImage: image, orientation: .up, options: [:])
    do {
      try handler.perform([request])
    } catch {
      return nil
    }
    guard let first = request.results?.first else {
      return nil
    }
    let portrait = ih >= iw
    let gw = portrait ? gridShort : gridLong
    let gh = portrait ? gridLong : gridShort
    var grid: [Double]? = nil
    if let obs = first as? VNPixelBufferObservation {
      grid = pool(pixelBuffer: obs.pixelBuffer, gw: gw, gh: gh)
    } else if let obs = first as? VNCoreMLFeatureValueObservation, let arr = obs.featureValue.multiArrayValue {
      grid = pool(multiArray: arr, gw: gw, gh: gh)
    }
    guard let data = grid, data.count == gw * gh, data.allSatisfy({ $0.isFinite }) else {
      return nil
    }
    return [
      "w": gw,
      "h": gh,
      "data": data,
      "imageWidth": Double(iw),
      "imageHeight": Double(ih),
      "source": "model",
      "space": "photo",
      "kind": "inverse",
      "ms": Date().timeIntervalSince(started) * 1000,
    ]
  }

  // Mean of each grid cell (every other pixel), top row first.
  static func pool(pixelBuffer pb: CVPixelBuffer, gw: Int, gh: Int) -> [Double]? {
    let format = CVPixelBufferGetPixelFormatType(pb)
    let half = format == kCVPixelFormatType_OneComponent16Half || format == kCVPixelFormatType_DisparityFloat16 || format == kCVPixelFormatType_DepthFloat16
    let full = format == kCVPixelFormatType_OneComponent32Float || format == kCVPixelFormatType_DisparityFloat32 || format == kCVPixelFormatType_DepthFloat32
    if !half && !full {
      return nil
    }
    guard CVPixelBufferLockBaseAddress(pb, .readOnly) == kCVReturnSuccess else {
      return nil
    }
    defer {
      CVPixelBufferUnlockBaseAddress(pb, .readOnly)
    }
    guard let base = CVPixelBufferGetBaseAddress(pb) else {
      return nil
    }
    let w = CVPixelBufferGetWidth(pb)
    let h = CVPixelBufferGetHeight(pb)
    let rowBytes = CVPixelBufferGetBytesPerRow(pb)
    if w < gw || h < gh {
      return nil
    }
    var out = [Double](repeating: 0, count: gw * gh)
    for gy in 0..<gh {
      let y0 = gy * h / gh
      let y1 = max(y0 + 1, (gy + 1) * h / gh)
      for gx in 0..<gw {
        let x0 = gx * w / gw
        let x1 = max(x0 + 1, (gx + 1) * w / gw)
        var sum = 0.0
        var n = 0
        var y = y0
        while y < y1 {
          let row = base.advanced(by: y * rowBytes)
          var x = x0
          while x < x1 {
            let v: Float
            if half {
              v = halfToFloat(row.load(fromByteOffset: x * 2, as: UInt16.self))
            } else {
              v = row.load(fromByteOffset: x * 4, as: Float.self)
            }
            if v.isFinite {
              sum += Double(v)
              n += 1
            }
            x += 2
          }
          y += 2
        }
        out[gy * gw + gx] = n > 0 ? sum / Double(n) : Double.nan
      }
    }
    return out
  }

  static func pool(multiArray arr: MLMultiArray, gw: Int, gh: Int) -> [Double]? {
    let shape = arr.shape.map { $0.intValue }
    if shape.count < 2 {
      return nil
    }
    let h = shape[shape.count - 2]
    let w = shape[shape.count - 1]
    if w < gw || h < gh {
      return nil
    }
    let lead = [NSNumber](repeating: 0, count: shape.count - 2)
    var out = [Double](repeating: 0, count: gw * gh)
    for gy in 0..<gh {
      let y0 = gy * h / gh
      let y1 = max(y0 + 1, (gy + 1) * h / gh)
      for gx in 0..<gw {
        let x0 = gx * w / gw
        let x1 = max(x0 + 1, (gx + 1) * w / gw)
        var sum = 0.0
        var n = 0
        var y = y0
        while y < y1 {
          var x = x0
          while x < x1 {
            let v = arr[lead + [NSNumber(value: y), NSNumber(value: x)]].doubleValue
            if v.isFinite {
              sum += v
              n += 1
            }
            x += 4
          }
          y += 4
        }
        out[gy * gw + gx] = n > 0 ? sum / Double(n) : Double.nan
      }
    }
    return out
  }

  // IEEE 754 half -> float (no Float16 type needed, so it builds for every architecture).
  static func halfToFloat(_ h: UInt16) -> Float {
    let sign = UInt32(h >> 15) & 1
    let exp = UInt32(h >> 10) & 0x1f
    let mant = UInt32(h) & 0x3ff
    var bits: UInt32
    if exp == 0 {
      if mant == 0 {
        bits = sign << 31
      } else {
        var e: UInt32 = 127 - 15 + 1
        var m = mant
        while (m & 0x400) == 0 {
          m <<= 1
          e -= 1
        }
        m &= 0x3ff
        bits = (sign << 31) | (e << 23) | (m << 13)
      }
    } else if exp == 0x1f {
      bits = (sign << 31) | 0x7f80_0000 | (mant << 13)
    } else {
      bits = (sign << 31) | ((exp + 127 - 15) << 23) | (mant << 13)
    }
    return Float(bitPattern: bits)
  }
}
