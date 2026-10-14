import { useMemo } from 'react'
import { View, Text } from 'react-native'
import Svg, { Path, Rect } from 'react-native-svg'
import { encodeQR, qrPath } from '../../lib/qr'

// A real, scannable QR code drawn on the device (src/lib/qr.js + react-native-svg).
// Always black on white with a 4-module quiet zone, which every scanner reads reliably.
export default function QRCode({ value, size = 220, accessibilityLabel }) {
  const qr = useMemo(() => {
    try { return encodeQR(value) } catch { return null }
  }, [value])
  if (!qr) {
    return (
      <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff' }}>
        <Text style={{ color: '#111', textAlign: 'center', padding: 12 }}>This link is too long for a QR code.</Text>
      </View>
    )
  }
  const quiet = 4
  const dim = qr.size + quiet * 2
  return (
    <Svg width={size} height={size} viewBox={`0 0 ${dim} ${dim}`} accessibilityLabel={accessibilityLabel} shapeRendering="crispEdges">
      <Rect x={0} y={0} width={dim} height={dim} fill="#ffffff" />
      <Path d={qrPath(qr, quiet)} fill="#000000" />
    </Svg>
  )
}

export const profileQrUrl = (username) => `https://app.iyiyi.xyz/u/${encodeURIComponent(username)}?src=qr`
