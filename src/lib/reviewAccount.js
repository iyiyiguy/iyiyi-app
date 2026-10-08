// The App Review demo account starts fresh every time it signs out: purchases made on it
// (Pro, guns, UAVs) and its arcade progress are wiped, and the paywall shows again on the
// next sign-in, so every review / review video goes through the whole flow from scratch.
import AsyncStorage from '@react-native-async-storage/async-storage'
import { supabase } from './supabase'
import { apiFetch } from './api'
import { resetArcadeStats } from './arcadeStats'
import { clearPro } from './useIsPro'

export const REVIEW_EMAILS = ['appreview@iyiyi.xyz']

export const isReviewEmail = (email) => REVIEW_EMAILS.includes(String(email || '').trim().toLowerCase())

export async function isReviewAccount() {
  try {
    const { data } = await supabase.auth.getSession()
    return isReviewEmail(data?.session?.user?.email)
  } catch {
    return false
  }
}

/** Signs out; for the review account, wipes everything bought / earned on it first. */
export async function signOutAndReset() {
  try {
    const { data } = await supabase.auth.getSession()
    const user = data?.session?.user
    if (user && isReviewEmail(user.email)) {
      await apiFetch('/api/subscription/cancel', { method: 'POST' }).catch(() => {})
      await resetArcadeStats().catch(() => {})
      await AsyncStorage.removeItem(`iyiyi_paywall_seen_${user.id}`).catch(() => {})
      clearPro()
    }
  } catch {
    // Signing out must always work.
  }
  await supabase.auth.signOut().catch(() => {})
}
