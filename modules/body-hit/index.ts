// JS side of the local `body-hit` Expo module (Apple Vision, iOS only).
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
}

const Native = requireOptionalNativeModule<NativeBodyHit>('BodyHit')

export const isBodyHitAvailable = !!Native

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
