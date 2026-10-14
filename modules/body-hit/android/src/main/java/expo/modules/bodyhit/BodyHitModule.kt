package expo.modules.bodyhit

import android.app.Activity
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.graphics.PointF
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.view.View
import android.view.ViewGroup
import androidx.exifinterface.media.ExifInterface
import com.google.android.gms.tasks.Tasks
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.face.Face
import com.google.mlkit.vision.face.FaceDetection
import com.google.mlkit.vision.face.FaceDetector
import com.google.mlkit.vision.face.FaceDetectorOptions
import com.google.mlkit.vision.face.FaceLandmark
import com.google.mlkit.vision.pose.Pose
import com.google.mlkit.vision.pose.PoseDetection
import com.google.mlkit.vision.pose.PoseDetector
import com.google.mlkit.vision.pose.PoseLandmark
import com.google.mlkit.vision.pose.defaults.PoseDetectorOptions
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

// Android side of the `body-hit` module: the camera filters' face tracking, with Google ML Kit
// in place of Apple Vision. Same JS API as iOS for faces:
//   detectFaces(uri, deleteAfter) -> [{ box{x,y,w,h} 0..1, landmarks{nose,leftEye,rightEye} 0..1,
//                                      confidence, imageWidth, imageHeight }]
//   startLiveFaces() / stopLiveFaces() + "onLiveFaces" events:
//     { faces: [{ x, y, w, h, id, landmarks? }], layerW, layerH }  in preview-view pixels
// Live tracking copies what the on-screen camera preview (CameraX PreviewView inside
// expo-camera) is showing - already mirrored / cropped like the screen - and runs face
// detection on it ~15-20 times a second. No photos are taken.
// detectBodies (Laser Tag hits) uses ML Kit pose detection: same output shape as iOS
// (box / head / torso / joints, normalized, top-left origin). ML Kit finds the most
// prominent single person in the photo.
class BodyHitModule : Module() {
  private val main = Handler(Looper.getMainLooper())
  private val worker = Executors.newSingleThreadExecutor()
  private val busy = AtomicBoolean(false)
  @Volatile private var running = false
  private var preview: View? = null

  private val liveDetector: FaceDetector by lazy {
    FaceDetection.getClient(
      FaceDetectorOptions.Builder()
        .setPerformanceMode(FaceDetectorOptions.PERFORMANCE_MODE_FAST)
        .setLandmarkMode(FaceDetectorOptions.LANDMARK_MODE_ALL)
        .setContourMode(FaceDetectorOptions.CONTOUR_MODE_NONE)
        .setClassificationMode(FaceDetectorOptions.CLASSIFICATION_MODE_NONE)
        .setMinFaceSize(0.08f)
        .enableTracking()
        .build()
    )
  }

  private val stillDetector: FaceDetector by lazy {
    FaceDetection.getClient(
      FaceDetectorOptions.Builder()
        .setPerformanceMode(FaceDetectorOptions.PERFORMANCE_MODE_ACCURATE)
        .setLandmarkMode(FaceDetectorOptions.LANDMARK_MODE_ALL)
        .setMinFaceSize(0.06f)
        .build()
    )
  }

  // Live people tracking (Laser Tag): ML Kit pose in STREAM_MODE (the most prominent person,
  // smoothed across frames) + fast face detection with tracking ids (heads, and more people).
  private val streamPoseDetector: PoseDetector by lazy {
    PoseDetection.getClient(
      PoseDetectorOptions.Builder()
        .setDetectorMode(PoseDetectorOptions.STREAM_MODE)
        .build()
    )
  }

  private val bodyFaceDetector: FaceDetector by lazy {
    FaceDetection.getClient(
      FaceDetectorOptions.Builder()
        .setPerformanceMode(FaceDetectorOptions.PERFORMANCE_MODE_FAST)
        .setLandmarkMode(FaceDetectorOptions.LANDMARK_MODE_NONE)
        .setContourMode(FaceDetectorOptions.CONTOUR_MODE_NONE)
        .setClassificationMode(FaceDetectorOptions.CLASSIFICATION_MODE_NONE)
        .setMinFaceSize(0.05f)
        .enableTracking()
        .build()
    )
  }

