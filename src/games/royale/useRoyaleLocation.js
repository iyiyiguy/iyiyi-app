// GPS for Battle Royale: watches this phone's position (with speed for transit detection)
// and shares a compact position with the room — at most once a second while moving and
// every few seconds while standing still, to keep realtime traffic sane with 100 players.
// Also a throttled view of everyone else's positions (re-renders at most once a second).
import { useEffect, useRef, useState } from 'react'
import * as Location from 'expo-location'
import { POS_IDLE_MS, POS_MOVED_M, POS_MOVING_MS } from './constants'
import { dist, isValidCoord } from './geo'

const r6 = (v) => Math.round(v * 1e6) / 1e6

export function useRoyaleLocation(room, { enabled = true, share = true } = {}) {
  const [status, setStatus] = useState('pending') // pending | granted | denied | error
  const [coords, setCoords] = useState(null) // { lat, lng, acc, speed, at }
  const shareRef = useRef(share)
  shareRef.current = share

  useEffect(() => {
    if (!room || !enabled) return undefined
    let cancelled = false
    let sub = null
    let last = null
    let lastSent = null
    let lastSentAt = 0
    const send = (force) => {
      if (!last || !shareRef.current) return
      const now = Date.now()
      const moved = lastSent ? dist(lastSent, last) : Infinity
      const gap = moved >= POS_MOVED_M ? POS_MOVING_MS : POS_IDLE_MS
      if (!force && now - lastSentAt < gap) return
      if (force && now - lastSentAt < POS_MOVING_MS) return
      lastSentAt = now
      lastSent = last
      try {
        room.sendPosition({ lat: r6(last.lat), lng: r6(last.lng), acc: Number.isFinite(last.acc) ? Math.round(last.acc) : null })
      } catch { /* offline */ }
    }
    const keepAlive = setInterval(() => send(false), 1000)
    ;(async () => {
      try {
        const perm = await Location.requestForegroundPermissionsAsync()
        if (cancelled) return
        if (perm.status !== 'granted') { setStatus('denied'); return }
        setStatus('granted')
        sub = await Location.watchPositionAsync(
          { accuracy: Location.Accuracy.BestForNavigation, timeInterval: 1000, distanceInterval: 0 },
          (loc) => {
            const c = loc?.coords
            if (!c || !isValidCoord(c.latitude, c.longitude)) return
            last = {
              lat: c.latitude,
              lng: c.longitude,
              acc: Number.isFinite(c.accuracy) ? c.accuracy : null,
              speed: Number.isFinite(c.speed) && c.speed >= 0 ? c.speed : null,
              at: Number.isFinite(loc.timestamp) ? loc.timestamp : Date.now(),
            }
            if (!cancelled) setCoords(last)
            send(false)
          },
          () => {},
        )
        if (cancelled) { sub?.remove(); sub = null }
      } catch (e) {
        console.warn('royale location failed', e?.message ?? e)
        if (!cancelled) setStatus('error')
      }
    })()
    return () => {
      cancelled = true
      clearInterval(keepAlive)
      try { sub?.remove() } catch { /* ignore */ }
    }
  }, [room, enabled])

  return { status, coords }
}

// Everyone's shared positions, but at most one re-render per `ms`.
export function useThrottledPositions(room, ms = 1000) {
  const [positions, setPositions] = useState(() => room?.positions || {})
  useEffect(() => {
    if (!room) return undefined
    let timer = null
    let lastAt = 0
    const flush = () => {
      timer = null
      lastAt = Date.now()
      setPositions(room.positions || {})
    }
    const off = room.emitter.on('positions', () => {
      if (timer) return
      const wait = Math.max(0, ms - (Date.now() - lastAt))
      timer = setTimeout(flush, wait)
    })
    flush()
    return () => { off(); clearTimeout(timer) }
  }, [room, ms])
  return positions
}
