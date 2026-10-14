// Tiny in-app event bus for freshly posted media, so the feed, profile and stream can show a
// new camera post immediately instead of waiting for their next refetch.
//   const off = onMediaPosted((row) => ...)   // returns an unsubscribe function
//   emitMediaPosted(row)                       // row = the inserted profile_media row
const listeners = new Set()

export function onMediaPosted(fn) {
  if (typeof fn !== 'function') return () => {}
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}

export function emitMediaPosted(row) {
  if (!row) return
  for (const fn of Array.from(listeners)) {
    try { fn(row) } catch (e) { console.warn('onMediaPosted listener failed', e) }
  }
}

// Deleted posts: every screen holding a list of media drops the item as soon as it's gone.
//   const off = onMediaRemoved((id) => ...)   // id of the deleted profile_media row
//   emitMediaRemoved(id)
const removedListeners = new Set()

export function onMediaRemoved(fn) {
  if (typeof fn !== 'function') return () => {}
  removedListeners.add(fn)
  return () => { removedListeners.delete(fn) }
}

export function emitMediaRemoved(id) {
  if (id == null) return
  for (const fn of Array.from(removedListeners)) {
    try { fn(id) } catch (e) { console.warn('onMediaRemoved listener failed', e) }
  }
}

// Same-id check across number/string ids (feed rows can carry either).
export const sameMediaId = (a, b) => a != null && b != null && String(a) === String(b)
