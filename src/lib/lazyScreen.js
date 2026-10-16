import { Suspense, lazy } from 'react'
import { View, Platform } from 'react-native'

// Defers loading a screen's module (and everything it imports - three.js for the arcade, the
// chess engine, video calling...) until the screen is first opened, so app launch and the
// first screens don't pay for code they aren't using yet.
//
// Web: after a new deploy, a tab that was opened before it still runs the old bundle, and
// opening a screen it hasn't loaded yet asks for a chunk that no longer exists ("Requiring
// unknown module", "Loading chunk failed"). Reload once to pick up the new build instead of
// showing an error; a second failure within a minute is thrown normally.
const STALE = /Requiring unknown module|Loading chunk|ChunkLoadError|Failed to fetch dynamically imported module|Importing a module script failed|Unexpected token '<'/i
const RELOAD_KEY = 'iyiyi_stale_chunk_reload_at'

function withStaleReload(loader) {
  if (Platform.OS !== 'web') return loader
  return () => loader().catch((e) => {
    if (typeof window !== 'undefined' && STALE.test(String(e?.message || e))) {
      let last = 0
      try { last = Number(window.sessionStorage.getItem(RELOAD_KEY) || 0) } catch {}
      if (Date.now() - last > 60000) {
        try { window.sessionStorage.setItem(RELOAD_KEY, String(Date.now())) } catch {}
        window.location.reload()
        return new Promise(() => {}) // keep the blank fallback up until the reload happens
      }
    }
    throw e
  })
}

export function lazyScreen(loader) {
  const Screen = lazy(withStaleReload(loader))
  function LazyScreen(props) {
    return (
      <Suspense fallback={<View style={{ flex: 1 }} />}>
        <Screen {...props} />
      </Suspense>
    )
  }
  return LazyScreen
}
