// Laser Tag "bystander tags": iYiYi users who are NOT in a match can be tagged by players,
// but only if they opted in ("Let Laser Tag players tag me", table laser_taggable).
// A tag inserts a laser_bystander_tags row (so a missed alert is shown on next app open)
// and sends a live 'lt-tag' alert over the inbox channel (invites.js).
//
// Tables come from supabase/migrations/030_laser_bystander_tags.sql. Everything here
// degrades gracefully if they don't exist yet: reads resolve empty/false, writes no-op.
import { useEffect, useRef, useState } from 'react'
import AsyncStorage from '@react-native-async-storage/async-storage'
import * as Crypto from 'expo-crypto'
import { supabase } from './supabase'
import { fetchCameraNearby } from './cameraApi'
import { userPos } from './cameraFilters'
import { angleDiff, bearingDeg, distanceMeters } from './multiplayer'

export const BYSTANDER_POINTS = 25
export const BYSTANDER_COOLDOWN_MS = 60000
export const NEARBY_REFRESH_MS = 15000
const MAX_RANGE_M = 60
const CAMERA_HFOV_DEG = 55 // portrait main camera (same as laser/vision.js)
const PROMPT_KEY = 'lt_bystander_prompted_v1'

async function myUid() {
  try {
    const { data } = await supabase.auth.getSession()
    return data?.session?.user?.id || null
  } catch {
    return null
  }
}

// ---- opt-in ----------------------------------------------------------------------

/** My opt-in. Resolves { enabled, exists } (exists=false when no row / no table). */
export async function getTaggable() {
  try {
    const uid = await myUid()
    if (!uid) return { enabled: false, exists: false }
    const { data, error } = await supabase.from('laser_taggable').select('enabled').eq('user_id', uid).maybeSingle()
    if (error || !data) return { enabled: false, exists: false }
    return { enabled: !!data.enabled, exists: true }
  } catch {
    return { enabled: false, exists: false }
  }
}

/** Save my opt-in. Resolves true on success. Never rejects. */
export async function setTaggable(enabled) {
  try {
    const uid = await myUid()
    if (!uid) return false
    const { error } = await supabase
      .from('laser_taggable')
      .upsert({ user_id: uid, enabled: !!enabled, updated_at: new Date().toISOString() }, { onConflict: 'user_id' })
    if (error) {
      console.warn('laser_taggable save failed', error.message)
      return false
    }
    try { await AsyncStorage.setItem(`${PROMPT_KEY}:${uid}`, '1') } catch {}
    return true
  } catch {
    return false
  }
}

/** True if this user should get the one-time opt-in prompt. Never rejects. */
export async function shouldPromptTaggable() {
  try {
    const uid = await myUid()
    if (!uid) return false
    if (await AsyncStorage.getItem(`${PROMPT_KEY}:${uid}`)) return false
    const cur = await getTaggable()
    if (cur.exists) {
      await AsyncStorage.setItem(`${PROMPT_KEY}:${uid}`, '1').catch(() => {})
      return false
    }
    return true
  } catch {
    return false
  }
}

/** Remember that the prompt was answered (with "Not now" nothing goes to the server). */
export async function markTaggablePrompted() {
  try {
    const uid = await myUid()
    if (uid) await AsyncStorage.setItem(`${PROMPT_KEY}:${uid}`, '1')
  } catch {}
}

/** Subset of `ids` that opted in. Missing table / errors → empty set (nobody is taggable). */
export async function fetchTaggableIds(ids) {
  const list = (ids || []).filter((x) => typeof x === 'string' && x).slice(0, 200)
  if (!list.length) return new Set()
  try {
    const { data, error } = await supabase.from('laser_taggable').select('user_id').eq('enabled', true).in('user_id', list)
    if (error || !Array.isArray(data)) return new Set()
    return new Set(data.map((r) => r.user_id))
  } catch {
    return new Set()
  }
}

// ---- tag rows --------------------------------------------------------------------

/** Insert the tag row; resolves its id (or null if it couldn't be stored). Never rejects. */
export async function recordBystanderTag({ targetId, fromName, code }) {
  try {
    const uid = await myUid()
    if (!uid || !targetId || uid === targetId) return null
    // Id made here, so the insert needs no select-back (only the target may read rows).
    let id = null
    try { id = Crypto.randomUUID() } catch { id = null }
    const row = { target_id: targetId, from_id: uid, from_name: String(fromName || 'Someone').slice(0, 32), code: code ? String(code).slice(0, 16) : null }
    const { error } = await supabase.from('laser_bystander_tags').insert(id ? { id, ...row } : row)
    if (error) return null
    return id
  } catch {
    return null
  }
}

