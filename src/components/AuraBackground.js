import { memo } from 'react'
import { Image, StyleSheet, View, useColorScheme } from 'react-native'

const LIGHT = require('../../assets/aura-light.jpg')
const DARK = require('../../assets/aura-dark.jpg')

// The silky silver-blue backdrop every screen's glass sits on (with a prism light leak).
// Glass needs something with depth and color behind it to read as glass.
function AuraBackground({ style }) {
  const scheme = useColorScheme()
  return (
    <View style={[StyleSheet.absoluteFill, style]} pointerEvents="none">
      <Image source={scheme === 'dark' ? DARK : LIGHT} style={StyleSheet.absoluteFill} resizeMode="cover" fadeDuration={0} />
    </View>
  )
}

export default memo(AuraBackground)

// Wraps a screen so it renders on the aura. Screens keep a transparent root.
export function withAura(Screen) {
  function AuraScreen(props) {
    return (
      <View style={styles.fill}>
        <AuraBackground />
        <Screen {...props} />
      </View>
    )
  }
  AuraScreen.displayName = `withAura(${Screen.displayName || Screen.name || 'Screen'})`
  return AuraScreen
}

const styles = StyleSheet.create({ fill: { flex: 1 } })