  private val poseDetector: PoseDetector by lazy {
    PoseDetection.getClient(
      PoseDetectorOptions.Builder()
        .setDetectorMode(PoseDetectorOptions.SINGLE_IMAGE_MODE)
        .build()
    )
  }

  override fun definition() = ModuleDefinition {
    Name("BodyHit")

    AsyncFunction("detectBodies") { uri: String, deleteAfter: Boolean, promise: Promise ->
      worker.execute {
        val result = try {
          detectBodiesStill(uri)
        } catch (e: Throwable) {
          emptyList<Map<String, Any?>>()
        }
        if (deleteAfter) {
          try { fileFor(uri)?.delete() } catch (_: Throwable) {}
        }
        promise.resolve(result)
      }
    }

    Events("onLiveFaces", "onLiveBodies")

    // Real-time people tracking for Laser Tag (target brackets + aim assist), from the same
    // on-screen preview copy as startLiveFaces, ~10 times a second. "onLiveBodies" events:
    //   { bodies: [{ id, x, y, w, h, head?: { x, y, w, h }, conf, kind }], layerW, layerH }
    // x/y/w/h normalized 0..1 of the preview view (top-left origin, what is on screen).
    // kind: "pose" (ML Kit pose: one person, the most prominent) | "face" (a body estimated from
    // a face). Resolves false when there is no camera preview on screen.
    AsyncFunction("startLiveBodies") { promise: Promise ->
      main.post {
        val view = findPreview()
        if (view == null) {
          promise.resolve(false)
        } else {
          bodiesPreview = view
          if (!bodiesRunning) {
            bodiesRunning = true
            bodiesLastEmpty = false
            main.post(bodiesTick)
          }
          promise.resolve(true)
        }
      }
    }

    AsyncFunction("stopLiveBodies") { promise: Promise ->
      main.post {
        bodiesRunning = false
        bodiesPreview = null
        main.removeCallbacks(bodiesTick)
        promise.resolve(null)
      }
    }

    AsyncFunction("detectFaces") { uri: String, deleteAfter: Boolean, promise: Promise ->
      worker.execute {
        val result = try {
          detectStill(uri)
        } catch (e: Throwable) {
          emptyList<Map<String, Any?>>()
        }
        if (deleteAfter) {
          try { fileFor(uri)?.delete() } catch (_: Throwable) {}
        }
        promise.resolve(result)
      }
    }

    AsyncFunction("startLiveFaces") { promise: Promise ->
      main.post {
        val view = findPreview()
        if (view == null) {
          promise.resolve(false)
        } else {
          preview = view
          if (!running) {
            running = true
            main.post(tick)
          }
          promise.resolve(true)
        }
      }
    }

    AsyncFunction("stopLiveFaces") { promise: Promise ->
      main.post {
        running = false
        preview = null
        main.removeCallbacks(tick)
        promise.resolve(null)
      }
    }

    OnDestroy {
      running = false
      main.removeCallbacks(tick)
      bodiesRunning = false
      main.removeCallbacks(bodiesTick)
    }
  }

  // --- live ------------------------------------------------------------------------------

  private val tick: Runnable = object : Runnable {
    override fun run() {
      if (!running) return
      try {
        grabAndDetect()
      } catch (_: Throwable) {
        busy.set(false)
      }
      main.postDelayed(this, 45)
    }
  }

  private var lastEmpty = false

