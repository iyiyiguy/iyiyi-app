// Meta Ray-Ban Display glasses: the iYiYi glasses web app (iyiyi.xyz/glasses) links to your
// account with a code (migration 084, edge function glasses-link), then talks to this phone over
// the realtime topic glasses:<user id>:<pair key>:
//   glasses -> phone: g_hello, g_aim { deg, at } (~10/s), g_fire { deg, at }, g_weapon { id } (Specs)
//   phone -> glasses: p_hud { ... } (laser tag sights), p_event { kind, text, bearing }
import { useEffect, useRef, useState, useCallback } from 'react'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { supabase } from './supabase'

const LINKED_KEY = 'iyiyi_glasses_linked_v1'
export const GLASSES_URL = 'https://iyiyi.xyz/glasses/'

export async function isGlassesLinked() {
  try { return (await AsyncStorage.getItem(LINKED_KEY)) === '1' } catch { return false }
}
export async function setGlassesLinked(on) {
  try { if (on) await AsyncStorage.setItem(LINKED_KEY, '1'); else await AsyncStorage.removeItem(LINKED_KEY) } catch {}
}

/** Claims the code shown in the glasses. Resolves true when it matched an open code. */
export async function claimGlassesCode(code) {
  const c = String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
  if (c.length !== 6) return false
  const { data, error } = await supabase.rpc('glasses_link_claim', { p_code: c })
  if (error) throw error
  if (data) await setGlassesLinked(true)
  return !!data
}

let keyCache = null
async function pairTopic() {
  const { data } = await supabase.auth.getSession()
  const uid = data?.session?.user?.id
  if (!uid) return null
  if (!keyCache || keyCache.uid !== uid) {
    const { data: k, error } = await supabase.rpc('glasses_pair_key')
    if (error || !k) return null
    keyCache = { uid, key: k }
  }
  return `glasses:${uid}:${keyCache.key}`
}

/**
 * useGlasses({ enabled, onFire }): connects to your linked glasses (only if you've linked them on
 * this phone). Returns { connected, headingRef, sendHud, sendEvent }.
 * headingRef.current = { deg, at } from the glasses compass (head aim) or null.
 */
export function useGlasses({ enabled = true, onFire, onWeapon } = {}) {
  const [connected, setConnected] = useState(false)
  const headingRef = useRef(null)
  const chRef = useRef(null)
  const lastSeen = useRef(0)
  const fireRef = useRef(onFire)
  fireRef.current = onFire
  const weaponRef = useRef(onWeapon)
  weaponRef.current = onWeapon

  useEffect(() => {
    if (!enabled) return undefined
    let alive = true
    let ch = null
    ;(async () => {
      if (!(await isGlassesLinked())) return
      const topic = await pairTopic()
      if (!alive || !topic) return
      ch = supabase.channel(topic, { config: { broadcast: { self: false, ack: false } } })
      const seen = () => { lastSeen.current = Date.now(); setConnected(true) }
      ch.on('broadcast', { event: 'g_hello' }, seen)
      ch.on('broadcast', { event: 'g_aim' }, ({ payload }) => {
        if (Number.isFinite(payload?.deg)) headingRef.current = { deg: payload.deg, at: Date.now() }
        seen()
      })
      ch.on('broadcast', { event: 'g_fire' }, ({ payload }) => {
        if (Number.isFinite(payload?.deg)) headingRef.current = { deg: payload.deg, at: Date.now() }
        seen()
        try { fireRef.current?.(payload) } catch {}
      })
      ch.on('broadcast', { event: 'g_weapon' }, ({ payload }) => { seen(); try { weaponRef.current?.(payload) } catch {} })
      ch.subscribe()
      chRef.current = ch
    })()
    const tm = setInterval(() => { if (Date.now() - lastSeen.current > 5000) setConnected(false) }, 2000)
    return () => {
      alive = false
      clearInterval(tm)
      if (ch) supabase.removeChannel(ch).catch(() => {})
      chRef.current = null
      headingRef.current = null
      setConnected(false)
    }
  }, [enabled])

  const sendHud = useCallback((hud) => {
    const ch = chRef.current
    if (ch && Date.now() - lastSeen.current < 8000) ch.send({ type: 'broadcast', event: 'p_hud', payload: hud }).catch(() => {})
  }, [])
  const sendEvent = useCallback((ev) => {
    const ch = chRef.current
    if (ch && Date.now() - lastSeen.current < 8000) ch.send({ type: 'broadcast', event: 'p_event', payload: ev }).catch(() => {})
  }, [])
  return { connected, headingRef, sendHud, sendEvent }
}

/** Fresh glasses heading as { deg, accuracy } (the aim shape the laser tag game uses), else null. */
export function glassesHeading(headingRef) {
  const h = headingRef?.current
  return h && Date.now() - h.at < 1500 ? { deg: h.deg, accuracy: 3, source: 'glasses' } : null
}
