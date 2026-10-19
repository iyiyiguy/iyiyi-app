// glasses-link: finishes linking Meta Ray-Ban Display glasses to an account (see migration 084).
// POST { code, secret } from the glasses web app (no auth header; the secret is the proof).
//   -> 202 { pending: true } until the member enters the code in the iYiYi app
//   -> 200 { token_hash } once: a one-time sign-in token for that member; the glasses call
//      supabase.auth.verifyOtp({ token_hash, type: 'magiclink' }) and get their own session.
//   -> 410 when the code expired / was used, 403 when the secret doesn't match.
// Uses the service role (auto-provided to edge functions). Deploy with verify_jwt off
// (the glasses have no session yet).
import { createClient } from 'npm:@supabase/supabase-js@2.45.4'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

async function sha256Hex(s: string) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)
  let code = ''
  let secret = ''
  try {
    const b = await req.json()
    code = String(b?.code || '').toUpperCase().trim()
    secret = String(b?.secret || '')
  } catch { /* empty */ }
  if (!/^[A-Z0-9]{6}$/.test(code) || secret.length < 32 || secret.length > 200) return json({ error: 'bad request' }, 400)

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const { data: row } = await admin.from('glasses_links').select('*').eq('code', code).maybeSingle()
  if (!row || row.consumed_at || Date.now() - new Date(row.created_at).getTime() > 10 * 60 * 1000) return json({ error: 'This code expired. Make a new one on your glasses.' }, 410)
  if ((await sha256Hex(secret)) !== row.secret_hash) return json({ error: 'forbidden' }, 403)
  if (!row.user_id) return json({ pending: true }, 202)

  // one use only: mark it consumed before handing out the token
  const { data: took } = await admin.from('glasses_links').update({ consumed_at: new Date().toISOString() }).eq('code', code).is('consumed_at', null).select('code')
  if (!took?.length) return json({ error: 'This code was already used.' }, 410)

  const { data: u, error: ue } = await admin.auth.admin.getUserById(row.user_id)
  const email = u?.user?.email
  if (ue || !email) return json({ error: 'Your account needs an email address to link glasses.' }, 409)
  const { data: link, error: le } = await admin.auth.admin.generateLink({ type: 'magiclink', email })
  const tokenHash = link?.properties?.hashed_token
  if (le || !tokenHash) return json({ error: 'Could not sign in the glasses. Try again.' }, 500)
  return json({ token_hash: tokenHash })
})
