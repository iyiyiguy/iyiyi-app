// sound-scan: copyright check for a sound before it goes public.
// POST { sound_id } with the member's auth header. The owner (or an admin) can ask for a scan;
// the file is sent to AudD's music recognition (secret AUDD_API_TOKEN). A match with a known
// commercial song -> status 'blocked' (stays private for the owner); no match -> 'public'.
// Uses the service role (auto-provided to edge functions) because only it may set 'public'.
import { createClient } from 'npm:@supabase/supabase-js@2.45.4'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })
const ADMINS = ['iyiyiguy@gmail.com', 'hibernationprophet@gmail.com', 'playappdev16@gmail.com', 'iyiyidev@gmail.com']
const COLS = 'id, user_id, title, audio_url, duration_s, bpm, kind, tags, status, use_count, play_count, created_at, profiles:user_id (username, avatar_url)'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)
  const url = Deno.env.get('SUPABASE_URL')!
  const anon = Deno.env.get('SUPABASE_ANON_KEY')!
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const audd = Deno.env.get('AUDD_API_TOKEN')

  const userClient = createClient(url, anon, { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } })
  const { data: { user } } = await userClient.auth.getUser()
  if (!user) return json({ error: 'Sign in first' }, 401)

  let soundId = ''
  try { soundId = String((await req.json())?.sound_id || '') } catch { /* empty */ }
  if (!soundId) return json({ error: 'sound_id required' }, 400)

  const admin = createClient(url, service)
  const { data: sound, error } = await admin.from('sounds').select('id, user_id, audio_url, status').eq('id', soundId).maybeSingle()
  if (error || !sound) return json({ error: 'Sound not found' }, 404)
  const isAdmin = ADMINS.includes((user.email || '').toLowerCase())
  if (sound.user_id !== user.id && !isAdmin) return json({ error: 'Not your sound' }, 403)
  if (sound.status === 'blocked' && !isAdmin) return json({ error: 'This sound matched a copyrighted song' }, 409)

  let status = 'private'
  let scan: Record<string, unknown> = {}
  if (!audd) {
    scan = { error: 'scanner not configured' }
  } else {
    try {
      const form = new FormData()
      form.append('api_token', audd)
      form.append('url', sound.audio_url)
      const r = await fetch('https://api.audd.io/', { method: 'POST', body: form })
      const body = await r.json()
      if (body?.status === 'success') {
        if (body.result) {
          status = 'blocked'
          scan = { match: { artist: body.result.artist, title: body.result.title, album: body.result.album, timecode: body.result.timecode } }
        } else {
          status = 'public'
          scan = { match: null }
        }
      } else {
        scan = { error: body?.error?.error_message || 'scan failed' }
      }
    } catch (e) {
      scan = { error: String(e).slice(0, 200) }
    }
  }

  const { data: updated, error: upErr } = await admin
    .from('sounds')
    .update({ status, scan, scanned_at: new Date().toISOString() })
    .eq('id', soundId)
    .select(COLS)
    .single()
  if (upErr) return json({ error: upErr.message }, 500)
  return json({ sound: { ...updated, is_muted: false }, scan })
})
