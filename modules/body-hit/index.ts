// JS side of the local `body-hit` Expo module (Apple Vision on iOS, ML Kit on Android).
// Returns null when the native module isn't in this build (Android, web,
// Expo Go, or an older binary) so callers can fall back to compass aiming.
import { requireOptionalNativeModule } from 'expo'

export type NormRect = { x: number; y: number; w: number; h: number } // 0..1, top-left origin

export type DetectedBody = {
  box: NormRect
  head?: NormRect | null
  torso?: NormRect | null
  joints?: Record<string, { x: number; y: number }>
  confidence: number
  source: 'pose' | 'rect'
  imageWidth: number
  imageHeight: number
}

export type FacePoint = { x: number; y: number } // normalized, top-left origin

export type DetectedFace = {
  box: NormRect
  roll?: number // radians (Vision)
  yaw?: number
  pitch?: number // iOS 15+
  landmarks?: { nose?: FacePoint; leftEye?: FacePoint; rightEye?: FacePoint }
  confidence: number
  imageWidth: number
  imageHeight: number
}

type NativeBodyHit = {
  detectBodies(uri: string, deleteAfter: boolean): Promise<DetectedBody[]>
  // Missing in binaries built before face detection was added.
  detectFaces?: (uri: string, deleteAfter: boolean) => Promise<DetectedFace[]>
  // Missing in binaries built before live face tracking was added.
  startLiveFaces?: () => Promise<boolean>
  stopLiveFaces?: () => Promise<void>
  // Missing in binaries built before live body tracking was added.
  startLiveBodies?: () => Promise<boolean>
  stopLiveBodies?: () => Promise<void>
  addListener?: (event: string, fn: (e: any) => void) => { remove: () => void }
  // Missing in binaries built before video branding was added (and on Android).
  brandVideo?: (uri: string, opts: BrandVideoOptions) => Promise<string | null>
  // Missing in binaries built before the surface scanner (depth model) was added.
  prepareDepthModel?: (cellularAfter: number) => Promise<DepthModelStatus>
  depthModelStatus?: () => Promise<DepthModelStatus>
  estimateDepth?: (uri: string, deleteAfter: boolean) => Promise<DepthGrid | null>
  // Live green screen (iOS 15+). Missing in older binaries and on Android.
  startGreenScreen?: (opts: GreenScreenOptions) => Promise<boolean>
  updateGreenScreen?: (opts: GreenScreenOptions) => Promise<void>
  stopGreenScreen?: () => Promise<void>
  captureGreenScreenPhoto?: () => Promise<string | null>
  startGreenScreenRecording?: (withAudio: boolean) => Promise<boolean>
  stopGreenScreenRecording?: () => Promise<string | null>
}

export type GreenScreenOptions = { mode: 'image' | 'blur' | 'color'; uri?: string | null; color?: string | null }

// Surface scanner (Laser Tag cover): monocular depth model, shipped inside the app (fetched and
// SHA-256-verified at build time by BodyHit.podspec / android/build.gradle). A binary built
// without it downloads it once on demand instead (silently).
//   iOS 17+: Apple's Core ML Depth Anything V2 Small (F16).  Android: MiDaS v2.1 small (LiteRT).
export type DepthModelState = 'unsupported' | 'idle' | 'waiting-wifi' | 'downloading' | 'compiling' | 'ready' | 'failed'
export type DepthModelStatus = {
  state: DepthModelState
  progress?: number // 0..1 of the download
  bytes?: number
  total?: number
  model?: string
  lidar?: boolean // the phone has a LiDAR camera (not used: expo-camera's session uses the wide camera)
  lidarUsed?: boolean
  bundled?: boolean // the model ships inside this app (ready at once, no download)
  error?: string | null
}
// Relative INVERSE depth (bigger = nearer; arbitrary scale + offset) averaged over a w x h grid
// (24 x 32 portrait / 32 x 24 landscape) of the upright frame, row-major, top row first.
// space: 'photo' = the full captured photo, 'view' = what the on-screen preview showed (Android).
export type DepthGrid = {
  w: number
  h: number
  data: number[]
  imageWidth: number
  imageHeight: number
  source?: string
  space?: 'photo' | 'view'
  kind?: 'inverse'
  ms?: number
}

