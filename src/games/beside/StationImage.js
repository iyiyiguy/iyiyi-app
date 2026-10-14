import React, { useEffect } from 'react'
import { Image, StyleSheet, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { ST } from '../studio'

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
        <Ionicons name="camera-outline" size={18} color={ST.faint} />
      </View>
    )
  }
  return <Image source={{ uri }} style={[styles.img, style]} resizeMode={resizeMode} />
}

const styles = StyleSheet.create({
  img: { borderRadius: ST.radius, backgroundColor: '#2a3038' },
  empty: { borderRadius: ST.radius, backgroundColor: '#2a3038', alignItems: 'center', justifyContent: 'center' },
})
