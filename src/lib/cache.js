import { useCallback, useState } from 'react'

// Tiny in-memory cache so screens show their last data the instant they open, then refresh
// in the background (stale-while-revalidate). Lives for the app session; nothing is persisted.
const store = new Map()

export const getCached = (key) => store.get(key)
export const setCached = (key, value) => { store.set(key, value); return value }
export const clearCached = (prefix) => { for (const k of [...store.keys()]) if (!prefix || k.startsWith(prefix)) store.delete(k) }

// useState that starts from (and writes through to) the cache under `key`.
export function useCachedState(key, initial) {
  const [value, setValue] = useState(() => (store.has(key) ? store.get(key) : initial))
  const set = useCallback((next) => {
    setValue((prev) => {
      const v = typeof next === 'function' ? next(prev) : next
      store.set(key, v)
      return v
    })
  }, [key])
  return [value, set, store.has(key)]
}
