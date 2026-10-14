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
