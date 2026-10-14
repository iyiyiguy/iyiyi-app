// Tiny translation layer. Every screen keeps its own dictionary in src/i18n/strings/<name>.js:
//
//   export default {
//     en: { title: 'Get seen by more people', count: '{n} people nearby' },
//     es: { title: 'Haz que más gente te vea', count: '{n} personas cerca' },
//     ...
//   }
//
// and uses it with:   const t = useT(strings);   t('count', { n: 3 })
//
// Missing keys or languages fall back to English, then to the key itself, so a half-finished
// translation never shows a blank. The chosen language is stored on the device; until the user
// picks one, the phone's own language is used when we support it.
import { useEffect, useState } from 'react'
import { I18nManager } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'

export const LANGUAGES = [
  { code: 'en', name: 'English', native: 'English' },
  { code: 'es', name: 'Spanish', native: 'Español' },
  { code: 'zh', name: 'Chinese (Simplified)', native: '简体中文' },
  { code: 'ja', name: 'Japanese', native: '日本語' },
  { code: 'ko', name: 'Korean', native: '한국어' },
  { code: 'fr', name: 'French', native: 'Français' },
  { code: 'de', name: 'German', native: 'Deutsch' },
  { code: 'pt', name: 'Portuguese (Brazil)', native: 'Português (Brasil)' },
  { code: 'ar', name: 'Arabic', native: 'العربية' },
  { code: 'hi', name: 'Hindi', native: 'हिन्दी' },
  { code: 'tl', name: 'Tagalog', native: 'Tagalog' },
]
const CODES = new Set(LANGUAGES.map((l) => l.code))
const KEY = 'iyiyi_language_v1'

function deviceBase() {
  try {
    const loc = Intl.DateTimeFormat().resolvedOptions().locale || 'en'
    const base = loc.toLowerCase().split(/[-_]/)[0]
    return base === 'fil' ? 'tl' : base
  } catch {
    return null
  }
}

function deviceLanguage() {
  const base = deviceBase()
  return base && CODES.has(base) ? base : 'en'
}

// True when the phone's own language is one we ship. First launch then skips the language
// picker (the app is already in the right language; it can be changed in Settings).
export const deviceLanguageSupported = () => {
  const base = deviceBase()
  return !!base && CODES.has(base)
}

// Right-to-left languages. React Native only applies a layout-direction change after the app
// is reloaded, so picking Arabic flips the layout on the next launch (the strings switch
// right away). Called on startup and whenever the language changes.
const RTL = new Set(['ar'])
function applyDirection(code) {
  const rtl = RTL.has(code)
  try {
    I18nManager.allowRTL(rtl)
    I18nManager.forceRTL(rtl)
  } catch {
    // Not available (e.g. tests); the layout simply stays left-to-right.
  }
}
export const isRTL = (code = lang) => RTL.has(code)

let lang = deviceLanguage()
applyDirection(lang)
let chosen = false // true once the user has picked a language (onboarding or Settings)
let loaded = false
const listeners = new Set()

export async function loadLanguage() {
  if (loaded) return { lang, chosen, supported: deviceLanguageSupported() }
  loaded = true
  try {
    const v = await AsyncStorage.getItem(KEY)
    if (v && CODES.has(v)) {
      lang = v
      chosen = true
      applyDirection(lang)
    }
  } catch {
    // Device language is fine.
  }
  listeners.forEach((l) => l(lang))
  return { lang, chosen, supported: deviceLanguageSupported() }
}

export const getLanguage = () => lang
export const hasChosenLanguage = () => chosen

export function setLanguage(code) {
  if (!CODES.has(code)) return
  lang = code
  chosen = true
  applyDirection(code) // takes effect after the next app reload
  AsyncStorage.setItem(KEY, code).catch(() => {})
  listeners.forEach((l) => l(code))
}

export function useLanguage() {
  const [l, setL] = useState(lang)
  useEffect(() => {
    listeners.add(setL)
    setL(lang)
    return () => { listeners.delete(setL) }
  }, [])
  return l
}

export function translate(dict, key, vars, code = lang) {
  let s = dict?.[code]?.[key] ?? dict?.en?.[key] ?? key
  if (vars) for (const k of Object.keys(vars)) s = s.split(`{${k}}`).join(String(vars[k]))
  return s
}

// Hook: re-renders the screen when the language changes.
export function useT(dict) {
  const code = useLanguage()
  return (key, vars) => translate(dict, key, vars, code)
}

export const languageName = (code) => LANGUAGES.find((l) => l.code === code)?.native ?? 'English'
