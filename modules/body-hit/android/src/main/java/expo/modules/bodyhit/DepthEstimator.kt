package expo.modules.bodyhit

import android.content.Context
import android.graphics.Bitmap
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.Build
import android.os.SystemClock
import org.tensorflow.lite.DataType
import org.tensorflow.lite.Interpreter
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.security.MessageDigest
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

// Surface scanner for Laser Tag cover (walls, buildings, objects): monocular depth from one
// camera frame with the official MiDaS v2.1 small TFLite model (isl-org/MiDaS release v2_1,
// model_opt.tflite: 256 x 256 RGB float in, 256 x 256 relative inverse depth out).
//
// The model is DATA, downloaded once on demand into noBackupFilesDir/bodyhit-depth. The
// download streams into a .part file and resumes from its length (HTTP Range) after a failure,
// a kill or the next launch; it only runs on an unmetered network (Wi-Fi) until `cellularAfter`
// Laser Tag sessions have waited for one. The finished file must match the expected byte size
// and SHA-256, or it is deleted. Then a LiteRT (TensorFlow Lite) Interpreter runs it on a
// background thread.
//
// estimate() -> { w, h, data (row-major, top row first), imageWidth, imageHeight, source,
// space, kind, ms }: the 256 x 256 output averaged over a 24 x 32 (portrait) / 32 x 24 grid.
internal class DepthEstimator private constructor(private val context: Context) {
  companion object {
    // Official MiDaS v2.1 small TFLite release asset.
    const val MODEL_URL = "https://github.com/isl-org/MiDaS/releases/download/v2_1/model_opt.tflite"
    const val MODEL_SIZE = 66_338_288L
    const val MODEL_SHA256 = "93d871071edff1218973ce25ee27ce95ccd20450c70a55e1b89efa3f5a772cdd"
    const val MODEL_NAME = "midas-v2_1-small-256"
    private const val FILE_NAME = "midas_v21_small_256.tflite"
    private const val INPUT = 256
    private const val GRID_LONG = 32
    private const val GRID_SHORT = 24
    private const val PREFS = "bodyhit_depth"
    private const val KEY_WAITS = "wifiWaits"

    // downloadInto() results
    private const val DL_OK = 0
    private const val DL_FAILED = 1
    private const val DL_WAIT_WIFI = 2

    @Volatile private var instance: DepthEstimator? = null

    fun get(context: Context): DepthEstimator {
      val existing = instance
      if (existing != null) return existing
      return synchronized(this) {
        instance ?: DepthEstimator(context.applicationContext).also { instance = it }
      }
    }
  }

  private val io = Executors.newSingleThreadExecutor()
  private val infer = Executors.newSingleThreadExecutor()
  private val lock = Any()
  private val busy = AtomicBoolean(false)
  private val working = AtomicBoolean(false)
  @Volatile private var state = "idle"
  @Volatile private var error: String? = null
  @Volatile private var bytes = 0L
  @Volatile private var countedWait = false
  // Guarded by `lock`.
  private var interpreter: Interpreter? = null
  private var inputBuf: ByteBuffer? = null
  private var outputBuf: ByteBuffer? = null

  fun isReady(): Boolean = state == "ready"

  fun isBusy(): Boolean = busy.get()

  fun status(): Map<String, Any?> = mapOf(
    "state" to state,
    "bytes" to bytes.toDouble(),
    "total" to MODEL_SIZE.toDouble(),
    "progress" to (bytes.toDouble() / MODEL_SIZE.toDouble()).coerceIn(0.0, 1.0),
    "model" to MODEL_NAME,
    "lidar" to false,
    "lidarUsed" to false,
    "error" to error,
  )

  // Starts (or resumes) getting the model ready in the background. Returns at once.
  fun prepare(cellularAfter: Int) {
    if (state == "ready") return
    if (!working.compareAndSet(false, true)) return
    io.execute {
      try {
        run(cellularAfter)
      } catch (t: Throwable) {
        finish("failed", t.javaClass.simpleName)
      }
    }
  }

  // Runs `block` on the inference thread (decoding a photo there keeps the live trackers free).
  // Returns false when it could not be queued.
  fun post(block: () -> Unit): Boolean {
    return try {
      infer.execute {
        try { block() } catch (_: Throwable) {}
      }
      true
    } catch (_: Throwable) {
      false
    }
  }

  private fun finish(s: String, err: String?) {
    state = s
    error = err
    working.set(false)
  }

