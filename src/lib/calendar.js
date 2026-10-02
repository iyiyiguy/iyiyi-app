// "Add to calendar": one tap writes the event (with a 30-minute alert) straight into the
// device's default calendar via expo-calendar. If calendar access is denied, unavailable, or
// anything fails, it falls back to the old choice: a standard .ics file handed to the share
// sheet (Calendar / Mail / Files / Google Calendar app can take it), or a prefilled Google
// Calendar page.
//
// Permission note: app.json configures the expo-calendar plugin without `writeOnlyAccess`, so
// only the full-access usage strings exist in Info.plist. Requesting write-only access would
// crash on iOS 17+ (missing NSCalendarsWriteOnlyAccessUsageDescription) - always ask for full.
import { Alert, Linking, Platform } from 'react-native'
import * as Sharing from 'expo-sharing'
import { File, Paths } from 'expo-file-system'
import { defaultEnd, eventPlace, eventShareUrl } from './events'

const pad = (n) => String(n).padStart(2, '0')
const icsDate = (d) =>
  `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`

// RFC 5545 text escaping + 75-octet line folding (approximated by characters).
const esc = (s) => String(s ?? '').replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/([,;])/g, '\\$1')
function fold(line) {
  if (line.length <= 74) return line
  const parts = []
  for (let i = 0; i < line.length; i += 73) parts.push((i ? ' ' : '') + line.slice(i, i + 73))
  return parts.join('\r\n')
}

function eventTimes(event) {
  const start = new Date(event?.event_date)
  if (Number.isNaN(start.getTime())) throw new Error('This event has no valid date.')
  const end = defaultEnd(event) || new Date(start.getTime() + 2 * 3600 * 1000)
  return { start, end }
}

export function buildIcs(event) {
  const { start, end } = eventTimes(event)
  const url = eventShareUrl(event.id)
  const desc = [event.description, url].filter(Boolean).join('\n\n')
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//iYiYi//Events//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${esc(event.id)}@iyiyi.xyz`,
    `DTSTAMP:${icsDate(new Date())}`,
    `DTSTART:${icsDate(start)}`,
    `DTEND:${icsDate(end)}`,
    `SUMMARY:${esc(event.name)}`,
    `DESCRIPTION:${esc(desc)}`,
    `LOCATION:${esc([event.location, event.address].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(', '))}`,
    `URL:${url}`,
  ]
  if (Number.isFinite(event.latitude) && Number.isFinite(event.longitude)) lines.push(`GEO:${event.latitude};${event.longitude}`)
  lines.push('BEGIN:VALARM', 'TRIGGER:-PT30M', 'ACTION:DISPLAY', `DESCRIPTION:${esc(event.name)}`, 'END:VALARM')
  lines.push('END:VEVENT', 'END:VCALENDAR')
  return lines.map(fold).join('\r\n') + '\r\n'
}

export function googleCalendarUrl(event) {
  const { start, end } = eventTimes(event)
  const params = [
    ['action', 'TEMPLATE'],
    ['text', event.name || 'Event'],
    ['dates', `${icsDate(start)}/${icsDate(end)}`],
    ['details', [event.description, eventShareUrl(event.id)].filter(Boolean).join('\n\n')],
    ['location', eventPlace(event)],
  ]
  return `https://calendar.google.com/calendar/render?${params.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&')}`
}

async function shareIcs(event) {
  const ics = buildIcs(event)
  const safeName = String(event.name || 'event').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').slice(0, 40) || 'event'
  if (Platform.OS === 'web') {
    const blob = new Blob([ics], { type: 'text/calendar' })
    const href = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = href
    a.download = `${safeName}.ics`
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(href), 2000)
    return
  }
  const file = new File(Paths.cache, `${safeName}.ics`)
  try { if (file.exists) file.delete() } catch { /* overwritten below */ }
  file.create({ overwrite: true })
  file.write(ics)
  if (!(await Sharing.isAvailableAsync())) throw new Error('Sharing isn’t available on this device.')
  await Sharing.shareAsync(file.uri, { mimeType: 'text/calendar', UTI: 'com.apple.ical.ics', dialogTitle: 'Add to calendar' })
}

const ALERT_MINUTES_BEFORE = 30

// Loaded lazily: requireNativeModule throws at import time when the native module isn't in
// the binary (e.g. an older dev build), and a top-level import would take the whole app down.
let calendarModule
function getCalendarModule() {
  if (calendarModule === undefined) {
    try {
      calendarModule = require('expo-calendar') // eslint-disable-line global-require
    } catch (e) {
      console.warn('expo-calendar unavailable', e?.message ?? e)
      calendarModule = null
    }
  }
  return calendarModule
}

// Event ids already written this session (event.id -> calendar event id), so a second tap
// asks before adding a duplicate.
const added = new Map()

function locationText(event) {
  return [event?.location, event?.address].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(', ')
}

async function pickWritableCalendar(Calendar) {
  if (Platform.OS === 'ios') {
    try {
      const cal = Calendar.getDefaultCalendarSync()
      if (cal) return cal
    } catch {
      // Fall through to the list.
    }
  }
  const all = await Calendar.getCalendars(Platform.OS === 'ios' ? (Calendar.EntityTypes?.EVENT ?? 'event') : undefined)
  const list = Array.isArray(all) ? all : []
  return (
    list.find((c) => c?.allowsModifications && c?.isPrimary)
    || list.find((c) => c?.allowsModifications)
    || null
  )
}