  private fun grabAndDetect() {
    val view = preview
    if (view == null || !view.isAttachedToWindow || view.width <= 0 || view.height <= 0) {
      val again = findPreview()
      if (again == null) return
      preview = again
      return
    }
    if (!busy.compareAndSet(false, true)) return
    val full = previewBitmap(view)
    if (full == null) {
      busy.set(false)
      return
    }
    val vw = view.width
    val vh = view.height
    worker.execute {
      try {
        // Detect on a small copy: fast, and plenty for face boxes.
        val target = 360f
        val scale = if (full.width > target) target / full.width else 1f
        val small = if (scale < 1f) Bitmap.createScaledBitmap(full, (full.width * scale).toInt(), (full.height * scale).toInt(), true) else full
        val faces = Tasks.await(liveDetector.process(InputImage.fromBitmap(small, 0)))
        val sx = vw.toFloat() / small.width
        val sy = vh.toFloat() / small.height
        val list = faces.mapNotNull { f -> liveFace(f, sx, sy) }
        if (small !== full) small.recycle()
        full.recycle()
        if (list.isEmpty()) {
          if (!lastEmpty) {
            lastEmpty = true
            emit(list, vw, vh)
          }
        } else {
          lastEmpty = false
          emit(list, vw, vh)
        }
      } catch (_: Throwable) {
        // skip this frame
      } finally {
        busy.set(false)
      }
    }
  }

  private fun emit(faces: List<Map<String, Any?>>, w: Int, h: Int) {
    try {
      sendEvent("onLiveFaces", mapOf("faces" to faces, "layerW" to w.toDouble(), "layerH" to h.toDouble()))
    } catch (_: Throwable) {}
  }

  private fun liveFace(f: Face, sx: Float, sy: Float): Map<String, Any?>? {
    val b = f.boundingBox
    if (b.width() <= 2) return null
    val lm = mutableMapOf<String, Any?>()
    fun put(name: String, type: Int) {
      val p: PointF = f.getLandmark(type)?.position ?: return
      lm[name] = mapOf("x" to (p.x * sx).toDouble(), "y" to (p.y * sy).toDouble())
    }
    put("nose", FaceLandmark.NOSE_BASE)
    put("leftEye", FaceLandmark.LEFT_EYE)
    put("rightEye", FaceLandmark.RIGHT_EYE)
    return mapOf(
      "x" to (b.left * sx).toDouble(),
      "y" to (b.top * sy).toDouble(),
      "w" to (b.width() * sx).toDouble(),
      "h" to (b.height() * sy).toDouble(),
      "id" to (f.trackingId ?: -1),
      "landmarks" to if (lm.size == 3) lm else null,
    )
  }

  // expo-camera draws its preview in a CameraX PreviewView; getBitmap() returns exactly what
  // is on screen (front camera mirrored, cropped to fill). Looked up by class name so this
  // module needs no compile-time CameraX dependency.
  private fun previewBitmap(view: View): Bitmap? = try {
    view.javaClass.getMethod("getBitmap").invoke(view) as? Bitmap
  } catch (_: Throwable) {
    null
  }

  private fun findPreview(): View? {
    val activity: Activity = appContext.currentActivity ?: return null
    val root = activity.window?.decorView ?: return null
    var best: View? = null
    var bestArea = 0
    fun walk(v: View) {
      if (v.javaClass.name == "androidx.camera.view.PreviewView" && v.isShown) {
        val area = v.width * v.height
        if (area > bestArea) { best = v; bestArea = area }
      }
      if (v is ViewGroup) for (i in 0 until v.childCount) walk(v.getChildAt(i))
    }
    walk(root)
    return best
  }

  // --- live bodies (Laser Tag) -------------------------------------------------------------

  private val bodiesBusy = AtomicBoolean(false)
  @Volatile private var bodiesRunning = false
  private var bodiesPreview: View? = null
  @Volatile private var bodiesLastEmpty = false

  private val bodiesTick: Runnable = object : Runnable {
    override fun run() {
      if (!bodiesRunning) return
      try {
        grabBodies()
      } catch (_: Throwable) {
        bodiesBusy.set(false)
      }
      main.postDelayed(this, 80)
    }
  }

