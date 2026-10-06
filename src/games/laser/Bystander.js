// Overhead emblem for opted-in iYiYi users who are NOT in the match (bystanders), plus the
// one-time opt-in prompt and the Settings row. Enemies keep the red crosshair marker.
import React, { memo, useEffect, useState } from 'react'
import { Alert, StyleSheet, Text, View } from 'react-native'
import { getTaggable, markTaggablePrompted, setTaggable, shouldPromptTaggable } from '../../lib/bystanderTags'

const TEAL = '#1fc8c8'
const W = 240 // max marker width (centred on x)

/** markers: [{ id, x, y, username }] in screen px (x = head centre, y = head top). */
export const BystanderMarkers = memo(function BystanderMarkers({ markers }) {
  if (!markers?.length) return null
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {markers.map((m) => (
        <View key={m.id} style={[s.wrap, { left: m.x - W / 2, top: m.y - 52 }]}>
          <View style={s.pill}>
            <View style={s.badge}><Text style={s.badgeText} allowFontScaling={false}>iY</Text></View>
            <View style={{ flexShrink: 1 }}>
              <Text style={s.kicker} numberOfLines={1}>iYiYi user</Text>
              <Text style={s.name} numberOfLines={1}>@{m.username}</Text>
            </View>
          </View>
          <View style={s.stem} />
        </View>
      ))}
    </View>
  )
})

/** Once per account: ask whether other players may tag me when I'm not in a game. */
export function useTaggablePrompt(active) {
  useEffect(() => {
    if (!active) return undefined
    let alive = true
    const t = setTimeout(async () => {
      try {
        if (!alive || !(await shouldPromptTaggable()) || !alive) return
        Alert.alert(
          'Laser Tag',
          'Let other players tag you when you’re not in a game? You’ll get an alert to join and fight back.',
          [
            { text: 'Keep off', style: 'cancel', onPress: () => { markTaggablePrompted() } },
            { text: 'Turn on', onPress: () => { setTaggable(true).then((ok) => { if (!ok) markTaggablePrompted() }) } },
          ],
          { cancelable: true, onDismiss: () => { markTaggablePrompted() } },
        )
      } catch {
        // Never block the match.
      }
    }, 1200)
    return () => { alive = false; clearTimeout(t) }
  }, [active])
}

/** Settings row (SettingsScreen passes its own SwitchRow for consistent styling). */
export function LaserTaggableSetting({ SwitchRow }) {
  const [on, setOn] = useState(false)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    let alive = true
    getTaggable().then((r) => { if (alive) setOn(!!r.enabled) }).catch(() => {})
    return () => { alive = false }
  }, [])
  const change = async (v) => {
    setOn(v)
    setBusy(true)
    const ok = await setTaggable(v)
    setBusy(false)
    if (!ok) {
      setOn(!v)
      Alert.alert("Couldn't save", 'Check your connection and try again.')
    }
  }
  if (!SwitchRow) return null
  return (
    <SwitchRow
      label="Let Laser Tag players tag me"
      description="When you’re not in a game, Laser Tag players nearby can tag you on camera. You’ll get an alert to join and fight back."
      value={on}
      disabled={busy}
      onChange={change}
    />
  )
}

const s = StyleSheet.create({
  wrap: { position: 'absolute', width: W, alignItems: 'center' },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 6, maxWidth: W, paddingLeft: 4, paddingRight: 10, paddingVertical: 4, borderRadius: 999, backgroundColor: 'rgba(8,40,52,0.82)', borderWidth: 1.5, borderColor: TEAL },
  badge: { width: 24, height: 24, borderRadius: 12, backgroundColor: TEAL, alignItems: 'center', justifyContent: 'center' },
  badgeText: { fontSize: 11, fontWeight: '900', color: '#062a33', letterSpacing: -0.3 },
  kicker: { fontSize: 9, fontWeight: '800', color: TEAL, letterSpacing: 0.6, textTransform: 'uppercase' },
  name: { fontSize: 12, fontWeight: '800', color: '#fff' },
  stem: { width: 2, height: 8, backgroundColor: TEAL },
})
