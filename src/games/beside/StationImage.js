import React, { useEffect } from 'react'
import { Image, StyleSheet, Text, View } from 'react-native'
import { colors, radii } from '../../theme'

// A station's reference photo: the uploaded image if there is one, else the
// thumbnail shared over the room (requested from the host if we lack it).
export function StationImage({ room, station, assets, style, resizeMode = 'cover' }) {
  const thumb = assets?.[station.id]
  const uri = station.url || thumb
  useEffect(() => {
    if (!station.url && !thumb && room) room.requestAsset(station.id)
  }, [room, station.id, station.url, thumb])
  if (!uri) {
    return (
      <View style={[styles.empty, style]}>
        <Text style={{ fontSize: 20 }}>📷</Text>
      </View>
    )
  }
  return <Image source={{ uri }} style={[styles.img, style]} resizeMode={resizeMode} />
}

const styles = StyleSheet.create({
  img: { borderRadius: radii.sm, backgroundColor: colors.inkSurfaceRaised },
  empty: { borderRadius: radii.sm, backgroundColor: colors.inkSurfaceRaised, alignItems: 'center', justifyContent: 'center' },
})
