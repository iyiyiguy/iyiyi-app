// Voice control for the camera: say "take a photo" / "cheese", "start recording" / "action",
// "stop" / "cut" (and the same in every app language). Uses the phone's speech recognizer
// (expo-speech-recognition: SFSpeechRecognizer on iOS, SpeechRecognizer on Android).
//
// useVoiceCommands({ enabled, lang, onCommand }) listens while enabled and calls
// onCommand('photo' | 'record' | 'stop'). It restarts itself when the recognizer ends (it stops
// after silence on some phones) and after each command (so the same words don't fire twice).
import { useEffect, useRef, useState } from 'react'
import { Platform } from 'react-native'

let Speech = null
try {
  // Missing in binaries built before voice control was added: then voice is simply unavailable.
  Speech = require('expo-speech-recognition')
} catch {
  Speech = null
}
const mod = () => Speech?.ExpoSpeechRecognitionModule || null

export function voiceAvailable() {
  try { return !!mod() && (mod().isRecognitionAvailable?.() ?? true) } catch { return false }
}

// Phrases per language (lowercase, accents kept; matched as whole words at the end of what was said).
const COMMANDS = {
  en: { photo: ['take a photo', 'take a picture', 'take photo', 'take picture', 'photo', 'picture', 'cheese', 'snap', 'shoot'], record: ['start recording', 'start video', 'record', 'recording', 'action', 'roll'], stop: ['stop recording', 'stop', 'cut', 'end video', "that's a wrap"] },
  es: { photo: ['toma una foto', 'tómame una foto', 'saca una foto', 'foto', 'whisky', 'patata', 'cheese'], record: ['empieza a grabar', 'graba', 'grabar', 'grabando', 'acción', 'video'], stop: ['deja de grabar', 'para', 'detente', 'detener', 'alto', 'corta', 'corte', 'stop'] },
  pt: { photo: ['tira uma foto', 'tirar foto', 'foto', 'xis', 'cheese'], record: ['começa a gravar', 'grava', 'gravar', 'gravando', 'ação', 'vídeo'], stop: ['para de gravar', 'para', 'parar', 'pare', 'corta', 'stop'] },
  fr: { photo: ['prends une photo', 'prendre une photo', 'photo', 'ouistiti', 'cheese'], record: ['commence à filmer', 'filme', 'enregistre', 'enregistrer', 'action', 'moteur'], stop: ['arrête de filmer', 'arrête', 'arrêter', 'stop', 'coupez', 'coupe'] },
  de: { photo: ['mach ein foto', 'foto machen', 'foto', 'bild', 'cheese'], record: ['aufnahme starten', 'nimm auf', 'aufnehmen', 'aufnahme', 'action', 'video'], stop: ['aufnahme stoppen', 'stopp', 'stop', 'halt', 'schnitt', 'aus'] },
  zh: { photo: ['拍照', '拍张照', '照相', '茄子'], record: ['开始录像', '开始录制', '录像', '录制', '开拍'], stop: ['停止录像', '停止', '停', '结束', '卡'] },
  ja: { photo: ['写真を撮って', '写真撮って', '写真', '撮影', 'はいチーズ', 'チーズ'], record: ['録画開始', '録画して', '録画', 'スタート', 'アクション'], stop: ['録画停止', 'ストップ', '止めて', '停止', 'カット'] },
  ko: { photo: ['사진 찍어', '사진 찍어줘', '사진', '찰칵', '김치'], record: ['녹화 시작', '녹화해', '녹화', '촬영 시작', '액션'], stop: ['녹화 중지', '멈춰', '중지', '그만', '컷', '스톱'] },
  ar: { photo: ['التقط صورة', 'صورة', 'صوّر', 'تشيز'], record: ['ابدأ التسجيل', 'سجّل', 'سجل', 'تسجيل', 'أكشن'], stop: ['أوقف التسجيل', 'توقف', 'قف', 'إيقاف', 'كت', 'ستوب'] },
  hi: { photo: ['फोटो लो', 'फ़ोटो लो', 'फोटो खींचो', 'फोटो', 'फ़ोटो', 'चीज़'], record: ['रिकॉर्डिंग शुरू करो', 'रिकॉर्ड करो', 'रिकॉर्ड', 'रिकॉर्डिंग', 'एक्शन'], stop: ['रिकॉर्डिंग बंद करो', 'रुको', 'बंद करो', 'बंद', 'कट', 'स्टॉप'] },
  tl: { photo: ['kunan mo ako ng litrato', 'kuha ng litrato', 'litrato', 'picture', 'photo', 'cheese'], record: ['simulan ang pag-record', 'mag-record', 'record', 'action', 'video'], stop: ['itigil ang pag-record', 'tigil', 'itigil', 'hinto', 'stop', 'cut'] },
}

