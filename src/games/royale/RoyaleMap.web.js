// Web build: react-native-maps has no web implementation. Show a simple placeholder.
import React, { memo } from 'react'
import { StyleSheet, Text, View } from 'react-native'

export function splitPlayers(players) {
  return { dots: players || [], clusters: [] }
}

export const RoyaleMap = memo(function RoyaleMap({ style, zone }) {
  return (
    <View style={[style, s.box]}>
      <Text style={s.text}>Map available in the iOS app{zone?.current ? ` · zone ${Math.round(zone.current.r)} m` : ''}</Text>
    </View>
  )
})

const s = StyleSheet.create({
  box: { alignItems: 'center', justifyContent: 'center', backgroundColor: '#101318' },
  text: { fontSize: 11, letterSpacing: 1.2, color: 'rgba(242,244,247,0.62)', textAlign: 'center', padding: 8, textTransform: 'uppercase' },
})

export default RoyaleMap