  private data class NRect(val x: Float, val y: Float, val w: Float, val h: Float) {
    val cx: Float get() = x + w / 2f
    val cy: Float get() = y + h / 2f
    fun clipped(): NRect? {
      val x0 = x.coerceIn(0f, 1f)
      val y0 = y.coerceIn(0f, 1f)
      val x1 = (x + w).coerceIn(0f, 1f)
      val y1 = (y + h).coerceIn(0f, 1f)
      if (x1 - x0 <= 0.002f || y1 - y0 <= 0.002f) return null
      return NRect(x0, y0, x1 - x0, y1 - y0)
    }
    fun union(o: NRect): NRect {
      val x0 = minOf(x, o.x)
      val y0 = minOf(y, o.y)
      val x1 = maxOf(x + w, o.x + o.w)
      val y1 = maxOf(y + h, o.y + o.h)
      return NRect(x0, y0, x1 - x0, y1 - y0)
    }
    fun toMap(): Map<String, Double> = mapOf("x" to x.toDouble(), "y" to y.toDouble(), "w" to w.toDouble(), "h" to h.toDouble())
  }

  private fun rectOf(xs: List<Float>, ys: List<Float>, padX: Float, padY: Float): NRect? {
    if (xs.isEmpty() || ys.isEmpty()) return null
    val x0 = xs.minOrNull()!! - padX
    val y0 = ys.minOrNull()!! - padY
    val x1 = xs.maxOrNull()!! + padX
    val y1 = ys.maxOrNull()!! + padY
    if (x1 - x0 <= 0.001f || y1 - y0 <= 0.001f) return null
    return NRect(x0, y0, x1 - x0, y1 - y0)
  }

  private fun grabBodies() {
    val view = bodiesPreview
    if (view == null || !view.isAttachedToWindow || view.width <= 0 || view.height <= 0) {
      bodiesPreview = findPreview()
      return
    }
    if (!bodiesBusy.compareAndSet(false, true)) return
    val full = previewBitmap(view)
    if (full == null) {
      bodiesBusy.set(false)
      return
    }
    val vw = view.width
    val vh = view.height
    worker.execute {
      var small: Bitmap? = null
      try {
        // Detect on a small copy: fast, and plenty for people boxes.
        val target = 480f
        val scale = if (full.width > target) target / full.width else 1f
        val img = if (scale < 1f) {
          Bitmap.createScaledBitmap(full, maxOf(1, (full.width * scale).toInt()), maxOf(1, (full.height * scale).toInt()), true)
        } else {
          full
        }
        small = img
        val image = InputImage.fromBitmap(img, 0)
        val pose: Pose? = try { Tasks.await(streamPoseDetector.process(image)) } catch (_: Throwable) { null }
        val faces: List<Face> = try { Tasks.await(bodyFaceDetector.process(image)) } catch (_: Throwable) { emptyList() }
        if (!bodiesRunning) return@execute
        val list = liveBodies(pose, faces, img.width.toFloat(), img.height.toFloat())
        if (list.isEmpty()) {
          if (!bodiesLastEmpty) {
            bodiesLastEmpty = true
            emitBodies(list, vw, vh)
          }
        } else {
          bodiesLastEmpty = false
          emitBodies(list, vw, vh)
        }
      } catch (_: Throwable) {
        // skip this frame
      } finally {
        try {
          val s = small
          if (s != null && s !== full) s.recycle()
          full.recycle()
        } catch (_: Throwable) {}
        bodiesBusy.set(false)
      }
    }
  }

  private fun emitBodies(bodies: List<Map<String, Any?>>, w: Int, h: Int) {
    try {
      sendEvent("onLiveBodies", mapOf("bodies" to bodies, "layerW" to w.toDouble(), "layerH" to h.toDouble()))
    } catch (_: Throwable) {}
  }