const LOCALE = { en: 'en-US', es: 'es-MX', pt: 'pt-BR', fr: 'fr-FR', de: 'de-DE', zh: 'zh-CN', ja: 'ja-JP', ko: 'ko-KR', ar: 'ar-SA', hi: 'hi-IN', tl: 'fil-PH' }

const norm = (s) => String(s || '').toLowerCase().replace(/[.,!?¡¿。、！？،]/g, ' ').replace(/\s+/g, ' ').trim()
const SPACELESS = new Set(['zh', 'ja'])

/** -> 'photo' | 'record' | 'stop' | null for the end of a transcript. English always works too. */
export function matchCommand(text, lang = 'en') {
  const t = norm(text)
  if (!t) return null
  const tables = lang === 'en' ? [['en', COMMANDS.en]] : [[lang, COMMANDS[lang] || {}], ['en', COMMANDS.en]]
  const tail = t.split(' ').slice(-6).join(' ')
  let best = null
  for (const [code, table] of tables) {
    for (const cmd of ['stop', 'record', 'photo']) {
      for (const phrase of table[cmd] || []) {
        const p = norm(phrase)
        const hit = SPACELESS.has(code) ? tail.includes(p) : (` ${tail} `).includes(` ${p} `)
        // the phrase nearest the end of what was said wins
        if (hit) {
          const at = tail.lastIndexOf(p) + p.length
          if (!best || at > best.at || (at === best.at && p.length > best.len)) best = { cmd, at, len: p.length }
        }
      }
    }
  }
  return best?.cmd || null
}

export function useVoiceCommands({ enabled, lang = 'en', onCommand }) {
  const [listening, setListening] = useState(false)
  const [heard, setHeard] = useState('')
  const cb = useRef(onCommand)
  cb.current = onCommand
  const want = useRef(false)
  const lastFire = useRef(0)
  const restartTimer = useRef(null)

  const start = async () => {
    const m = mod()
    if (!m || !want.current) return
    try {
      m.start({
        lang: LOCALE[lang] || 'en-US',
        interimResults: true,
        continuous: true,
        maxAlternatives: 1,
        addsPunctuation: false,
        contextualStrings: [...(COMMANDS[lang]?.photo || []), ...(COMMANDS[lang]?.record || []), ...(COMMANDS[lang]?.stop || []), 'cheese', 'action', 'cut'].slice(0, 40),
        iosTaskHint: 'confirmation',
        // share the session with the camera (it records sound too)
        iosCategory: { category: 'playAndRecord', categoryOptions: ['defaultToSpeaker', 'allowBluetooth', 'mixWithOthers'], mode: 'videoRecording' },
        androidIntentOptions: { EXTRA_LANGUAGE_MODEL: 'web_search' },
      })
    } catch {}
  }
  const restartSoon = (ms = 300) => {
    clearTimeout(restartTimer.current)
    restartTimer.current = setTimeout(() => { if (want.current) start() }, ms)
  }

  useEffect(() => {
    const m = mod()
    if (!m) return undefined
    const subs = []
    const on = (name, fn) => { try { subs.push(m.addListener(name, fn)) } catch {} }
    on('start', () => setListening(true))
    on('end', () => { setListening(false); if (want.current) restartSoon(400) })
    on('error', (e) => {
      setListening(false)
      // not-allowed / service-not-allowed: stop trying; anything else (no-speech, network): retry
      if (/not-allowed|service-not-allowed|language-not-supported/.test(e?.error || '')) { want.current = false; return }
      if (want.current) restartSoon(1200)
    })
    on('result', (e) => {
      const text = e?.results?.[0]?.transcript || ''
      setHeard(text)
      const cmd = matchCommand(text, lang)
      if (!cmd) return
      const now = Date.now()
      if (now - lastFire.current < 1500) return
      lastFire.current = now
      cb.current?.(cmd)
      // clear what was heard so the same words don't trigger again
      try { m.abort() } catch {}
      restartSoon(500)
    })
    return () => subs.forEach((s) => { try { s.remove() } catch {} })
  }, [lang])

  useEffect(() => {
    const m = mod()
    if (!m) return undefined
    let alive = true
    if (enabled) {
      want.current = true
      ;(async () => {
        try {
          const p = await m.requestPermissionsAsync()
          if (!alive) return
          if (!p?.granted) { want.current = false; cb.current?.('denied'); return }
        } catch {}
        start()
      })()
    } else {
      want.current = false
      clearTimeout(restartTimer.current)
      try { m.abort() } catch {}
    }
    return () => { alive = false }
  }, [enabled, lang])

  useEffect(() => () => { want.current = false; clearTimeout(restartTimer.current); try { mod()?.abort() } catch {} }, [])

  return { listening, heard, available: !!mod() && Platform.OS !== 'web' ? true : !!mod() }
}
