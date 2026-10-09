import { useCallback, useEffect, useState } from 'react'
import { useFocusEffect } from '@react-navigation/native'
import { apiJson } from './api'

// Whether the signed-in user is on a paid plan, for showing / hiding "Go Pro" prompts.
// null while unknown (prompts stay hidden until we know), then true / false. Cached across
// screens and refreshed whenever a screen using it comes into focus (e.g. after subscribing).
const PAID = ['pro', 'pro_local', 'pro_national', 'pro_all', 'premium', 'creator', 'business', 'business_pro']
const BUSINESS_TIERS = ['business', 'business_pro']
let cached = null
let cachedTier = null
const listeners = new Set()
const tierListeners = new Set()

async function refresh() {
  try {
    const me = await apiJson('/api/profiles/me')
    const next = PAID.includes(me?.account_type)
    if (next !== cached) {
      cached = next
      listeners.forEach((l) => l(next))
    }
    const nextTier = me?.account_type ?? null
    if (nextTier !== cachedTier) {
      cachedTier = nextTier
      tierListeners.forEach((l) => l(nextTier))
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

/** Returns true when the user is on a Business Pro plan. */
export function useIsBusinessPro() {
  const [tier, setTier] = useState(cachedTier)
  useEffect(() => {
    tierListeners.add(setTier)
    return () => { tierListeners.delete(setTier) }
  }, [])
  useFocusEffect(useCallback(() => { refresh() }, []))
  return BUSINESS_TIERS.includes(tier)
}

/** Returns the raw account_type string (null while unknown). */
export function useAccountTier() {
  const [tier, setTier] = useState(cachedTier)
  useEffect(() => {
    tierListeners.add(setTier)
    return () => { tierListeners.delete(setTier) }
  }, [])
  useFocusEffect(useCallback(() => { refresh() }, []))
  return tier
}
