// Edit data + sound for posts, fetched in small batches by media id and cached, for screens
// whose data comes from API responses that don't include the newer columns.
import { useEffect, useState } from 'react'
import { supabase } from './supabase'

const cache = new Map() // id -> { edit, sound, caption } | null
const waiting = new Map() // id -> [resolve]
let queue = new Set()
let timer = null

async function flush() {
  timer = null
  const all = [...queue]
  queue = new Set()
  // profile_media ids are numbers; anything else (imported / external items) has no row here.
  const ids = all.filter((id) => /^\d+$/.test(id))
  all.filter((id) => !/^\d+$/.test(id)).forEach((id) => {
    cache.set(id, null)
    ;(waiting.get(id) || []).forEach((fn) => fn(null))
    waiting.delete(id)
  })
  if (!ids.length) return
  let rows = []
  try {
    const { data } = await supabase
      .from('profile_media')
      .select('id, edit, caption, sound:sound_id (id, title, audio_url, status, is_muted, user_id, duration_s)')
      .in('id', ids)
    rows = data || []
  } catch {}
  const byId = new Map(rows.map((r) => [String(r.id), { edit: r.edit || null, sound: r.sound || null, caption: r.caption || null }]))
  ids.forEach((id) => {
    const v = byId.get(String(id)) || null
    cache.set(String(id), v)
    ;(waiting.get(String(id)) || []).forEach((fn) => fn(v))
    waiting.delete(String(id))
  })
}

export function getMediaMeta(id) {
  const key = String(id)
  if (cache.has(key)) return Promise.resolve(cache.get(key))
  return new Promise((resolve) => {
    waiting.set(key, [...(waiting.get(key) || []), resolve])
    queue.add(key)
    if (!timer) timer = setTimeout(flush, 60)
  })
}

export function primeMediaMeta(id, value) {
  cache.set(String(id), value)
}

export function useMediaMeta(id) {
  const [v, setV] = useState(() => (id != null ? cache.get(String(id)) : null))
  useEffect(() => {
    if (id == null) return undefined
    let alive = true
    getMediaMeta(id).then((m) => { if (alive) setV(m) })
    return () => { alive = false }
  }, [id])
  return v
}
