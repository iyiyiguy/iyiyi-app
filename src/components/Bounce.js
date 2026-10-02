import { useRef } from 'react'
import { Animated, Pressable } from 'react-native'

// A small tactile press-scale wrapper for icon-sized buttons (tab icons, the raised
// camera/map button, circular avatars) - squeezes down on press, springs back on release.
export default function Bounce({ onPress, style, children, scaleTo = 0.88, ...rest }) {
  const scale = useRef(new Animated.Value(1)).current
  const to = (v) => Animated.spring(scale, { toValue: v, useNativeDriver: true, speed: 30, bounciness: 9 }).start()

  return (
    <Pressable
      onPress={onPress}
      onPressIn={() => to(scaleTo)}
      onPressOut={() => to(1)}
      {...rest}
    >
      <Animated.View style={[style, { transform: [{ scale }] }]}>{children}</Animated.View>
    </Pressable>
  )
}
