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
// detectBodies (Laser Tag) is iOS-only, so it is not defined here: JS falls back to aiming.
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

  override fun definition() = ModuleDefinition {
    Name("BodyHit")

    Events("onLiveFaces")

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
