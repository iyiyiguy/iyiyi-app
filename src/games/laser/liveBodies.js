// Real-time people tracking for the camera aim (Laser Tag, Battle Royale).
//
//   const live = useLiveBodies({ enabled, restartKey })
//   live.running()     native tracking is on (else use the still-frame path in vision.js)
//   live.get()         smoothed bodies in preview space: [{ id, box, head, kind, conf }]
//   live.subscribe(fn) called on every native update (~10-15/s); returns an unsubscribe
//
// The native side (modules/body-hit: startLiveBodies / "onLiveBodies") emits raw boxes;
// createBodyTracker (aimAssist.js) keeps sticky ids and smooths them (EMA). Without the native
// tracker (older binary, web, no preview yet) running() stays false and nothing is emitted.
import { useEffect, useMemo } from 'react'
import { addLiveBodiesListener, isLiveBodiesAvailable, startLiveBodies, stopLiveBodies } from '../../../modules/body-hit'
import { createBodyTracker } from './aimAssist'

export const liveBodiesAvailable = isLiveBodiesAvailable

const RETRY_MS = 2500 // re-attach (new camera session after a flip / selfie toggle, late preview)
const EXPIRE_MS = 120 // tracks coast out even when the native side goes quiet

export function createLiveBodyStore() {
  const tracker = createBodyTracker()
  const subs = new Set()
  let running = false
  let lastAt = 0
  const notify = () => {
    for (const fn of subs) {
      try { fn() } catch {}
    }
  }
  return {
    running: () => running,
    setRunning: (v) => {
      const next = !!v
      if (next === running) return
      running = next
      if (!next) tracker.reset()
      notify()
    },
    ingest: (e) => {
      try {
        tracker.update(Array.isArray(e?.bodies) ? e.bodies : [], Date.now())
        lastAt = Date.now()
        notify()
      } catch {}
    },
    expire: () => {
      const before = tracker.size()
      if (!before) return
      tracker.expire(Date.now())
      if (tracker.size() !== before) notify()
    },
    get: () => (running ? tracker.get(Date.now()) : []),
    lastAt: () => lastAt,
    subscribe: (fn) => {
      subs.add(fn)
      return () => subs.delete(fn)
    },
    reset: () => {
      tracker.reset()
      notify()
    },
  }
}

export function useLiveBodies({ enabled = true, restartKey = '' } = {}) {
  const store = useMemo(() => createLiveBodyStore(), [])
  useEffect(() => {
    if (!enabled || !isLiveBodiesAvailable) {
      store.setRunning(false)
      return undefined
    }
    let cancelled = false
    let sub = null
    try {
      sub = addLiveBodiesListener((e) => { if (!cancelled) store.ingest(e) })
    } catch {
      sub = null
    }
    const tryStart = () => {
      startLiveBodies()
        .then((ok) => { if (!cancelled) store.setRunning(ok) })
        .catch(() => { if (!cancelled) store.setRunning(false) })
    }
    // The camera session needs a moment after the preview mounts.
    const first = setTimeout(tryStart, 400)
    const retry = setInterval(tryStart, RETRY_MS)
    const expire = setInterval(() => store.expire(), EXPIRE_MS)
    return () => {
      cancelled = true
      clearTimeout(first)
      clearInterval(retry)
      clearInterval(expire)
      try { sub?.remove() } catch {}
      stopLiveBodies().catch(() => {})
      store.setRunning(false)
    }
  }, [enabled, restartKey, store])
  return store
}