  private fun run(cellularAfter: Int) {
    val dir = File(context.noBackupFilesDir, "bodyhit-depth")
    if (!dir.exists()) dir.mkdirs()
    val model = File(dir, FILE_NAME)
    val part = File(dir, "$FILE_NAME.part")
    // Only a verified download ever gets the final name.
    if (model.exists() && model.length() == MODEL_SIZE) {
      bytes = MODEL_SIZE
      if (loadModel(model)) finish("ready", null) else finish("failed", "load")
      return
    }
    if (model.exists()) model.delete()

    val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    val waits = prefs.getInt(KEY_WAITS, 0)
    val cellular = waits >= maxOf(0, cellularAfter)
    bytes = if (part.exists()) part.length() else 0L
    if (!cellular && !onUnmeteredNetwork()) {
      waitForWifi(prefs, waits)
      return
    }
    state = "downloading"
    var attempt = 0
    while (true) {
      val res = try { downloadInto(part, cellular) } catch (_: Throwable) { DL_FAILED }
      if (res == DL_OK) break
      if (res == DL_WAIT_WIFI) {
        waitForWifi(prefs, waits)
        return
      }
      attempt++
      if (attempt >= 4) {
        finish("failed", "network")
        return
      }
      Thread.sleep(5000L * attempt * attempt)
      if (!cellular && !onUnmeteredNetwork()) {
        waitForWifi(prefs, waits)
        return
      }
    }
    if (part.length() != MODEL_SIZE || sha256(part) != MODEL_SHA256) {
      part.delete()
      bytes = 0L
      finish("failed", "integrity")
      return
    }
    if (!part.renameTo(model)) {
      finish("failed", "write")
      return
    }
    bytes = MODEL_SIZE
    if (loadModel(model)) finish("ready", null) else finish("failed", "load")
  }

  private fun waitForWifi(prefs: android.content.SharedPreferences, waits: Int) {
    if (!countedWait) {
      countedWait = true
      prefs.edit().putInt(KEY_WAITS, waits + 1).apply()
    }
    finish("waiting-wifi", null)
  }