// Writes the event into the default calendar. Resolves to the new calendar event id, or
// throws { code: 'denied' } / an Error the caller turns into the .ics fallback.
async function addNative(event) {
  if (Platform.OS === 'web') throw Object.assign(new Error('Not supported on web'), { code: 'unavailable' })
  const Calendar = getCalendarModule()
  if (!Calendar || typeof Calendar.requestCalendarPermissions !== 'function') {
    throw Object.assign(new Error('Calendar unavailable'), { code: 'unavailable' })
  }
  let perm = null
  try {
    perm = await Calendar.getCalendarPermissions(false)
  } catch {
    perm = null
  }
  if (!perm?.granted) perm = await Calendar.requestCalendarPermissions(false)
  if (!perm?.granted) throw Object.assign(new Error('Calendar access was not allowed'), { code: 'denied' })

  const cal = await pickWritableCalendar(Calendar)
  if (!cal || typeof cal.createEvent !== 'function') {
    throw Object.assign(new Error('No calendar available to add to'), { code: 'unavailable' })
  }
  const { start, end } = eventTimes(event)
  const url = eventShareUrl(event.id)
  let timeZone
  try {
    timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || undefined
  } catch {
    timeZone = undefined
  }
  const details = {
    title: String(event.name || 'iYiYi event'),
    startDate: start,
    endDate: end,
    location: locationText(event) || undefined,
    notes: [event.description, url].filter(Boolean).join('\n\n'),
    url,
    alarms: [{ relativeOffset: -ALERT_MINUTES_BEFORE }],
  }
  if (timeZone) details.timeZone = timeZone
  const created = await cal.createEvent(details)
  return created?.id ?? true
}

// Opens the iOS Calendar app on the event's day (calshow takes seconds since 2001-01-01).
function openCalendarApp(event) {
  try {
    const { start } = eventTimes(event)
    const ref = Date.UTC(2001, 0, 1)
    const secs = Math.floor((start.getTime() - ref) / 1000)
    Linking.openURL(Platform.OS === 'ios' ? `calshow:${secs}` : `content://com.android.calendar/time/${start.getTime()}`).catch(() => {})
  } catch {
    // Nothing to open.
  }
}

// The old two-option chooser (.ics / Google). Never throws.
function offerFallback(event, reason) {
  const run = (fn) => async () => {
    try {
      await fn()
    } catch (e) {
      Alert.alert('Couldn’t add to calendar', e?.message || 'Please try again.')
    }
  }
  const openGoogle = run(() => Linking.openURL(googleCalendarUrl(event)))
  const ics = run(() => shareIcs(event))
  if (Platform.OS === 'web') {
    ics()
    return
  }
  const buttons = [
    { text: Platform.OS === 'ios' ? 'Apple Calendar / other (.ics)' : 'Calendar file (.ics)', onPress: ics },
    { text: 'Google Calendar', onPress: openGoogle },
  ]
  if (reason === 'denied') buttons.push({ text: 'Allow in Settings', onPress: () => { Linking.openSettings().catch(() => {}) } })
  buttons.push({ text: 'Cancel', style: 'cancel' })
  Alert.alert(
    'Add to calendar',
    reason === 'denied'
      ? 'iYiYi doesn’t have calendar access, so pick another way to save this event.'
      : (event.name || 'Event'),
    buttons,
  )
}

// One tap: writes the event straight into the default calendar with an alert 30 minutes
// before. Falls back to the .ics / Google chooser when that isn't possible.
// Resolves to 'added' | 'duplicate-skipped' | 'fallback' | 'error'. Never throws.
export async function addToCalendar(event, { skipDuplicateCheck = false } = {}) {
  if (!event) return 'error'
  try {
    eventTimes(event) // validates the date up front
  } catch (e) {
    Alert.alert('Couldn’t add to calendar', e?.message || 'This event has no valid date.')
    return 'error'
  }
  const key = String(event.id ?? event.name ?? '')
  if (!skipDuplicateCheck && key && added.has(key)) {
    return new Promise((resolve) => {
      Alert.alert('Already in your calendar', 'You added this event earlier. Add it again?', [
        { text: 'Open Calendar', onPress: () => { openCalendarApp(event); resolve('duplicate-skipped') } },
        { text: 'Add again', onPress: () => { addToCalendar(event, { skipDuplicateCheck: true }).then(resolve, () => resolve('error')) } },
        { text: 'Cancel', style: 'cancel', onPress: () => resolve('duplicate-skipped') },
      ], { cancelable: true, onDismiss: () => resolve('duplicate-skipped') })
    })
  }
  try {
    const id = await addNative(event)
    if (key) added.set(key, id)
    Alert.alert(
      'Added to your calendar',
      `${event.name || 'Event'} · you’ll get an alert ${ALERT_MINUTES_BEFORE} minutes before it starts.`,
      [
        { text: 'Open Calendar', onPress: () => openCalendarApp(event) },
        { text: 'OK', style: 'cancel' },
      ],
    )
    return 'added'
  } catch (e) {
    if (e?.code !== 'denied') console.warn('Native calendar add failed, offering .ics', e?.message ?? e)
    offerFallback(event, e?.code === 'denied' ? 'denied' : 'failed')
    return 'fallback'
  }
}
