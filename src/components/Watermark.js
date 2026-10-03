import { View, Image, StyleSheet } from 'react-native'

const LOGO = require('./camera/filters/iy-logo.png')
const MARGIN = 14
const LOGO_W = 58
const LOGO_H = 48
// For burning the same badge into videos: the logo asset, and [right margin, bottom margin, w, h].
export const WATERMARK_LOGO = LOGO
export const WATERMARK_RECT = [MARGIN, MARGIN, LOGO_W, LOGO_H]

// The iY logo stamped in the corner of every iYiYi camera photo (camera roll and posts).
// No username or banner, just the brand mark. Rendered as a normal view so
// react-native-view-shot can bake it into the saved image.
export default function Watermark() {
  return (
    <View pointerEvents="none" style={styles.wrap}>
      <View style={styles.badge}>
        <Image source={LOGO} style={styles.logo} resizeMode="contain" fadeDuration={0} />
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { ...StyleSheet.absoluteFillObject, justifyContent: 'flex-end', alignItems: 'flex-end' },
  badge: {
    margin: MARGIN,
    shadowColor: '#000', shadowOpacity: 0.45, shadowRadius: 6, shadowOffset: { width: 0, height: 2 },
  },
  logo: { width: LOGO_W, height: LOGO_H },
})
