package expo.modules.dualcamera

import android.content.Context
import android.hardware.camera2.CameraCharacteristics
import android.hardware.camera2.CameraManager
import android.os.Build
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

// Android side of `dual-camera`:
//  - DualCamera view: back camera full screen + front-camera bubble at the same time (CameraX
//    concurrent camera, Android 11+ on phones whose maker enabled it). isSupported() is false
//    elsewhere, and JS never shows the toggle.
//  - Gameplay recording: iOS only for now (see isRecordingSupported).
class DualCameraModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw IllegalStateException("No React context")

  override fun definition() = ModuleDefinition {
    Name("DualCamera")

    Function("isSupported") {
      supportsConcurrentFrontBack(context)
    }

    // Gameplay recording is off on Android (players can use Android's built-in screen
    // recorder). JS hides the REC button when this is false.
    Function("isRecordingSupported") {
      false
    }

    AsyncFunction("startRecording") { _: Boolean, promise: Promise ->
      promise.reject("E_REC_UNAVAILABLE", "Use Android's built-in screen recorder", null)
    }

    AsyncFunction("stopRecording") { promise: Promise ->
      promise.resolve(null)
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