  private fun liveBodies(pose: Pose?, faces: List<Face>, w: Float, h: Float): List<Map<String, Any?>> {
    if (w < 1f || h < 1f) return emptyList()
    val faceRects = faces.mapNotNull { f ->
      val b = f.boundingBox
      if (b.width() <= 2 || b.height() <= 2) null
      else Pair(f.trackingId ?: -1, NRect(b.left / w, b.top / h, b.width() / w, b.height() / h))
    }
    val used = mutableSetOf<Int>()
    val out = mutableListOf<Map<String, Any?>>()

    // The pose person (ML Kit pose tracks one, the most prominent).
    if (pose != null) {
      val visible = pose.allPoseLandmarks.filter { it.inFrameLikelihood >= 0.5f }
      val shoulders = listOf(PoseLandmark.LEFT_SHOULDER, PoseLandmark.RIGHT_SHOULDER).count { type ->
        (pose.getPoseLandmark(type)?.inFrameLikelihood ?: 0f) >= 0.5f
      }
      if (visible.size >= 6 && shoulders >= 1) {
        val xs = visible.map { it.position.x / w }
        val ys = visible.map { it.position.y / h }
        var box = rectOf(xs, ys, 0.03f, 0.04f)
        if (box != null) {
          // Head: the face inside the top of the box, else the face landmarks of the pose.
          var head: NRect? = null
          var bestArea = 0f
          var bestIdx = -1
          for ((i, fr) in faceRects.withIndex()) {
            val r = fr.second
            if (r.cx < box.x || r.cx > box.x + box.w) continue
            if (r.cy < box.y - box.h * 0.05f || r.cy > box.y + box.h * 0.45f) continue
            val area = r.w * r.h
            if (area > bestArea) {
              bestArea = area
              bestIdx = i
            }
          }
          if (bestIdx >= 0) {
            used.add(bestIdx)
            head = faceRects[bestIdx].second
          } else {
            val headTypes = listOf(PoseLandmark.NOSE, PoseLandmark.LEFT_EYE, PoseLandmark.RIGHT_EYE, PoseLandmark.LEFT_EAR, PoseLandmark.RIGHT_EAR)
            val pts = headTypes.mapNotNull { type ->
              val l = pose.getPoseLandmark(type)
              if (l == null || l.inFrameLikelihood < 0.5f) null else PointF(l.position.x / w, l.position.y / h)
            }
            if (pts.isNotEmpty()) {
              val pad = maxOf(0.015f, box.w * 0.12f)
              head = rectOf(pts.map { it.x }, pts.map { it.y }, pad, pad * 1.3f)
            }
          }
          val hd = head
          if (hd != null) box = box.union(hd)
          val clipped = box.clipped()
          if (clipped != null) {
            val conf = visible.map { it.inFrameLikelihood.toDouble() }.average()
            out.add(
              mapOf(
                "id" to 0,
                "x" to clipped.x.toDouble(),
                "y" to clipped.y.toDouble(),
                "w" to clipped.w.toDouble(),
                "h" to clipped.h.toDouble(),
                "head" to hd?.clipped()?.toMap(),
                "conf" to conf,
                "kind" to "pose",
              )
            )
          }
        }
      }
    }

    // Everyone else the camera sees a face of: a body box estimated from the face.
    for ((i, fr) in faceRects.withIndex()) {
      if (used.contains(i) || out.size >= 8) continue
      val r = fr.second
      val body = NRect(r.x - r.w * 0.9f, r.y - r.h * 0.15f, r.w * 2.8f, r.h * 7.5f).clipped() ?: continue
      out.add(
        mapOf(
          "id" to (if (fr.first >= 0) fr.first + 1000 else -1),
          "x" to body.x.toDouble(),
          "y" to body.y.toDouble(),
          "w" to body.w.toDouble(),
          "h" to body.h.toDouble(),
          "head" to r.clipped()?.toMap(),
          "conf" to 0.6,
          "kind" to "face",
        )
      )
    }
    return out
  }

  // --- stills ----------------------------------------------------------------------------

  private fun fileFor(uri: String): File? {
    val path = if (uri.startsWith("file://")) Uri.parse(uri).path else if (uri.startsWith("/")) uri else null
    return path?.let { File(it) }
  }

