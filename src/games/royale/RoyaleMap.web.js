// Web build: react-native-maps has no web implementation. Show a simple placeholder.
import React, { memo } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { useT } from '../../i18n'
import AM from '../../i18n/strings/arcadeMisc'

export function splitPlayers(players) {
  return { dots: players || [], clusters: [] }
}

export const RoyaleMap = memo(function RoyaleMap({ style, zone }) {
  const t = useT(AM)
  return (
    <View style={[style, s.box]}>
      <Text style={s.text}>{t('map_ios_app')}{zone?.current ? ` · ${t('zone_m', { n: Math.round(zone.current.r) })}` : ''}</Text>
    </View>
  )
})

const s = StyleSheet.create({
  box: { alignItems: 'center', justifyContent: 'center', backgroundColor: '#101318' },
  text: { fontSize: 11, letterSpacing: 1.2, color: 'rgba(242,244,247,0.62)', textAlign: 'center', padding: 8, textTransform: 'uppercase' },
})

export default RoyaleMap
