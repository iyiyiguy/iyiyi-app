import { Platform, Alert } from 'react-native'
import { apiJson } from './api'
import { socialUrl, PLATFORM_LABELS } from './socialLinks'
import { supabase } from './supabase'


const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const csvCell = (v) => '"' + String(v ?? '').replace(/"/g, '""') + '"'
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString() : '')

function linkFor(l) {
  return socialUrl(l.platform, l.value) ?? l.value
}

function buildCsv(people) {
  const platforms = Object.keys(PLATFORM_LABELS)
  const header = ['Username', 'Type', 'Bio', 'Country', 'Tags', ...platforms.map((p) => PLATFORM_LABELS[p]), 'Websites', 'Photo', 'Times seen', 'First seen', 'Last seen']
  const rows = people.map((p) => {
    const byPlatform = {}
    for (const l of p.social_links) if (!byPlatform[l.platform]) byPlatform[l.platform] = linkFor(l)
    return [
      p.username, p.profile_label ?? p.account_type ?? '', p.bio ?? '', p.country ?? '', (p.tags ?? []).join('; '),
      ...platforms.map((k) => byPlatform[k] ?? ''),
      (p.websites ?? []).join('; '), p.avatar_url ?? '', p.encounter_count ?? 1, fmtDate(p.first_seen_at), fmtDate(p.last_seen_at),
    ].map(csvCell).join(',')
  })
  // BOM so Excel reads the file as UTF-8.
  return '﻿' + [header.map(csvCell).join(','), ...rows].join('\r\n')
}

function buildHtml(people) {
  const cards = people.map((p) => {
    const socials = (p.social_links ?? []).filter((l) => l?.value)
    const rows = socials
      .map((l) => {
        const label = PLATFORM_LABELS[l.platform] ?? l.platform
        const href = linkFor(l)
        const shown = String(l.value).replace(/^https?:\/\/(www\.)?/, '')
        return (
          '<tr><td class="plat">' + esc(label) + '</td>' +
          '<td class="val"><a href="' + esc(href) + '">' + esc(shown) + '</a></td></tr>'
        )
      })
      .concat(
        (p.websites ?? []).map((w) => {
          const href = /^https?:/.test(w) ? w : 'https://' + w
          return '<tr><td class="plat">Website</td><td class="val"><a href="' + esc(href) + '">' + esc(String(w).replace(/^https?:\/\/(www\.)?/, '')) + '</a></td></tr>'
        }),
      )
      .join('')
    const tags = (p.tags ?? []).map((t) => '<span class="chip">' + esc(t) + '</span>').join('')
    const initial = esc((p.username ?? '?').slice(0, 1).toUpperCase())
    const photo = p.avatar_url
      ? '<img class="photo" src="' + esc(p.avatar_url) + '" />'
      : '<div class="photo ph">' + initial + '</div>'
    return (
      '<div class="card">' +
      '<div class="left">' + photo + '</div>' +
      '<div class="right">' +
      '<div class="top"><span class="name">' + esc(p.username) + '</span>' +
      (p.profile_label ? '<span class="role">' + esc(p.profile_label) + '</span>' : '') + '</div>' +
      (p.country ? '<div class="meta">' + esc(p.country) + '</div>' : '') +
      (p.bio ? '<div class="bio">' + esc(p.bio) + '</div>' : '') +
      (tags ? '<div class="chips">' + tags + '</div>' : '') +
      (rows
        ? '<div class="h">Social accounts</div><table>' + rows + '</table>'
        : '<div class="meta">No social accounts shared</div>') +
      '<div class="seen">Met ' + esc(p.encounter_count ?? 1) + (Number(p.encounter_count ?? 1) === 1 ? ' time' : ' times') +
      ' &middot; first ' + esc(fmtDate(p.first_seen_at)) + ' &middot; last ' + esc(fmtDate(p.last_seen_at)) + '</div>' +
      '</div></div>'
    )
  }).join('')

  const css =
    '@page { margin: 28px 24px; }' +
    'body { font-family: -apple-system, Helvetica, Arial, sans-serif; color: #1a1220; margin: 0; }' +
    '.head { background: linear-gradient(135deg, #e0158b, #6c1fc9); color: #fff; padding: 22px 24px; border-radius: 14px; margin-bottom: 18px; }' +
    '.head h1 { font-size: 24px; margin: 0; letter-spacing: 0.3px; } .head .sub { font-size: 12px; opacity: 0.9; margin-top: 4px; }' +
    '.card { display: flex; gap: 16px; padding: 16px; margin-bottom: 12px; border: 1px solid #e4dbe8; border-radius: 14px; background: #fff; page-break-inside: avoid; }' +
    '.photo { width: 84px; height: 84px; border-radius: 42px; object-fit: cover; background: #eee; display: block; }' +
    '.ph { display: flex; align-items: center; justify-content: center; font-size: 34px; font-weight: 700; color: #fff; background: #b26be0; }' +
    '.right { flex: 1; min-width: 0; }' +
    '.name { font-weight: 800; font-size: 17px; } .role { margin-left: 8px; color: #e0158b; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; }' +
    '.bio { font-size: 12px; margin-top: 5px; line-height: 1.4; } .meta { color: #7a6f82; font-size: 11px; margin-top: 3px; }' +
    '.chips { margin-top: 7px; } .chip { display: inline-block; font-size: 10px; padding: 3px 8px; margin: 0 5px 4px 0; border-radius: 999px; background: #f3e9f8; color: #6c1fc9; font-weight: 600; }' +
    '.h { font-size: 10px; font-weight: 800; color: #7a6f82; text-transform: uppercase; letter-spacing: 0.8px; margin: 10px 0 4px; }' +
    'table { border-collapse: collapse; width: 100%; } td { font-size: 12px; padding: 4px 0; border-top: 1px solid #f0e8f3; }' +
    '.plat { width: 32%; font-weight: 700; color: #3a2d45; } .val { word-break: break-all; } a { color: #6c1fc9; text-decoration: none; }' +
    '.seen { color: #9a8fa2; font-size: 10px; margin-top: 8px; }' +
    '.foot { text-align: center; color: #9a8fa2; font-size: 10px; margin-top: 14px; }'

  return (
    '<html><head><meta name="viewport" content="width=device-width, initial-scale=1"/><style>' + css + '</style></head><body>' +
    '<div class="head"><h1>iYiYi contacts</h1><div class="sub">' + people.length + (people.length === 1 ? ' person' : ' people') +
    ' &middot; exported ' + esc(new Date().toLocaleDateString()) + '</div></div>' +
    cards +
    '<div class="foot">Only information each person chose to share publicly.</div>' +
    '</body></html>'
  )
}