export type BrandVideoOptions = {
  viewW: number
  viewH: number
  mirror: boolean
  box: number
  logoUri?: string | null
  logoRect?: [number, number, number, number]
  artUri?: string | null
  track?: number[][] // [t, x, y, scale, roll, opacity]
  stopT?: number
}

const Native = requireOptionalNativeModule<NativeBodyHit>('BodyHit')

// Body pose (Laser Tag): Apple Vision on iOS, ML Kit pose detection on Android (newer binaries).
export const isBodyHitAvailable = !!Native && typeof (Native as any).detectBodies === 'function'

export async function detectBodies(uri: string, deleteAfter = true): Promise<DetectedBody[] | null> {
  if (!Native) return null
  try {
    const res = await Native.detectBodies(uri, deleteAfter)
    return Array.isArray(res) ? res : []
  } catch {
    return []
  }
}

// Face boxes + head angles (Vision face rectangles rev. 3 + landmarks). Only when this binary's
// module has it; otherwise callers fall back to detectBodies() pose keypoints.
let faceFn: ((uri: string, deleteAfter: boolean) => Promise<DetectedFace[]>) | null = null
try {
  faceFn = Native && typeof Native.detectFaces === 'function'
    ? (uri: string, deleteAfter: boolean) => (Native as NativeBodyHit).detectFaces!(uri, deleteAfter)
    : null
} catch {
  faceFn = null
}
export const isFaceDetectAvailable = !!faceFn

export async function detectFaces(uri: string, deleteAfter = true): Promise<DetectedFace[] | null> {
  if (!faceFn) return null
  try {
    const res = await faceFn(uri, deleteAfter)
    return Array.isArray(res) ? res : []
  } catch {
    return []
  }
}

// Real-time faces (every camera frame) from the preview's own capture session.
// landmarks (Android): nose / leftEye / rightEye in the same preview-view coordinates.
export type LiveFace = { x: number; y: number; w: number; h: number; id: number; landmarks?: Record<string, { x: number; y: number }> | null }
export type LiveFacesEvent = { faces: LiveFace[]; layerW: number; layerH: number }

export const isLiveFacesAvailable = !!(Native && typeof Native.startLiveFaces === 'function' && typeof Native.addListener === 'function')

export async function startLiveFaces(): Promise<boolean> {
  if (!isLiveFacesAvailable) return false
  try {
    return !!(await Native!.startLiveFaces!())
  } catch {
    return false
  }
}

export async function stopLiveFaces(): Promise<void> {
  if (!isLiveFacesAvailable) return
  try {
    await Native!.stopLiveFaces!()
  } catch {}
}

export function addLiveFacesListener(fn: (e: LiveFacesEvent) => void): { remove: () => void } {
  if (!isLiveFacesAvailable) return { remove: () => {} }
  try {
    return Native!.addListener!('onLiveFaces', fn)
  } catch {
    return { remove: () => {} }
  }
}

// Real-time people (Laser Tag target brackets + aim assist) from the preview's own capture
// session (iOS: AVFoundation human body / full body / face detectors) or the on-screen preview
// copy (Android: ML Kit pose STREAM_MODE + faces). Boxes are normalized 0..1 of the preview
// view, top-left origin. id: the native tracker's id (-1 = none; JS keeps its own sticky ids).
// kind: 'full' | 'upper' | 'face' (iOS), 'pose' | 'face' (Android).
export type LiveBody = { id: number; x: number; y: number; w: number; h: number; head?: NormRect | null; conf?: number; kind?: string }
export type LiveBodiesEvent = { bodies: LiveBody[]; layerW: number; layerH: number }

export const isLiveBodiesAvailable = !!(Native && typeof Native.startLiveBodies === 'function' && typeof Native.addListener === 'function')

