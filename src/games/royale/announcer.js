// Zone / match callouts: a banner, a sound, a rumble and a spoken voice line.
//
// Voice uses expo-speech. It follows the arcade "Sound effects" setting (gamePrefs.sound) and
// an optional `voice` pref (off only when explicitly false). A new callout always stops the
// previous one first so lines never talk over each other. Every speech call is wrapped: the
// voice is a nice-to-have and must never throw into render/effects.
import { useCallback, useEffect, useRef, useState } from 'react'
import { buzz, getPrefs } from '../../lib/gamePrefs'
import { playSfx } from './weaponsAdapter'
import { getLanguage, translate } from '../../i18n'
import S from '../../i18n/strings/royale'

const tr = (k, v) => translate(S, k, v)
// Voice language for the app language (callouts are shown and spoken in it).
const VOICE = { en: 'en-US', es: 'es-ES', zh: 'zh-CN', ja: 'ja-JP', ko: 'ko-KR', fr: 'fr-FR', de: 'de-DE', pt: 'pt-BR', ar: 'ar-SA', hi: 'hi-IN', tl: 'fil-PH' }

const TONES = {
  // Studio role colours: info = friendly, warn = objective/zone, danger = enemy, good = health.
  info: { sfx: 'beep', haptic: 'select', color: '#39d5ff', rate: 1.0, pitch: 1.0 },
  warn: { sfx: 'beep', haptic: 'warning', color: '#ffb21e', rate: 1.05, pitch: 1.0 },
  danger: { sfx: 'planted', haptic: 'warning', color: '#ff3d52', rate: 1.1, pitch: 0.95 },
  good: { sfx: 'tap', haptic: 'success', color: '#5cf2a0', rate: 1.0, pitch: 1.05 },
}

const ABBREV_DIRS = {
  N: 'north', S: 'south', E: 'east', W: 'west',
  NE: 'north-east', NW: 'north-west', SE: 'south-east', SW: 'south-west',
}

// Loaded lazily so a binary without the native module can't crash on import.
let speechModule
function getSpeech() {
  if (speechModule === undefined) {
    try {
      speechModule = require('expo-speech') // eslint-disable-line global-require
    } catch {
      speechModule = null
    }
  }
  return speechModule
}

function voiceEnabled() {
  try {
    const p = getPrefs() || {}
    return p.sound !== false && p.voice !== false
  } catch {
    return false
  }
}

// Banner text -> something a voice can read: no bullets/dashes, units spelled out, damage
// rates (" −5/s") dropped, "#3" -> "number 3".
export function spokenText(title, sub) {
  // The unit / number rewrites below are English; other languages only get the punctuation clean-up.
  if (getLanguage() !== 'en') {
    const tidy = (s) => String(s ?? '').replace(/[−-]\s?\d+(\.\d+)?\/s/g, '').replace(/[·•—–|]/g, ',').replace(/\s*,\s*(,\s*)*/g, ', ').replace(/\s+/g, ' ').replace(/^[\s,]+|[\s,]+$/g, '')
    const a = tidy(title)
    const b = tidy(sub)
    return a && b ? `${a}. ${b}` : a || b
  }
  const clean = (s) => String(s ?? '')
    .replace(/[−-]\s?\d+(\.\d+)?\/s/g, '')
    .replace(/#(\d+)/g, 'number $1')
    .replace(/(\d)\s?ft\b/g, '$1 feet')
    .replace(/(\d)\s?mi\b/g, '$1 miles')
    .replace(/\b(\d+):(\d{2})\b/g, (_, mm, ss) => {
      const m = Number(mm)
      const s = Number(ss)
      const parts = []
      if (m) parts.push(`${m} minute${m === 1 ? '' : 's'}`)
      if (s || !m) parts.push(`${s} second${s === 1 ? '' : 's'}`)
      return parts.join(' ')
    })
    .replace(/\b(NE|NW|SE|SW|N|S|E|W)\b/g, (d) => ABBREV_DIRS[d] || d)
    .replace(/[·•—–|]/g, ',')
    .replace(/\s*,\s*(,\s*)*/g, ', ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s,]+|[\s,]+$/g, '')
  const a = clean(title)
  const b = clean(sub)
  if (!a) return b
  if (!b) return a
  return /[.!?]$/.test(a) ? `${a} ${b}` : `${a}. ${b}`
}

export function stopSpeaking() {
  try {
    const Speech = getSpeech()
    if (!Speech?.stop) return
    const p = Speech.stop()
    if (p && typeof p.catch === 'function') p.catch(() => {})
  } catch {
    // Speech is optional.
  }
}

export function speakCallout(text, tone = 'info') {
  if (!text || !voiceEnabled()) return
  const def = TONES[tone] || TONES.info
  try {
    const Speech = getSpeech()
    if (!Speech?.speak) return
    stopSpeaking() // never overlap: the newest callout wins
    const max = Number(Speech.maxSpeechInputLength) || 4000
    Speech.speak(String(text).slice(0, Math.min(max, 400)), {
      language: VOICE[getLanguage()] || 'en-US',
      rate: def.rate,
      pitch: def.pitch,
      onError: () => {},
    })
  } catch {
    // Fail silently.
  }
}

export function useAnnouncer() {
  const [banner, setBanner] = useState(null) // { title, sub, color, tone, key }
  const timer = useRef(null)
  const lastText = useRef({ text: '', at: 0 })

  const announce = useCallback((title, { sub = null, tone = 'info', ms = 4500, speak = true } = {}) => {
    const t = Date.now()
    // Don't repeat the same callout within a few seconds.
    if (lastText.current.text === title && t - lastText.current.at < 6000) return
    lastText.current = { text: title, at: t }
    const def = TONES[tone] || TONES.info
    setBanner({ title: String(title), sub: sub ? String(sub) : null, color: def.color, tone: TONES[tone] ? tone : 'info', key: t })
    playSfx(def.sfx)
    buzz(def.haptic)
    if (speak) speakCallout(spokenText(title, sub), tone)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setBanner(null), ms)
  }, [])

  useEffect(() => () => {
    clearTimeout(timer.current)
    stopSpeaking()
  }, [])
  return { banner, announce }
}

// "N players remaining" callouts. Call from the game with the live count of players still
// alive (including you) and the announcer's `announce`:
//   usePlayersRemainingCallout(aliveCount, announce, playing)
// Speaks at milestones (50, 25, 10, 5, 3, 2) and not more than once every 15 s.
const REMAINING_MILESTONES = [50, 25, 10, 5, 3, 2]
export function usePlayersRemainingCallout(count, announce, enabled = true) {
  const last = useRef({ count: null, at: 0, said: new Set() })
  useEffect(() => {
    try {
      const n = Number(count)
      if (!enabled || !Number.isFinite(n) || n <= 0 || typeof announce !== 'function') return
      const s = last.current
      const prev = s.count
      s.count = n
      if (prev == null || n >= prev) return
      const hit = REMAINING_MILESTONES.find((m) => n <= m && prev > m && !s.said.has(m))
      if (hit == null || Date.now() - s.at < 15000) return
      s.said.add(hit)
      s.at = Date.now()
      announce(n === 2 ? tr('final_two') : tr('n_remaining', { n }), { tone: n <= 3 ? 'warn' : 'info', ms: 3000 })
    } catch {
      // Callouts are optional.
    }
  }, [count, enabled, announce])
}
