import { useEffect, useState } from 'react'
import { apiJson } from './api'

// Follow state for a list of profile cards. Returns { statuses, setStatus } where
// statuses maps user id -> 'accepted' | 'pending' (missing = not following).
export function useFollowStatuses(users, idKey = 'user_id') {
  const [statuses, setStatuses] = useState({})
  const idsKey = (users ?? []).map((u) => u[idKey] ?? u.id).filter(Boolean).join(',')

  useEffect(() => {
    if (!idsKey) return
    let cancelled = false
    apiJson(`/api/follows/status?ids=${idsKey}`)
      .then((d) => { if (!cancelled) setStatuses((prev) => ({ ...prev, ...d.statuses })) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [idsKey])

  const setStatus = (id, status) => setStatuses((prev) => ({ ...prev, [id]: status }))
  return { statuses, setStatus }
}
