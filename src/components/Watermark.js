import { View, Text, StyleSheet } from 'react-native'
import { LinearGradient } from 'expo-linear-gradient'

// Y2K sticker-style mark stamped on camera photos: chrome-pink to cyan gradient bar with
// the iY logotype, the shooter's @handle and the app name. Rendered as a normal view so
// react-native-view-shot can bake it into the saved image.
export default function Watermark({ username }) {
  return (
    <View pointerEvents="none" style={styles.wrap}>
      <Text style={[styles.star, { top: 14, left: 14 }]}>✦</Text>
      <Text style={[styles.star, { top: 40, right: 18, fontSize: 18 }]}>✧</Text>
      <LinearGradient
        colors={['#ff2bd6', '#7a3cff', '#19e3ff']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.bar}
      >
        <View style={styles.logoBox}>
          <Text style={styles.logo}>iY</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.handle} numberOfLines={1}>@{username || 'iyiyi'}</Text>
          <Text style={styles.tagline}>found on iYiYi ✦ get the app</Text>
        </View>
      </LinearGradient>
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { ...StyleSheet.absoluteFillObject, justifyContent: 'flex-end' },
  star: { position: 'absolute', color: '#ffffff', fontSize: 26, textShadowColor: '#ff2bd6', textShadowRadius: 8 },
  bar: {
    flexDirection: 'row', alignItems: 'center', gap: 10, margin: 12, paddingVertical: 8, paddingHorizontal: 10,
    borderRadius: 14, borderWidth: 2, borderColor: '#ffffff',
  },
  logoBox: { backgroundColor: '#ffffff', borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2 },
  logo: { fontSize: 22, fontWeight: '900', color: '#ff2bd6', fontStyle: 'italic', letterSpacing: -1 },
  handle: { color: '#ffffff', fontWeight: '900', fontSize: 15, textShadowColor: 'rgba(0,0,0,0.35)', textShadowRadius: 3 },
  tagline: { color: '#ffffff', fontWeight: '700', fontSize: 10, opacity: 0.95, letterSpacing: 0.4 },
})