  private fun onUnmeteredNetwork(): Boolean {
    return try {
      val cm = context.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager
      val net = cm?.activeNetwork
      val caps = if (cm != null && net != null) cm.getNetworkCapabilities(net) else null
      caps?.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_METERED) == true
    } catch (_: Throwable) {
      false
    }
  }

  // Appends the rest of the file to `part` (HTTP Range from its current length).
  private fun downloadInto(part: File, cellular: Boolean): Int {
    var offset = if (part.exists()) part.length() else 0L
    if (offset > MODEL_SIZE) {
      part.delete()
      offset = 0L
    }
    if (offset == MODEL_SIZE) return DL_OK
    val conn = URL(MODEL_URL).openConnection() as HttpURLConnection
    try {
      conn.connectTimeout = 20_000
      conn.readTimeout = 30_000
      conn.instanceFollowRedirects = true
      conn.setRequestProperty("Range", "bytes=$offset-")
      conn.setRequestProperty("Accept-Encoding", "identity")
      val code = conn.responseCode
      val append: Boolean
      if (code == 206) {
        val range = conn.getHeaderField("Content-Range") ?: ""
        val start = Regex("bytes\\s+(\\d+)-").find(range)?.groupValues?.getOrNull(1)?.toLongOrNull()
        if (start != null && start != offset) return DL_FAILED
        append = true
      } else if (code == 200) {
        // The server ignored the range: start over from the first byte.
        offset = 0L
        append = false
      } else {
        return DL_FAILED
      }
      var written = offset
      bytes = written
      conn.inputStream.use { input ->
        FileOutputStream(part, append).use { out ->
          val buf = ByteArray(64 * 1024)
          var sinceCheck = 0L
          while (true) {
            val n = input.read(buf)
            if (n < 0) break
            if (written + n > MODEL_SIZE) return DL_FAILED
            out.write(buf, 0, n)
            written += n
            bytes = written
            sinceCheck += n
            if (sinceCheck >= 4L * 1024 * 1024) {
              sinceCheck = 0L
              if (!cellular && !onUnmeteredNetwork()) return DL_WAIT_WIFI
            }
          }
          out.flush()
        }
      }
      return if (part.length() == MODEL_SIZE) DL_OK else DL_FAILED
    } finally {
      try { conn.disconnect() } catch (_: Throwable) {}
    }
  }

  private fun sha256(file: File): String {
    val md = MessageDigest.getInstance("SHA-256")
    FileInputStream(file).use { input ->
      val buf = ByteArray(256 * 1024)
      while (true) {
        val n = input.read(buf)
        if (n < 0) break
        md.update(buf, 0, n)
      }
    }
    val sb = StringBuilder()
    for (b in md.digest()) sb.append(String.format("%02x", b.toInt() and 0xff))
    return sb.toString()
  }

  private fun loadModel(file: File): Boolean {
    return try {
      val opts = Interpreter.Options().setNumThreads(4)
      val interp = Interpreter(file, opts)
      val inT = interp.getInputTensor(0)
      val outT = interp.getOutputTensor(0)
      val inShape = inT.shape()
      val outShape = outT.shape()
      val ok = inT.dataType() == DataType.FLOAT32 && outT.dataType() == DataType.FLOAT32 &&
        inShape.contentEquals(intArrayOf(1, INPUT, INPUT, 3)) &&
        outShape.size >= 3 && outShape[1] == INPUT && outShape[2] == INPUT &&
        outT.numElements() == INPUT * INPUT
      if (!ok) {
        interp.close()
        false
      } else {
        synchronized(lock) {
          try { interpreter?.close() } catch (_: Throwable) {}
          interpreter = interp
          inputBuf = ByteBuffer.allocateDirect(INPUT * INPUT * 3 * 4).order(ByteOrder.nativeOrder())
          outputBuf = ByteBuffer.allocateDirect(INPUT * INPUT * 4).order(ByteOrder.nativeOrder())
        }
        true
      }
    } catch (_: Throwable) {
      false
    }
  }

  // One frame at a time; a request while one runs (or before the model is ready) gets null.
  // `bmp` is recycled when `recycle` is true. `done` runs on the inference thread.
  fun estimate(bmp: Bitmap, space: String, recycle: Boolean, done: (Map<String, Any?>?) -> Unit) {
    if (!isReady() || !busy.compareAndSet(false, true)) {
      if (recycle) {
        try { bmp.recycle() } catch (_: Throwable) {}
      }
      done(null)
      return
    }
    try {
      infer.execute {
        var out: Map<String, Any?>? = null
        try {
          out = runModel(bmp, space)
        } catch (_: Throwable) {
          out = null
        } finally {
          if (recycle) {
            try { bmp.recycle() } catch (_: Throwable) {}
          }
          busy.set(false)
        }
        done(out)
      }
    } catch (_: Throwable) {
      busy.set(false)
      done(null)
    }
  }

  private fun runModel(src: Bitmap, space: String): Map<String, Any?>? {
    val started = SystemClock.elapsedRealtime()
    val iw = src.width
    val ih = src.height
    if (iw < 8 || ih < 8) return null
    val soft = if (Build.VERSION.SDK_INT >= 26 && src.config == Bitmap.Config.HARDWARE) {
      src.copy(Bitmap.Config.ARGB_8888, false) ?: return null
    } else {
      src
    }
    // Stretch the whole frame into the model's square input (no crop: every grid cell maps
    // straight back onto the frame).
    val scaled = Bitmap.createScaledBitmap(soft, INPUT, INPUT, true)
    val pixels = IntArray(INPUT * INPUT)
    scaled.getPixels(pixels, 0, INPUT, 0, 0, INPUT, INPUT)
    if (scaled !== soft) scaled.recycle()
    if (soft !== src) soft.recycle()

    val values = FloatArray(INPUT * INPUT)
    synchronized(lock) {
      val interp = interpreter ?: return null
      val input = inputBuf ?: return null
      val output = outputBuf ?: return null
      input.rewind()
      for (p in pixels) {
        // ImageNet normalisation, RGB order (MiDaS).
        input.putFloat((((p shr 16) and 0xff) / 255f - 0.485f) / 0.229f)
        input.putFloat((((p shr 8) and 0xff) / 255f - 0.456f) / 0.224f)
        input.putFloat(((p and 0xff) / 255f - 0.406f) / 0.225f)
      }
      input.rewind()
      output.rewind()
      interp.run(input, output)
      output.rewind()
      output.asFloatBuffer().get(values)
    }

    val portrait = ih >= iw
    val gw = if (portrait) GRID_SHORT else GRID_LONG
    val gh = if (portrait) GRID_LONG else GRID_SHORT
    val grid = ArrayList<Double>(gw * gh)
    for (gy in 0 until gh) {
      val y0 = gy * INPUT / gh
      val y1 = maxOf(y0 + 1, (gy + 1) * INPUT / gh)
      for (gx in 0 until gw) {
        val x0 = gx * INPUT / gw
        val x1 = maxOf(x0 + 1, (gx + 1) * INPUT / gw)
        var sum = 0.0
        var n = 0
        for (y in y0 until y1) {
          for (x in x0 until x1) {
            val v = values[y * INPUT + x]
            if (!v.isNaN() && !v.isInfinite()) {
              sum += v.toDouble()
              n++
            }
          }
        }
        if (n == 0) return null
        grid.add(sum / n)
      }
    }
    return mapOf(
      "w" to gw,
      "h" to gh,
      "data" to grid,
      "imageWidth" to iw.toDouble(),
      "imageHeight" to ih.toDouble(),
      "source" to "model",
      "space" to space,
      "kind" to "inverse",
      "ms" to (SystemClock.elapsedRealtime() - started).toDouble(),
    )
  }
}
