package expo.modules.dualcamera

import android.app.Activity
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.hardware.display.DisplayManager
import android.hardware.display.VirtualDisplay
import android.media.MediaRecorder
import android.media.projection.MediaProjection
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.util.DisplayMetrics
import android.view.WindowManager
import java.io.File

// Records the screen (+ your voice) while Laser Tag is open. Android requires screen capture to
// run inside a foreground service with a visible notification.
class ScreenRecordService : Service() {
  companion object {
    const val ACTION_START = "expo.modules.dualcamera.START"
    const val ACTION_STOP = "expo.modules.dualcamera.STOP"
    const val EXTRA_RESULT_CODE = "resultCode"
    const val EXTRA_DATA = "data"
    const val EXTRA_MIC = "mic"
    private const val CHANNEL = "iyiyi_recording"
    private const val NOTIF_ID = 0x1D0D

    @Volatile var isRecording = false
    var onStarted: ((Boolean, String?) -> Unit)? = null
    var onStopped: ((String?) -> Unit)? = null
  }

  private val main = Handler(Looper.getMainLooper())
  private var projection: MediaProjection? = null
  private var display: VirtualDisplay? = null
  private var recorder: MediaRecorder? = null
  private var output: File? = null

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    when (intent?.action) {
      ACTION_START -> start(intent)
      ACTION_STOP -> stop()
    }
    return START_NOT_STICKY
  }

  private fun notification(): Notification {
    val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && nm.getNotificationChannel(CHANNEL) == null) {
      nm.createNotificationChannel(NotificationChannel(CHANNEL, "Gameplay recording", NotificationManager.IMPORTANCE_LOW))
    }
    val b = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) Notification.Builder(this, CHANNEL) else @Suppress("DEPRECATION") Notification.Builder(this)
    return b.setContentTitle("Recording gameplay")
      .setContentText("iYiYi is recording your screen")
      .setSmallIcon(android.R.drawable.presence_video_online)
      .setOngoing(true)
      .build()
  }

  private fun start(intent: Intent) {
    val cb = onStarted
    onStarted = null
    try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        startForeground(NOTIF_ID, notification(), ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION)
      } else {
        startForeground(NOTIF_ID, notification())
      }
      val resultCode = intent.getIntExtra(EXTRA_RESULT_CODE, Activity.RESULT_CANCELED)
      @Suppress("DEPRECATION")
      val data: Intent? = if (Build.VERSION.SDK_INT >= 33) intent.getParcelableExtra(EXTRA_DATA, Intent::class.java) else intent.getParcelableExtra(EXTRA_DATA)
      val mic = intent.getBooleanExtra(EXTRA_MIC, false)
      if (data == null) throw IllegalStateException("Missing capture permission")

      val metrics = DisplayMetrics()
      @Suppress("DEPRECATION")
      (getSystemService(Context.WINDOW_SERVICE) as WindowManager).defaultDisplay.getRealMetrics(metrics)
      // Encode at up to 1080 px wide (even sizes for the encoder).
      val scale = minOf(1f, 1080f / metrics.widthPixels)
      val w = ((metrics.widthPixels * scale).toInt() / 2) * 2
      val h = ((metrics.heightPixels * scale).toInt() / 2) * 2

      val file = File(cacheDir, "iyiyi-gameplay-${System.currentTimeMillis()}.mp4")
      val rec = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) MediaRecorder(this) else @Suppress("DEPRECATION") MediaRecorder()
      if (mic) rec.setAudioSource(MediaRecorder.AudioSource.MIC)
      rec.setVideoSource(MediaRecorder.VideoSource.SURFACE)
      rec.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
      rec.setVideoEncoder(MediaRecorder.VideoEncoder.H264)
      if (mic) {
        rec.setAudioEncoder(MediaRecorder.AudioEncoder.AAC)
        rec.setAudioEncodingBitRate(128_000)
        rec.setAudioSamplingRate(44_100)
      }
      rec.setVideoSize(w, h)
      rec.setVideoFrameRate(30)
      rec.setVideoEncodingBitRate(6_000_000)
      rec.setOutputFile(file.absolutePath)
      rec.prepare()

      val mpm = getSystemService(Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
      val proj = mpm.getMediaProjection(resultCode, data) ?: throw IllegalStateException("Capture not allowed")
      // Android 14+: a callback must be registered before creating the virtual display.
      proj.registerCallback(object : MediaProjection.Callback() {
        override fun onStop() {
          main.post { if (isRecording) stop() }
        }
      }, main)
      display = proj.createVirtualDisplay(
        "iyiyi-gameplay", w, h, metrics.densityDpi,
        DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR, rec.surface, null, main,
      )
      rec.start()
      recorder = rec
      projection = proj
      output = file
      isRecording = true
      cb?.invoke(true, null)
    } catch (e: Throwable) {
      cleanup()
      cb?.invoke(false, e.message)
      stopSelfSafely()
    }
  }

  private fun stop() {
    val cb = onStopped
    onStopped = null
    var path: String? = null
    try {
      recorder?.stop()
      path = output?.absolutePath
    } catch (_: Throwable) {
      // stop() throws if nothing was recorded (too short)
      try { output?.delete() } catch (_: Throwable) {}
    }
    cleanup()
    cb?.invoke(path)
    stopSelfSafely()
  }

  private fun cleanup() {
    isRecording = false
    try { recorder?.release() } catch (_: Throwable) {}
    try { display?.release() } catch (_: Throwable) {}
    try { projection?.stop() } catch (_: Throwable) {}
    recorder = null
    display = null
    projection = null
  }

  private fun stopSelfSafely() {
    try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) stopForeground(STOP_FOREGROUND_REMOVE) else @Suppress("DEPRECATION") stopForeground(true)
    } catch (_: Throwable) {}
    stopSelf()
  }

  override fun onDestroy() {
    if (isRecording) stop()
    super.onDestroy()
  }
}
