// Laser Tag enemy intel for the minimap / big map.
//
// Enemies are never shown on the map by default — you find them by looking around. Two
// things reveal them:
//   • Shot pings: every client broadcasts 'lt_shot' (throttled) when it fires; enemies who
//     fire show as a red ping for SHOT_PING_MS, fading out.
//   • UAV: while a UAV is active for my side, every alive enemy shows as a pulsing red dot.
//     Positions are re-sampled about once a second so the map isn't re-rendered on every
//     GPS update.
// All state lives in refs; a single ticker (only running while there is something to show)
// bumps one counter that the returned points are memoized on.
import { useEffect, useMemo, useRef, useState } from 'react'
import { SHOT_PING_MS } from '../../lib/uav'

const TICK_MS = 500
const UAV_SAMPLE_MS = 1000
const POS_STALE_MS = 15000
export const SHOT_BROADCAST_MIN_MS = 700

const validLatLng = (p) => !!p && Number.isFinite(p.lat) && Number.isFinite(p.lng) && Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180

/** True when `id` is an enemy of mine in this state (FFA: everyone else). */
export function isEnemy(state, meId, myTeam, id) {
  if (!state || !id || id === meId) return false
  const pl = state.players?.[id]
  if (!pl) return false
  if (state.mode === 'ffa') return true
  return pl.team !== myTeam
}

/**
 * @returns {Array<{ id, pos, color, kind: 'ping'|'uav', opacity?, ring? }>}
 */
export function useEnemyIntel({ room, state, positions, meId, myTeam, uavActive, color }) {
  const [tick, setTick] = useState(0)
  const [running, setRunning] = useState(false)
  const pings = useRef(new Map()) // id -> { pos, at }
  const uavSnap = useRef({ at: 0, list: [] })
  const last = useRef({ sig: '', out: [] })
  const ctx = useRef({})
  ctx.current = { state, positions, meId, myTeam }

  // Enemy shot pings from the room.
  useEffect(() => {
    if (!room) return undefined
    const off = room.onMessage('lt_shot', (d, from) => {
      try {
        const c = ctx.current
        if (!isEnemy(c.state, c.meId, c.myTeam, from)) return
        const pos = validLatLng(d) ? { lat: d.lat, lng: d.lng } : c.positions?.[from]
        if (!validLatLng(pos)) return
        pings.current.set(from, { pos: { lat: pos.lat, lng: pos.lng }, at: Date.now() })
        setRunning(true)
        setTick((t) => t + 1)
      } catch {
        // Bad payload: ignore.
      }
    })
    return off
  }, [room])

  // One ticker while a UAV is up or pings are fading.
  const live = running || !!uavActive
  useEffect(() => {
    if (!live) return undefined
    const t = setInterval(() => {
      const now = Date.now()
      for (const [id, p] of pings.current) if (now - p.at > SHOT_PING_MS) pings.current.delete(id)
      if (pings.current.size === 0) setRunning(false)
      setTick((n) => n + 1)
    }, TICK_MS)
    return () => clearInterval(t)
  }, [live])

  // Clear when the match changes.
  const matchId = state ? `${state.round}:${state.snd?.roundNo ?? 0}` : null
  useEffect(() => {
    pings.current.clear()
    uavSnap.current = { at: 0, list: [] }
    setRunning(false)
  }, [matchId])

  return useMemo(() => {
    const c = ctx.current
    const s = c.state
    if (!s) return []
    const now = Date.now()
    const out = []
    const shown = new Set()
    if (uavActive) {
      if (now - uavSnap.current.at >= UAV_SAMPLE_MS || uavSnap.current.list.length === 0) {
        const list = []
        const carrier = s.mode === 'snd' ? s.snd?.bomb?.carrier : null
        for (const id of Object.keys(s.players || {})) {
          if (!isEnemy(s, c.meId, c.myTeam, id)) continue
          const pl = s.players[id]
          if (!pl?.alive) continue
          const p = c.positions?.[id]
          if (!validLatLng(p) || now - (p.at || 0) > POS_STALE_MS) continue
          list.push({ id: `uav-${id}`, pid: id, pos: { lat: p.lat, lng: p.lng }, color, kind: 'uav', ring: carrier === id })
        }
        uavSnap.current = { at: now, list }
      }
      for (const m of uavSnap.current.list) {
        out.push(m)
        shown.add(m.pid)
      }
    } else if (uavSnap.current.list.length) {
      uavSnap.current = { at: 0, list: [] }
    }
    for (const [id, p] of pings.current) {
      if (shown.has(id)) continue
      const age = now - p.at
      if (age > SHOT_PING_MS) continue
      // Quantised fade so the marker only changes a few times.
      const opacity = Math.max(0.2, Math.round((1 - age / SHOT_PING_MS) * 5) / 5)
      out.push({ id: `ping-${id}`, pos: p.pos, color, kind: 'ping', opacity })
    }
    // Same markers as last time → same array, so memoized maps skip the re-render.
    const sig = `${uavSnap.current.at}|${color}|${out.map((m) => `${m.id}:${m.opacity ?? 1}:${m.pos.lat}:${m.pos.lng}`).join(',')}`
    if (sig === last.current.sig) return last.current.out
    last.current = { sig, out }
    return out
  }, [tick, uavActive, color]) // eslint-disable-line react-hooks/exhaustive-deps
}
