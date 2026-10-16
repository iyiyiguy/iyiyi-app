// iyiyi.xyz Worker: serves the static site (./public) and one API route.
//
// POST /api/report-mail { report_id }  (sent by the app right after a copyright report)
//   -> Supabase rpc claim_report_email(report_id): returns the report once, within 30 minutes
//      of filing, and marks it emailed (so this can't be replayed or used to spam).
//   -> emails it to the admin through Cloudflare Email Routing (send_email binding MAIL).
// The app passes its public Supabase key in the apikey header; nothing secret is stored here.
import { EmailMessage } from 'cloudflare:email'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'content-type, apikey',
}
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const clean = (v, n = 2000) => String(v ?? '').replace(/[\r\n]+/g, ' ').slice(0, n)

async function reportMail(request, env) {
  let id = ''
  try { id = String((await request.json())?.report_id || '') } catch {}
  const apikey = request.headers.get('apikey') || ''
  if (!UUID.test(id) || !apikey) return json({ error: 'bad request' }, 400)

  const r = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/claim_report_email`, {
    method: 'POST',
    headers: { apikey, Authorization: `Bearer ${apikey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_report: id }),
  })
  if (!r.ok) return json({ error: 'lookup failed' }, 502)
  const rep = await r.json()
  if (!rep) return json({ ok: true, sent: false }) // already emailed, expired or unknown

  const soundUrl = `https://app.iyiyi.xyz/sound/${rep.sound_id}`
  const subject = `Copyright report: "${clean(rep.sound_title, 80)}" by @${clean(rep.creator || 'member', 40)}`
  const text = [
    `A sound was reported for copyright on iYiYi.`,
    ``,
    `Sound: ${clean(rep.sound_title, 200)}`,
    `Creator: @${clean(rep.creator || 'member', 60)}`,
    `Status: ${clean(rep.status, 20)} · used in ${rep.use_count ?? 0} videos · ${rep.open_reports ?? 1} open report(s)`,
    `Listen: ${clean(rep.audio_url, 500)}`,
    `Sound page: ${soundUrl}`,
    ``,
    `Reported by: @${clean(rep.reporter || 'member', 60)}${rep.owns_work ? ' (says they own the work or represent the owner)' : ''}`,
    `Contact: ${clean(rep.contact_email || 'not given', 200)}`,
    `Reason: ${clean(rep.reason, 2000)}`,
    ``,
    `If nobody reviews it, the sound is muted 12 hours after the first report.`,
    `Review it in the app: Me > My music & playlists > shield icon (Copyright reports).`,
  ].join('\r\n')

  const from = env.MAIL_FROM || 'reports@iyiyi.xyz'
  const to = env.MAIL_TO || 'iyiyiguy@gmail.com'
  const raw = [
    `From: iYiYi Reports <${from}>`,
    `To: ${to}`,
    `Subject: ${subject}`,
    `Message-ID: <${id}@iyiyi.xyz>`,
    `Date: ${new Date().toUTCString()}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: 8bit',
    '',
    text,
  ].join('\r\n')
  try {
    await env.MAIL.send(new EmailMessage(from, to, raw))
  } catch (e) {
    return json({ error: 'send failed', detail: String(e).slice(0, 200) }, 502)
  }
  return json({ ok: true, sent: true })
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    if (url.pathname === '/api/report-mail') {
      if (request.method === 'OPTIONS') return new Response(null, { headers: CORS })
      if (request.method === 'POST') return reportMail(request, env)
      return json({ error: 'POST only' }, 405)
    }
    return env.ASSETS.fetch(request)
  },
}
