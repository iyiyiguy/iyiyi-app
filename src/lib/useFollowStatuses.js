import { useCallback, useEffect, useRef, useState } from 'react'
import { apiJson } from './api'

const CHUNK = 100

// Follow state for a list of profile cards. Returns { statuses, setStatus } where
// statuses maps user id -> 'accepted' | 'pending' (missing = not following).
//
// Only ids we haven't asked about yet are requested, so a list that merely reorders (the
// Nearby poll does that every few seconds) or grows by one costs at most one small request,
// and long lists go out in chunks instead of one unbounded query string.
export function useFollowStatuses(users, idKey = 'user_id') {
  const [statuses, setStatuses] = useState({})
  const asked = useRef(new Set())
  const ids = Array.from(new Set((users ?? []).map((u) => u?.[idKey] ?? u?.id).filter(Boolean).map(String))).sort()
  const missing = ids.filter((id) => !asked.current.has(id))
  const missingKey = missing.join(',')

  const mounted = useRef(true)
  useEffect(() => () => { mounted.current = false }, [])

  useEffect(() => {
    if (!missingKey) return
    const list = missingKey.split(',')
    list.forEach((id) => asked.current.add(id))
    // Not cancelled when the list changes: these ids won't be asked for again, so their
    // answer must still land. Only an unmount drops it.
    for (let i = 0; i < list.length; i += CHUNK) {
      const chunk = list.slice(i, i + CHUNK)
      apiJson(`/api/follows/status?ids=${chunk.join(',')}`)
        .then((d) => { if (mounted.current) setStatuses((prev) => ({ ...(d?.statuses ?? {}), ...prev })) })
        .catch(() => {
          // Ask again next time these ids show up.
          chunk.forEach((id) => asked.current.delete(id))
        })
    }
  }, [missingKey])

  const setStatus = useCallback((id, status) => setStatuses((prev) => ({ ...prev, [id]: status })), [])
  return { statuses, setStatus }
}
