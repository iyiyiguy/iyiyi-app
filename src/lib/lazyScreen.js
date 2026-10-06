import { Suspense, lazy } from 'react'
import { View } from 'react-native'

// Defers loading a screen's module (and everything it imports - three.js for the arcade, the
// chess engine, video calling...) until the screen is first opened, so app launch and the
// first screens don't pay for code they aren't using yet.
export function lazyScreen(loader) {
  const Screen = lazy(loader)
  function LazyScreen(props) {
    return (
      <Suspense fallback={<View style={{ flex: 1 }} />}>
        <Screen {...props} />
      </Suspense>
    )
  }
  return LazyScreen
}