  private fun detectStill(uri: String): List<Map<String, Any?>> {
    val file = fileFor(uri) ?: return emptyList()
    val bmp = loadUpright(file) ?: return emptyList()
    val w = bmp.width.toFloat()
    val h = bmp.height.toFloat()
    val faces = Tasks.await(stillDetector.process(InputImage.fromBitmap(bmp, 0)))
    val out = faces.mapNotNull { f ->
      val b = f.boundingBox
      if (b.width() <= 2) return@mapNotNull null
      val lm = mutableMapOf<String, Any?>()
      fun put(name: String, type: Int) {
        val p = f.getLandmark(type)?.position ?: return
        lm[name] = mapOf("x" to (p.x / w).toDouble(), "y" to (p.y / h).toDouble())
      }
      put("nose", FaceLandmark.NOSE_BASE)
      put("leftEye", FaceLandmark.LEFT_EYE)
      put("rightEye", FaceLandmark.RIGHT_EYE)
      mapOf(
        "box" to mapOf(
          "x" to (b.left / w).toDouble().coerceIn(0.0, 1.0),
          "y" to (b.top / h).toDouble().coerceIn(0.0, 1.0),
          "w" to (b.width() / w).toDouble().coerceIn(0.0, 1.0),
          "h" to (b.height() / h).toDouble().coerceIn(0.0, 1.0),
        ),
        "landmarks" to if (lm.size == 3) lm else null,
        "confidence" to 0.9,
        "imageWidth" to w.toDouble(),
        "imageHeight" to h.toDouble(),
      )
    }
    bmp.recycle()
    return out
  }

  // --- bodies (Laser Tag) ------------------------------------------------------------------

  private val jointNames = mapOf(
    PoseLandmark.NOSE to "nose",
    PoseLandmark.LEFT_EYE to "left_eye", PoseLandmark.RIGHT_EYE to "right_eye",
    PoseLandmark.LEFT_EAR to "left_ear", PoseLandmark.RIGHT_EAR to "right_ear",
    PoseLandmark.LEFT_SHOULDER to "left_shoulder", PoseLandmark.RIGHT_SHOULDER to "right_shoulder",
    PoseLandmark.LEFT_ELBOW to "left_elbow", PoseLandmark.RIGHT_ELBOW to "right_elbow",
    PoseLandmark.LEFT_WRIST to "left_wrist", PoseLandmark.RIGHT_WRIST to "right_wrist",
    PoseLandmark.LEFT_HIP to "left_hip", PoseLandmark.RIGHT_HIP to "right_hip",
    PoseLandmark.LEFT_KNEE to "left_knee", PoseLandmark.RIGHT_KNEE to "right_knee",
    PoseLandmark.LEFT_ANKLE to "left_ankle", PoseLandmark.RIGHT_ANKLE to "right_ankle",
  )

  private fun normRect(xs: List<Float>, ys: List<Float>, padX: Float, padY: Float): Map<String, Double>? {
    if (xs.isEmpty() || ys.isEmpty()) return null
    val x0 = (xs.minOrNull()!! - padX).coerceIn(0f, 1f)
    val y0 = (ys.minOrNull()!! - padY).coerceIn(0f, 1f)
    val x1 = (xs.maxOrNull()!! + padX).coerceIn(0f, 1f)
    val y1 = (ys.maxOrNull()!! + padY).coerceIn(0f, 1f)
    if (x1 - x0 <= 0.001f || y1 - y0 <= 0.001f) return null
    return mapOf("x" to x0.toDouble(), "y" to y0.toDouble(), "w" to (x1 - x0).toDouble(), "h" to (y1 - y0).toDouble())
  }

