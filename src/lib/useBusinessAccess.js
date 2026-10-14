import { useCallback, useRef, useState } from 'react'
import { useFocusEffect } from '@react-navigation/native'
import { apiJson } from './api'

// Business Pro entitlement for the Business tools screens.
//
// Same source of truth as useIsPro / useIsBusinessPro (profiles.account_type from
// /api/profiles/me, set by the backend after it verifies the store receipt), but with explicit
// states, so screens never fetch business data before the entitlement is known and never lock a
// paying customer out because one request failed:
//   status: 'loading' | 'business' | 'not_business' | 'error'
//   profile: the /api/profiles/me row (username, display_name, bio, social_links, ...)
export const BUSINESS_TIERS = ['business', 'business_pro']
export const isBusinessTier = (tier) => BUSINESS_TIERS.includes(tier)

let cachedProfile = null

export default function useBusinessAccess() {
  const [profile, setProfile] = useState(cachedProfile)
  const [status, setStatus] = useState(cachedProfile ? (isBusinessTier(cachedProfile.account_type) ? 'business' : 'not_business') : 'loading')
  const [error, setError] = useState(null)
  const seq = useRef(0)

  const load = useCallback(async () => {
    const id = ++seq.current
    if (!cachedProfile) setStatus('loading')
    setError(null)
    try {
      const me = await apiJson('/api/profiles/me')
      if (id !== seq.current) return
      cachedProfile = me
      setProfile(me)
      setStatus(isBusinessTier(me?.account_type) ? 'business' : 'not_business')
    } catch (e) {
      if (id !== seq.current) return
      setError(e?.message || null)
      // Keep a known answer from earlier; only show the error state when we have none.
      if (!cachedProfile) setStatus('error')
    }
  }, [])

  useFocusEffect(useCallback(() => { load() }, [load]))

  return { status, profile, error, retry: load }
}