// Keeps people seen inside [from, to] (either end may be null). Compares against the
// last time you crossed paths, so "last 7 days" means people you met in the last 7 days.
function inRange(p, from, to) {
  const seen = new Date(p.last_seen_at ?? p.first_seen_at ?? 0).getTime()
  if (from && seen < from.getTime()) return false
  if (to && seen > to.getTime()) return false
  return true
}

// Parses YYYY-MM-DD typed by the user; returns null when empty, undefined when invalid.
export function parseDay(text, endOfDay) {
  const t = (text ?? '').trim()
  if (!t) return null
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t)
  if (!m) return undefined
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), endOfDay ? 23 : 0, endOfDay ? 59 : 0, endOfDay ? 59 : 0)
  return Number.isNaN(d.getTime()) ? undefined : d
}

// opts: { format: 'pdf' | 'csv', from?: Date|null, to?: Date|null, method: 'share' | 'email' }
// Fetches the history with each person's public details, keeps the chosen date range,
// builds the file, then either opens the share sheet or an email to yourself with the
// file attached (falls back to the share sheet if no mail account is set up).
export async function exportHistory({ format, from = null, to = null, method = 'share' }) {
  if (Platform.OS === 'web') {
    Alert.alert('Not available on web', 'Exporting works in the iOS and Android apps.')
    return
  }
  const { people: all } = await apiJson('/api/locations/history/details')
  const people = (all ?? []).filter((p) => inRange(p, from, to))
  if (!people.length) {
    Alert.alert('Nothing to export', all?.length ? 'Nobody in that date range.' : 'People you cross paths with will show up here.')
    return
  }

  const stamp = new Date().toISOString().slice(0, 10)
  let uri
  let mimeType
  let UTI
  if (format === 'pdf') {
    const Print = await import('expo-print')
    uri = (await Print.printToFileAsync({ html: buildHtml(people) })).uri
    mimeType = 'application/pdf'
    UTI = 'com.adobe.pdf'
  } else {
    const FileSystem = await import('expo-file-system/legacy')
    uri = FileSystem.cacheDirectory + 'iyiyi-contacts-' + stamp + '.csv'
    await FileSystem.writeAsStringAsync(uri, buildCsv(people), { encoding: 'utf8' })
    mimeType = 'text/csv'
    UTI = 'public.comma-separated-values-text'
  }

  if (method === 'email') {
    const MailComposer = await import('expo-mail-composer')
    if (await MailComposer.isAvailableAsync()) {
      const { data } = await supabase.auth.getUser()
      await MailComposer.composeAsync({
        recipients: data?.user?.email ? [data.user.email] : [],
        subject: 'My iYiYi contacts (' + people.length + ') - ' + stamp,
        body: 'Attached: ' + people.length + ' people from your iYiYi history.',
        attachments: [uri],
      })
      return
    }
    Alert.alert('No mail account found', 'Choose where to send the file instead.')
  }
  const Sharing = await import('expo-sharing')
  await Sharing.shareAsync(uri, { mimeType, UTI, dialogTitle: 'Export contacts' })
}