/** Up to 3 unseen tags for me, newest first. Never rejects. */
export async function fetchUnseenBystanderTags() {
  try {
    const uid = await myUid()
    if (!uid) return []
    const { data, error } = await supabase
      .from('laser_bystander_tags')
      .select('id, from_id, from_name, code, created_at')
      .eq('target_id', uid)
      .eq('seen', false)
      .order('created_at', { ascending: false })
      .limit(3)
    if (error || !Array.isArray(data)) return []
    return data
  } catch {
    return []
  }
}

export async function markBystanderTagsSeen(ids) {
  const list = (ids || []).filter((x) => typeof x === 'string' && x)
  if (!list.length) return
  try {
    await supabase.from('laser_bystander_tags').update({ seen: true }).in('id', list)
  } catch {}
}

// ---- nearby opted-in users ---------------------------------------------------------

/**
 * Nearby iYiYi users who opted in, excluding match participants. Refreshes about every
 * 15 s while `enabled`. Returns an array of { id, username, pos }.
 */
export function useNearbyTaggable({ enabled, myPos, excludeIds }) {
  const [users, setUsers] = useState([])
  const posRef = useRef(myPos)
  posRef.current = myPos
  const exRef = useRef(excludeIds)
  exRef.current = excludeIds
  useEffect(() => {
    if (!enabled) { setUsers([]); return undefined }
    let alive = true
    const run = async () => {
      try {
        const p = posRef.current
        if (!p || !Number.isFinite(p.lat) || !Number.isFinite(p.lng)) return
        const [uid, d] = await Promise.all([myUid(), fetchCameraNearby(p.lat, p.lng)])
        const raw = Array.isArray(d?.users) ? d.users.filter(Boolean) : []
        const ex = exRef.current
        const cands = raw.filter((u) => typeof u.id === 'string' && u.id !== uid && !(ex && ex.has?.(u.id)) && userPos(u))
        const ok = await fetchTaggableIds(cands.map((u) => u.id))
        if (!alive) return
        setUsers(cands.filter((u) => ok.has(u.id)).map((u) => ({ id: u.id, username: String(u.username || '').replace(/^@+/, '').slice(0, 24) || 'iyiyi', pos: userPos(u) })))
      } catch {
        // Keep the last list.
      }
    }
    run()
    const t = setInterval(run, NEARBY_REFRESH_MS)
    return () => { alive = false; clearInterval(t) }
  }, [enabled])
  return users
}

/**
 * How well a GPS position fits a detected person (normalized photo box), from compass
 * heading + the person's horizontal position (same idea as cameraFilters.selectTargets).
 * Returns cost in [0, 1] (lower is better) or null if outside tolerance / range.
 */
export function bearingFit({ pos, myPos, headingDeg, body, extraTolDeg = 0 }) {
  try {
    if (!pos || !myPos || !Number.isFinite(headingDeg) || !body?.box) return null
    const d = distanceMeters(myPos, pos)
    if (!Number.isFinite(d) || d > MAX_RANGE_M) return null
    const offset = ((body.box.x + body.box.w / 2) - 0.5) * CAMERA_HFOV_DEG
    const aim = (headingDeg + offset + 360) % 360
    const diff = Math.abs(angleDiff(bearingDeg(myPos, pos), aim))
    const acc = (Number.isFinite(myPos.acc) ? myPos.acc : 10) + (Number.isFinite(pos.acc) ? pos.acc : 10)
    const tol = Math.min(35, 10 + ((Math.atan2(acc, Math.max(d, 1)) * 180) / Math.PI) * 0.6 + extraTolDeg)
    if (diff > tol) return null
    return { cost: diff / tol, d }
  } catch {
    return null
  }
}

/**
 * The opted-in bystander this detected person most likely is, unless a match participant
 * fits better. participants: [{ pos }] (everyone in the match except me).
 * Returns { user, d } or null.
 */
export function pickBystander({ body, users, participants, myPos, headingDeg }) {
  if (!users?.length) return null
  let best = null
  for (const u of users) {
    const f = bearingFit({ pos: u.pos, myPos, headingDeg, body })
    if (f && (!best || f.cost < best.cost)) best = { user: u, d: f.d, cost: f.cost }
  }
  if (!best) return null
  for (const p of participants || []) {
    const f = bearingFit({ pos: p.pos, myPos, headingDeg, body })
    if (f && f.cost <= best.cost) return null // a player fits at least as well
  }
  return best
}
