// JS side of the local `dual-camera` module (iOS only). When the native module isn't in
// this build, or the phone can't run two cameras at once, isDualCameraSupported() is false
// and callers simply don't offer the selfie bubble.
import { forwardRef, useImperativeHandle, useRef } from 'react'
import type { ViewStyle } from 'react-native'
import { requireNativeView, requireOptionalNativeModule } from 'expo'

type NativeDualCamera = {
  isSupported(): boolean
  // Missing in binaries built before gameplay recording was added.
  isRecordingSupported?: () => boolean
  startRecording?: (mic: boolean) => Promise<boolean>
  stopRecording?: () => Promise<string | null>
}
const native = requireOptionalNativeModule<NativeDualCamera>('DualCamera')

let supported = false
try { supported = !!native?.isSupported?.() } catch { supported = false }

export function isDualCameraSupported(): boolean {
  return supported
}

// ---- gameplay recording (screen + game sound + your voice) ----
export function isRecordingSupported(): boolean {
  try { return !!native?.isRecordingSupported?.() } catch { return false }
}

export async function startRecording(mic = true): Promise<boolean> {
  if (!native?.startRecording) return false
  return !!(await native.startRecording(mic))
}

export async function stopRecording(): Promise<string | null> {
  if (!native?.stopRecording) return null
  return (await native.stopRecording()) || null
}

const NativeView: any = supported ? requireNativeView('DualCamera') : null

type Props = {
  style?: ViewStyle | ViewStyle[]
  selfieEnabled?: boolean
  selfieFrame?: [number, number, number, number]
  onCameraReady?: () => void
  onCameraError?: (e: { nativeEvent: { message?: string } }) => void
}

export type DualCameraHandle = {
  // Same shape callers use with expo-camera's CameraView.
  takePictureAsync: (opts?: { quality?: number }) => Promise<{ uri: string; width: number; height: number } | null>
}

export const DualCameraView = forwardRef<DualCameraHandle, Props>(function DualCameraView(props, ref) {
  const inner = useRef<any>(null)
  useImperativeHandle(ref, () => ({
    takePictureAsync: async (opts) => {
      try {
        return await inner.current?.takePicture?.(opts?.quality ?? 0.3)
      } catch {
        return null
      }
    },
  }), [])
  if (!NativeView) return null
  return <NativeView ref={inner} {...props} />
})
