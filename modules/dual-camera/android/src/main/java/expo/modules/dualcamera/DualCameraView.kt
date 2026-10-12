package expo.modules.dualcamera

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.Outline
import android.graphics.drawable.GradientDrawable
import android.os.Handler
import android.os.Looper
import android.view.View
import android.view.ViewOutlineProvider
import android.widget.FrameLayout
import androidx.camera.core.CameraSelector
import androidx.camera.core.ConcurrentCamera
import androidx.camera.core.Preview
import androidx.camera.core.UseCaseGroup
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.core.content.ContextCompat
import androidx.lifecycle.LifecycleOwner
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.Promise
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView
import java.io.File
import java.io.FileOutputStream
import java.util.UUID
import java.util.concurrent.Executors

// Back camera full screen + front camera in a rounded bubble, both live (CameraX concurrent
// camera). Hit-detection "photos" are a copy of the back preview (exactly what's on screen),
// so no extra capture stream is needed.
class DualCameraView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  // RN doesn't lay out native children; let Android do it (ExpoView re-measures after requestLayout).
  override val shouldUseAndroidLayout = true

  private val onCameraReady by EventDispatcher<Map<String, Any>>()
  private val onCameraError by EventDispatcher<Map<String, Any>>()

  private val main = Handler(Looper.getMainLooper())
  private val io = Executors.newSingleThreadExecutor()
  private val density = resources.displayMetrics.density

  private val backView = PreviewView(context).apply {
    implementationMode = PreviewView.ImplementationMode.COMPATIBLE // TextureView: follows RN transforms
    scaleType = PreviewView.ScaleType.FILL_CENTER
  }
  private val frontView = PreviewView(context).apply {
    implementationMode = PreviewView.ImplementationMode.COMPATIBLE
    scaleType = PreviewView.ScaleType.FILL_CENTER
  }
  private val bubble = FrameLayout(context)

  private var provider: ProcessCameraProvider? = null
  private var bound = false
  private var selfieEnabled = true
  private var frame = floatArrayOf(12f, 220f, 104f, 140f) // dp: x, y, w, h

  init {
    setBackgroundColor(Color.BLACK)
    addView(backView)
    bubble.addView(frontView, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))
    bubble.clipToOutline = true
    bubble.outlineProvider = object : ViewOutlineProvider() {
      override fun getOutline(view: View, outline: Outline) {
        outline.setRoundRect(0, 0, view.width, view.height, 18 * density)
      }
    }
    bubble.foreground = GradientDrawable().apply {
      cornerRadius = 18 * density
      setStroke((2 * density).toInt(), Color.argb(217, 255, 255, 255))
      setColor(Color.TRANSPARENT)
    }
    addView(bubble)
    layoutBubble()
  }

  override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
    val w = MeasureSpec.getSize(widthMeasureSpec)
    val h = MeasureSpec.getSize(heightMeasureSpec)
    setMeasuredDimension(w, h)
    backView.measure(MeasureSpec.makeMeasureSpec(w, MeasureSpec.EXACTLY), MeasureSpec.makeMeasureSpec(h, MeasureSpec.EXACTLY))
  }

  override fun onLayout(changed: Boolean, l: Int, t: Int, r: Int, b: Int) {
    backView.layout(0, 0, r - l, b - t)
    layoutBubble()
  }

  private fun layoutBubble() {
    val x = (frame[0] * density).toInt()
    val y = (frame[1] * density).toInt()
    val w = (frame[2] * density).toInt()
    val h = (frame[3] * density).toInt()
    bubble.measure(MeasureSpec.makeMeasureSpec(w, MeasureSpec.EXACTLY), MeasureSpec.makeMeasureSpec(h, MeasureSpec.EXACTLY))
    bubble.layout(x, y, x + w, y + h)
    frontView.measure(MeasureSpec.makeMeasureSpec(w, MeasureSpec.EXACTLY), MeasureSpec.makeMeasureSpec(h, MeasureSpec.EXACTLY))
    frontView.layout(0, 0, w, h)
    bubble.invalidateOutline()
  }

  fun setSelfieEnabled(on: Boolean) {
    selfieEnabled = on
    bubble.visibility = if (on) View.VISIBLE else View.GONE
  }

  fun setSelfieFrame(f: List<Double>) {
    if (f.size != 4 || f.any { it.isNaN() || it.isInfinite() } || f[2] <= 0 || f[3] <= 0) return
    frame = floatArrayOf(f[0].toFloat(), f[1].toFloat(), f[2].toFloat(), f[3].toFloat())
    layoutBubble()
  }

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    // Give expo-camera's view (if it was just swapped out) a moment to release the camera.
    main.postDelayed({ bind(retry = true) }, 350)
  }

  override fun onDetachedFromWindow() {
    super.onDetachedFromWindow()
    main.removeCallbacksAndMessages(null)
    unbind()
  }

  private fun bind(retry: Boolean) {
    if (bound || !isAttachedToWindow) return
    val owner = appContext.currentActivity as? LifecycleOwner
    if (owner == null) {
      fail("No lifecycle owner")
      return
    }
    val future = ProcessCameraProvider.getInstance(context)
    future.addListener({
      try {
        val p = future.get()
        provider = p
        if (!isAttachedToWindow) return@addListener
        p.unbindAll()
        val backPreview = Preview.Builder().build().also { it.setSurfaceProvider(backView.surfaceProvider) }
        val frontPreview = Preview.Builder().build().also { it.setSurfaceProvider(frontView.surfaceProvider) }
        val backCfg = ConcurrentCamera.SingleCameraConfig(
          CameraSelector.DEFAULT_BACK_CAMERA,
          UseCaseGroup.Builder().addUseCase(backPreview).build(),
          owner,
        )
        val frontCfg = ConcurrentCamera.SingleCameraConfig(
          CameraSelector.DEFAULT_FRONT_CAMERA,
          UseCaseGroup.Builder().addUseCase(frontPreview).build(),
          owner,
        )
        p.bindToLifecycle(listOf(backCfg, frontCfg))
        bound = true
        onCameraReady(mapOf<String, Any>())
      } catch (e: Throwable) {
        if (retry) {
          main.postDelayed({ bind(retry = false) }, 600)
        } else {
          fail(e.message ?: "Couldn't start both cameras")
        }
      }
    }, ContextCompat.getMainExecutor(context))
  }

  private fun unbind() {
    try {
      if (bound) provider?.unbindAll()
    } catch (_: Throwable) {}
    bound = false
  }

  private fun fail(message: String) {
    main.post { onCameraError(mapOf("message" to message)) }
  }

  // Copy of the back preview as a JPEG (upright, cropped like the screen).
  fun takePicture(quality: Double, promise: Promise) {
    main.post {
      val bmp: Bitmap? = try { backView.bitmap } catch (_: Throwable) { null }
      if (bmp == null) {
        promise.reject("E_NOT_READY", "Camera isn't running yet", null)
        return@post
      }
      io.execute {
        try {
          val file = File(context.cacheDir, "dualcam-${UUID.randomUUID()}.jpg")
          FileOutputStream(file).use { out ->
            bmp.compress(Bitmap.CompressFormat.JPEG, (quality.coerceIn(0.05, 1.0) * 100).toInt(), out)
          }
          val w = bmp.width
          val h = bmp.height
          bmp.recycle()
          promise.resolve(mapOf("uri" to "file://${file.absolutePath}", "width" to w, "height" to h))
        } catch (e: Throwable) {
          promise.reject("E_CAPTURE", e.message ?: "Couldn't save photo", e)
        }
      }
    }
  }
}