  private fun detectBodiesStill(uri: String): List<Map<String, Any?>> {
    val file = fileFor(uri) ?: return emptyList()
    val bmp = loadUpright(file) ?: return emptyList()
    val w = bmp.width.toFloat()
    val h = bmp.height.toFloat()
    val pose: Pose = try {
      Tasks.await(poseDetector.process(InputImage.fromBitmap(bmp, 0)))
    } finally {
      bmp.recycle()
    }
    val visible = pose.allPoseLandmarks.filter { it.inFrameLikelihood >= 0.5f }
    if (visible.size < 6) return emptyList()

    fun pt(type: Int): PointF? {
      val l = pose.getPoseLandmark(type) ?: return null
      if (l.inFrameLikelihood < 0.5f) return null
      return PointF(l.position.x / w, l.position.y / h)
    }

    val all = visible.map { PointF(it.position.x / w, it.position.y / h) }
    val box = normRect(all.map { it.x }, all.map { it.y }, 0.03f, 0.05f) ?: return emptyList()

    // Shoulder width sets the scale for the head box.
    val ls = pt(PoseLandmark.LEFT_SHOULDER)
    val rs = pt(PoseLandmark.RIGHT_SHOULDER)
    val shoulderW = if (ls != null && rs != null) Math.abs(ls.x - rs.x) else (box["w"] ?: 0.2).toFloat() * 0.5f

    val headPts = listOfNotNull(
      pt(PoseLandmark.NOSE), pt(PoseLandmark.LEFT_EYE), pt(PoseLandmark.RIGHT_EYE),
      pt(PoseLandmark.LEFT_EAR), pt(PoseLandmark.RIGHT_EAR),
    )
    val headPad = maxOf(0.01f, shoulderW * 0.22f)
    val head = if (headPts.isNotEmpty()) normRect(headPts.map { it.x }, headPts.map { it.y }, headPad, headPad * 1.3f) else null

    val torsoPts = listOfNotNull(ls, rs, pt(PoseLandmark.LEFT_HIP), pt(PoseLandmark.RIGHT_HIP))
    val torso = if (torsoPts.size >= 3) normRect(torsoPts.map { it.x }, torsoPts.map { it.y }, shoulderW * 0.1f, shoulderW * 0.1f) else null

    val joints = mutableMapOf<String, Any?>()
    for ((type, name) in jointNames) {
      val p = pt(type) ?: continue
      joints[name] = mapOf("x" to p.x.toDouble(), "y" to p.y.toDouble())
    }

    val confidence = visible.map { it.inFrameLikelihood.toDouble() }.average()
    return listOf(
      mapOf(
        "box" to box,
        "head" to head,
        "torso" to torso,
        "joints" to joints,
        "confidence" to confidence,
        "source" to "pose",
        "imageWidth" to w.toDouble(),
        "imageHeight" to h.toDouble(),
      )
    )
  }

  // Decodes a downscaled bitmap with its EXIF rotation applied (so it is upright, like what
  // the camera showed). Coordinates are for the unmirrored photo; JS mirrors for selfies.
  private fun loadUpright(file: File): Bitmap? {
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeFile(file.absolutePath, bounds)
    if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null
    var sample = 1
    while (maxOf(bounds.outWidth, bounds.outHeight) / (sample * 2) >= 720) sample *= 2
    val bmp = BitmapFactory.decodeFile(file.absolutePath, BitmapFactory.Options().apply { inSampleSize = sample }) ?: return null
    val rotation = try {
      when (ExifInterface(file.absolutePath).getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL)) {
        ExifInterface.ORIENTATION_ROTATE_90 -> 90f
        ExifInterface.ORIENTATION_ROTATE_180 -> 180f
        ExifInterface.ORIENTATION_ROTATE_270 -> 270f
        else -> 0f
      }
    } catch (_: Throwable) { 0f }
    if (rotation == 0f) return bmp
    val m = Matrix().apply { postRotate(rotation) }
    val rotated = Bitmap.createBitmap(bmp, 0, 0, bmp.width, bmp.height, m, true)
    if (rotated !== bmp) bmp.recycle()
    return rotated
  }
}