export async function startLiveBodies(): Promise<boolean> {
  if (!isLiveBodiesAvailable) return false
  try {
    return !!(await Native!.startLiveBodies!())
  } catch {
    return false
  }
}

export async function stopLiveBodies(): Promise<void> {
  if (!isLiveBodiesAvailable) return
  try {
    await Native!.stopLiveBodies!()
  } catch {}
}

export function addLiveBodiesListener(fn: (e: LiveBodiesEvent) => void): { remove: () => void } {
  if (!isLiveBodiesAvailable) return { remove: () => {} }
  try {
    return Native!.addListener!('onLiveBodies', fn)
  } catch {
    return { remove: () => {} }
  }
}

// Burns the iY logo (and the AR filter, following the recorded head track) into a recorded
// video. Resolves to a new file uri, or null when unavailable / it failed (use the original).
export const isBrandVideoAvailable = !!(Native && typeof (Native as any).brandVideo === 'function')

export async function brandVideo(uri: string, opts: BrandVideoOptions): Promise<string | null> {
  if (!isBrandVideoAvailable) return null
  try {
    const out = await Native!.brandVideo!(uri, opts)
    return typeof out === 'string' && out ? out : null
  } catch {
    return null
  }
}

// ---- Surface scanner --------------------------------------------------------------------------
export const isDepthAvailable = !!(Native && typeof Native.estimateDepth === 'function' && typeof Native.prepareDepthModel === 'function')

// Gets the model ready: loads the bundled one (no network), or, in a binary built without it,
// starts the one-time background download (Wi-Fi only until `cellularAfter` Laser Tag sessions
// have waited for Wi-Fi). Resolves the status at once; null when this binary has no scanner.
export async function prepareDepthModel(cellularAfter = 3): Promise<DepthModelStatus | null> {
  if (!isDepthAvailable) return null
  try {
    const s = await Native!.prepareDepthModel!(Math.max(0, Math.round(cellularAfter)))
    return s && typeof s.state === 'string' ? s : null
  } catch {
    return null
  }
}

export async function depthModelStatus(): Promise<DepthModelStatus | null> {
  if (!isDepthAvailable || typeof Native!.depthModelStatus !== 'function') return null
  try {
    const s = await Native!.depthModelStatus!()
    return s && typeof s.state === 'string' ? s : null
  } catch {
    return null
  }
}

// One frame's depth grid, or null (model not ready, busy, failed). uri null: Android uses the
// on-screen preview; iOS needs a photo file. deleteAfter removes the photo in every case.
export async function estimateDepth(uri: string | null, deleteAfter = true): Promise<DepthGrid | null> {
  if (!isDepthAvailable) return null
  try {
    const g = await Native!.estimateDepth!(uri || '', deleteAfter)
    if (!g || !Array.isArray(g.data) || !(g.w > 0) || !(g.h > 0) || g.data.length !== g.w * g.h) return null
    return g
  } catch {
    return null
  }
}

// ---- live green screen ----
export const greenScreenSupported = () => typeof (Native as any)?.startGreenScreen === 'function'
export async function startGreenScreen(opts: GreenScreenOptions): Promise<boolean> {
  try { return !!(await (Native as any)?.startGreenScreen?.(opts)) } catch { return false }
}
export async function updateGreenScreen(opts: GreenScreenOptions): Promise<void> {
  try { await (Native as any)?.updateGreenScreen?.(opts) } catch {}
}
export async function stopGreenScreen(): Promise<void> {
  try { await (Native as any)?.stopGreenScreen?.() } catch {}
}
export async function captureGreenScreenPhoto(): Promise<string | null> {
  try { return (await (Native as any)?.captureGreenScreenPhoto?.()) ?? null } catch { return null }
}
export async function startGreenScreenRecording(withAudio: boolean): Promise<boolean> {
  try { return !!(await (Native as any)?.startGreenScreenRecording?.(withAudio)) } catch { return false }
}
export async function stopGreenScreenRecording(): Promise<string | null> {
  try { return (await (Native as any)?.stopGreenScreenRecording?.()) ?? null } catch { return null }
}
