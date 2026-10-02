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
