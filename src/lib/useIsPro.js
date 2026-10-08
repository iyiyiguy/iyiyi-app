import { useCallback, useEffect, useState } from 'react'
import { useFocusEffect } from '@react-navigation/native'
import { apiJson } from './api'

// Whether the signed-in user is on a paid plan, for showing / hiding "Go Pro" prompts.
// null while unknown (prompts stay hidden until we know), then true / false. Cached across
// screens and refreshed whenever a screen using it comes into focus (e.g. after subscribing).
const PAID = ['pro', 'pro_local', 'pro_national', 'pro_all', 'premium', 'creator']
let cached = null
const listeners = new Set()

async function refresh() {
  try {
    const me = await apiJson('/api/profiles/me')
    const next = PAID.includes(me?.account_type)
    if (next !== cached) {
      cached = next
      listeners.forEach((l) => l(next))
    }
  } catch {
    // Keep what we had.
  }
}

export function clearPro() {
  cached = false
  listeners.forEach((l) => l(false))
}

export function markPro() {
  cached = true
  listeners.forEach((l) => l(true))
}

export default function useIsPro() {
  const [isPro, setIsPro] = useState(cached)
  useEffect(() => {
    listeners.add(setIsPro)
    return () => { listeners.delete(setIsPro) }
  }, [])
  useFocusEffect(useCallback(() => { refresh() }, []))
  return isPro
}
