import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { PanResponder } from 'react-native'

// Scope zoom for Laser Tag's camera aim: pinch with two fingers, or tap the zoom button to step
// through the zoom steps: 2× on most guns, 4× on the Marksman, 6× on the Sniper and Railgun,
// and up to 8× in binocular mode (no shooting).
//
// The zoom is applied to the camera PREVIEW (scaled around the middle of the screen), not to
// the camera itself. Hit detection keeps working exactly as before: it still analyses the full
// photo and fires at its centre, and the centre of the photo stays in the middle of the screen
// at any zoom. Detection boxes and player markers are mapped through `zoomRect` so they stay on
// top of the people they belong to.

export const PRECISION_MAX_ZOOM = 4
export const DEFAULT_MAX_ZOOM = 2
export const SNIPER_MAX_ZOOM = 6 // sniper rifle and railgun
export const BINOCULAR_MAX_ZOOM = 8
const STEPS = [1, 2, 4, 6, 8]

export function maxZoomFor(weapon) {
  if (weapon?.id === 'sniper' || weapon?.id === 'railgun') return SNIPER_MAX_ZOOM
  return weapon?.category === 'precision' ? PRECISION_MAX_ZOOM : DEFAULT_MAX_ZOOM
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))

function touchDistance(touches) {
  if (!touches || touches.length < 2) return 0
  const [a, b] = touches
  return Math.hypot(a.pageX - b.pageX, a.pageY - b.pageY)
}

export function useScopeZoom(maxZoom, { enabled = true, onChange } = {}) {
  const [zoom, setZoomState] = useState(1)
  const zoomRef = useRef(1)
  const maxRef = useRef(maxZoom)
  maxRef.current = maxZoom
  const pinch = useRef({ startDist: 0, startZoom: 1 })
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  const setZoom = useCallback((z) => {
    const next = Math.round(clamp(z, 1, maxRef.current) * 10) / 10
    if (next === zoomRef.current) return
    zoomRef.current = next
    setZoomState(next)
  }, [])

  // Switching to a gun with a lower limit brings the zoom back inside it.
  useEffect(() => {
    if (zoomRef.current > maxZoom) setZoom(maxZoom)
  }, [maxZoom, setZoom])

  useEffect(() => {
    if (!enabled && zoomRef.current !== 1) setZoom(1)
  }, [enabled, setZoom])

  // Tap the zoom button: 1× → 2× → 4× (precision) → 1×.
  const cycle = useCallback(() => {
    const steps = STEPS.filter((z) => z <= maxRef.current)
    const cur = zoomRef.current
    const next = steps.find((s) => s > cur + 0.05) ?? 1
    setZoom(next)
    onChangeRef.current?.(next)
  }, [setZoom])

  // Two-finger pinch anywhere on the camera view. A single finger is left alone so the
  // full-screen trigger keeps working; the second finger takes over for the pinch.
  const responder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponderCapture: (e) => enabled && (e.nativeEvent.touches?.length ?? 0) >= 2,
    onMoveShouldSetPanResponderCapture: (e) => enabled && (e.nativeEvent.touches?.length ?? 0) >= 2,
    onPanResponderGrant: (e) => {
      pinch.current = { startDist: touchDistance(e.nativeEvent.touches), startZoom: zoomRef.current }
    },
    onPanResponderMove: (e) => {
      const d = touchDistance(e.nativeEvent.touches)
      if (!d) return
      if (!pinch.current.startDist) {
        pinch.current = { startDist: d, startZoom: zoomRef.current }
        return
      }
      setZoom(pinch.current.startZoom * (d / pinch.current.startDist))
    },
    onPanResponderRelease: () => {
      pinch.current.startDist = 0
      onChangeRef.current?.(zoomRef.current)
    },
    onPanResponderTerminate: () => { pinch.current.startDist = 0 },
    onPanResponderTerminationRequest: () => false,
  }), [enabled, setZoom])

  // Map a rectangle measured on the unzoomed preview onto the zoomed one.
  const zoomRect = useCallback((r, view) => {
    const z = zoomRef.current
    if (z === 1 || !view?.width) return r
    const cx = view.width / 2
    const cy = view.height / 2
    return { left: cx + (r.left - cx) * z, top: cy + (r.top - cy) * z, width: r.width * z, height: r.height * z }
  }, [])

  return { zoom, setZoom, cycle, panHandlers: responder.panHandlers, zoomRect }
}

export function formatZoom(z) {
  return `${Number.isInteger(z) ? z : z.toFixed(1)}×`
}
