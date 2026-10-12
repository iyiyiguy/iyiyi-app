package expo.modules.dualcamera

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.hardware.camera2.CameraCharacteristics
import android.hardware.camera2.CameraManager
import android.media.projection.MediaProjectionManager
import android.os.Build
import androidx.core.content.ContextCompat
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

// Android side of `dual-camera`:
//  - DualCamera view: back camera full screen + front-camera bubble at the same time (CameraX
//    concurrent camera, Android 11+ on phones whose maker enabled it). isSupported() is false
//    elsewhere, and JS never shows the toggle.
//  - Gameplay recording: the screen + your voice via MediaProjection in a foreground service.
//    Android shows its own "start recording?" prompt every time.
class DualCameraModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw IllegalStateException("No React context")

  private var pendingStart: Promise? = null
  private var pendingMic = true

  override fun definition() = ModuleDefinition {
    Name("DualCamera")

    Function("isSupported") {
      supportsConcurrentFrontBack(context)
    }

    Function("isRecordingSupported") {
      Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q
    }

    AsyncFunction("startRecording") { mic: Boolean, promise: Promise ->
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
        promise.reject("E_REC_UNAVAILABLE", "Recording needs Android 10 or newer", null)
        return@AsyncFunction
      }
      if (ScreenRecordService.isRecording) {
        promise.resolve(true)
        return@AsyncFunction
      }
      val activity: Activity? = appContext.currentActivity
      if (activity == null) {
        promise.reject("E_REC_START", "No activity", null)
        return@AsyncFunction
      }
      pendingStart?.reject("E_REC_START", "Superseded", null)
      pendingStart = promise
      pendingMic = mic
      val mpm = activity.getSystemService(Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
      activity.runOnUiThread {
        try {
          activity.startActivityForResult(mpm.createScreenCaptureIntent(), REQUEST_CAPTURE)
        } catch (e: Throwable) {
          pendingStart = null
          promise.reject("E_REC_START", e.message ?: "Couldn't ask to record", e)
        }
      }
    }

    AsyncFunction("stopRecording") { promise: Promise ->
      if (!ScreenRecordService.isRecording) {
        promise.resolve(null)
        return@AsyncFunction
      }
      ScreenRecordService.onStopped = { path -> promise.resolve(path?.let { "file://$it" }) }
      val stop = Intent(context, ScreenRecordService::class.java).setAction(ScreenRecordService.ACTION_STOP)
      try {
        context.startService(stop)
      } catch (e: Throwable) {
        ScreenRecordService.onStopped = null
        promise.reject("E_REC_STOP", e.message ?: "Couldn't stop recording", e)
      }
    }

    OnActivityResult { _, payload ->
      if (payload.requestCode != REQUEST_CAPTURE) return@OnActivityResult
      val promise = pendingStart ?: return@OnActivityResult
      pendingStart = null
      val data = payload.data
      if (payload.resultCode != Activity.RESULT_OK || data == null) {
        promise.reject("E_REC_DENIED", "Recording wasn't allowed", null)
        return@OnActivityResult
      }
      val micGranted = pendingMic && ContextCompat.checkSelfPermission(context, android.Manifest.permission.RECORD_AUDIO) == android.content.pm.PackageManager.PERMISSION_GRANTED
      ScreenRecordService.onStarted = { ok, err ->
        if (ok) promise.resolve(true) else promise.reject("E_REC_START", err ?: "Couldn't start recording", null)
      }
      val start = Intent(context, ScreenRecordService::class.java)
        .setAction(ScreenRecordService.ACTION_START)
        .putExtra(ScreenRecordService.EXTRA_RESULT_CODE, payload.resultCode)
        .putExtra(ScreenRecordService.EXTRA_DATA, data)
        .putExtra(ScreenRecordService.EXTRA_MIC, micGranted)
      try {
        ContextCompat.startForegroundService(context, start)
      } catch (e: Throwable) {
        ScreenRecordService.onStarted = null
        promise.reject("E_REC_START", e.message ?: "Couldn't start recording", e)
      }
    }

    View(DualCameraView::class) {
      Events("onCameraReady", "onCameraError")

      Prop("selfieEnabled") { view: DualCameraView, enabled: Boolean ->
        view.setSelfieEnabled(enabled)
      }

      Prop("selfieFrame") { view: DualCameraView, frame: List<Double> ->
        view.setSelfieFrame(frame)
      }

      AsyncFunction("takePicture") { view: DualCameraView, quality: Double, promise: Promise ->
        view.takePicture(quality, promise)
      }
    }
  }

  companion object {
    private const val REQUEST_CAPTURE = 0x1D0C

    fun supportsConcurrentFrontBack(context: Context): Boolean {
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) return false
      return try {
        val cm = context.getSystemService(Context.CAMERA_SERVICE) as CameraManager
        cm.concurrentCameraIds.any { set ->
          var front = false
          var back = false
          for (id in set) {
            when (cm.getCameraCharacteristics(id).get(CameraCharacteristics.LENS_FACING)) {
              CameraCharacteristics.LENS_FACING_FRONT -> front = true
              CameraCharacteristics.LENS_FACING_BACK -> back = true
            }
          }
          front && back
        }
      } catch (_: Throwable) {
        false
      }
    }
  }
}
