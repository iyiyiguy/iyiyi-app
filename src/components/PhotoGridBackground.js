import { useEffect, useRef } from 'react'
import { View, Image, Animated, StyleSheet, Dimensions } from 'react-native'

// A 3-column wall of photos that scrolls continuously behind the sign-in
// screen — the outer two columns drift down, the middle drifts up, so it
// reads as a living "people are here" wall even before there are enough
// real member photos to fill it. Swap in real profile photos over time;
// for now it's seeded with stock marketing photos.
const PHOTOS = [
  require('../../assets/showcase/streetwear-01.jpg'),
  require('../../assets/showcase/streetwear-02.jpg'),
  require('../../assets/showcase/streetwear-03.jpg'),
  require('../../assets/showcase/streetwear-04.jpg'),
  require('../../assets/showcase/streetwear-05.jpg'),
  require('../../assets/showcase/streetwear-06.jpg'),
  require('../../assets/showcase/streetwear-07.jpg'),
  require('../../assets/showcase/streetwear-08.jpg'),
  require('../../assets/showcase/streetwear-09.jpg'),
  require('../../assets/showcase/streetwear-10.jpg'),
  require('../../assets/showcase/streetwear-11.jpg'),
  require('../../assets/showcase/streetwear-12.jpg'),
  require('../../assets/showcase/streetwear-13.jpg'),
  require('../../assets/showcase/streetwear-14.jpg'),
  require('../../assets/showcase/streetwear-15.jpg'),
]

const TILE_H = 260
const GAP = 0
const COLUMNS = [
  { photos: [PHOTOS[0], PHOTOS[3], PHOTOS[6], PHOTOS[9], PHOTOS[12]], direction: -1, duration: 26000 },
  { photos: [PHOTOS[1], PHOTOS[4], PHOTOS[7], PHOTOS[10], PHOTOS[13]], direction: 1, duration: 32000 },
  { photos: [PHOTOS[2], PHOTOS[5], PHOTOS[8], PHOTOS[11], PHOTOS[14]], direction: -1, duration: 29000 },
]

function Column({ photos, direction, duration }) {
  const anim = useRef(new Animated.Value(0)).current
  const setH = photos.length * (TILE_H + GAP)

  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(anim, { toValue: 1, duration, useNativeDriver: true })
    )
    loop.start()
    return () => loop.stop()
  }, [anim, duration])

  const translateY = anim.interpolate({
    inputRange: [0, 1],
    outputRange: direction > 0 ? [-setH, 0] : [0, -setH],
  })

  const doubled = [...photos, ...photos]

  return (
    <View style={styles.column}>
      <Animated.View style={{ transform: [{ translateY }] }}>
        {doubled.map((src, i) => (
          <Image key={i} source={src} style={styles.tile} />
        ))}
      </Animated.View>
    </View>
  )
}

export default function PhotoGridBackground() {
  return (
    <View style={styles.wrap} pointerEvents="none">
      {COLUMNS.map((c, i) => (
        <Column key={i} photos={c.photos} direction={c.direction} duration={c.duration} />
      ))}
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { ...StyleSheet.absoluteFillObject, flexDirection: 'row', overflow: 'hidden' },
  column: { flex: 1, overflow: 'hidden' },
  tile: { width: '100%', height: TILE_H },
})
