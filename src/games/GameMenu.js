// In-game menu sheet: Settings, View map, How to play, Leave. Close with the X or by
// tapping outside the sheet.
//
// Why this is an in-tree overlay and not a native <Modal>: on iOS the menu could get
// stuck on screen. A native modal is a separate presented view controller — if its
// dismissal overlaps another presentation (the "Leave game?" alert, the camera, a
// screen pop) iOS silently ignores the dismiss, leaving `visible=false` in JS but the
// sheet still showing and swallowing every touch, so nothing could close it. A plain
// absolutely-positioned View can't get out of sync like that, and it also lets a held
// FIRE/trigger press end normally.
import React, { useEffect, useState } from 'react'
import { Ionicons } from '@expo/vector-icons'
import { Alert, BackHandler, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import GlassPanel from '../components/GlassPanel'
import { Btn } from './MultiplayerUI'
import { GameMap } from './GameMap'
import { TEAMS, howToPlay } from '../lib/multiplayer'
import { setPref, useGamePrefs } from '../lib/gamePrefs'
import { attackingTeam } from './laser/engine'
import { colors, radii, type } from '../theme'

// What each game shows on the full map. Mirrors the in-game visibility rules
// (e.g. Search & Destroy hides enemies, Beside Them hides everyone).
function overlays(gameId, snap, positions) {
  const markers = []
  const circles = []
  const meId = snap?.me?.id
  const state = snap?.state
  const settings = snap?.info?.settings || {}
  const fresh = (id) => {
    const p = positions?.[id]
    return p && Date.now() - p.at < 15000 ? p : null
  }
  if (gameId === 'lasertag') {
    const sites = state?.snd?.sites || (settings.mode === 'snd' ? settings.sites || [] : [])
    for (const x of sites) {
      circles.push({ id: `site-${x.id}`, lat: x.lat, lng: x.lng, radius: x.r || 12, color: colors.gold })
      markers.push({ id: `site-${x.id}`, lat: x.lat, lng: x.lng, label: `Site ${x.id}`, color: colors.crimson })
    }
    if (state?.game === 'lasertag') {
      const myTeam = state.players?.[meId]?.team
      const bomb = state.snd?.bomb
      if (bomb && bomb.lat != null && (bomb.state === 'planted' || (bomb.state === 'dropped' && myTeam === attackingTeam(state)))) {
        markers.push({ id: 'bomb', lat: bomb.lat, lng: bomb.lng, label: bomb.state === 'planted' ? '💣 Planted' : '💣 Dropped', color: colors.danger })
      }
      for (const id of Object.keys(state.players || {})) {
        if (id === meId) continue
        const pl = state.players[id]
        const mate = state.mode !== 'ffa' && pl.team === myTeam
        if (state.mode === 'snd' && !mate) continue
        const p = fresh(id)
        if (p) markers.push({ id, lat: p.lat, lng: p.lng, label: pl.name, color: mate ? TEAMS[pl.team]?.color || colors.success : colors.danger })
      }
    }
  } else if (gameId === 'spider-spider' && state?.game === 'spider') {
    for (const id of Object.keys(state.players || {})) {
      if (id === meId) continue
      const p = fresh(id)
      if (p) markers.push({ id, lat: p.lat, lng: p.lng, label: `${state.players[id].spider ? '🕷️ ' : ''}${state.players[id].name}`, color: state.players[id].spider ? colors.crimson : colors.success })
    }
  } else if (gameId === 'beside-them') {
    const area = settings.area
    if (area) circles.push({ id: 'area', lat: area.lat, lng: area.lng, radius: area.r, color: colors.violet })
    const mine = new Set((state?.tasks?.[meId] || []).map((t) => t.stationId))
    for (const st of settings.stations || []) {
      markers.push({ id: st.id, lat: st.lat, lng: st.lng, label: st.name, color: mine.has(st.id) ? colors.magenta : colors.violet })
    }
  }
  const center = circles[0] || markers[0] || null
  return { markers, circles, center }
}

const SEGMENTS = {
  aimMode: [['auto', 'Auto'], ['trigger', 'Trigger'], ['top', 'Top edge'], ['camera', 'Camera']],
  handed: [['right', 'Right-handed'], ['left', 'Left-handed']],
}

export function GameMenu({ visible, onClose, gameId, snap, positions, onLeave }) {
  const insets = useSafeAreaInsets()
  const prefs = useGamePrefs()
  const [view, setView] = useState('main')
  const close = () => { setView('main'); onClose?.() }

  // Always reopen on the main page.
  useEffect(() => { if (!visible) setView('main') }, [visible])
  // Android back button closes the menu (or goes back a page).
  useEffect(() => {
    if (!visible) return undefined
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (view !== 'main') setView('main')
      else close()
      return true
    })
    return () => sub.remove()
  }, [visible, view]) // eslint-disable-line react-hooks/exhaustive-deps

  const confirmLeave = () => {
    Alert.alert(
      'Leave game?',
      snap?.isHost && (snap?.roster?.length || 0) > 1 ? 'You’re the host — another player will take over and the game carries on.' : 'You’ll leave this match.',
      [
        { text: 'Stay', style: 'cancel' },
        { text: 'Leave', style: 'destructive', onPress: () => { setView('main'); onLeave?.() } },
      ],
    )
  }

  const laser = gameId === 'lasertag'
  const h = howToPlay(gameId, snap?.info?.settings)
  const ov = view === 'map' ? overlays(gameId, snap, positions) : null

  if (!visible) return null

  return (
    <View style={[StyleSheet.absoluteFill, styles.root]}>
      <Pressable style={styles.backdrop} onPress={close} accessibilityRole="button" accessibilityLabel="Close menu" />
      <View style={[styles.sheetWrap, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 12 }]} pointerEvents="box-none">
        <GlassPanel strong radius={radii.lg} style={styles.sheet} animateIn={false}>
          <Pressable onPress={close} hitSlop={12} style={styles.closeBtn} accessibilityRole="button" accessibilityLabel="Close menu">
            <Ionicons name="close" size={20} color={colors.text} />
          </Pressable>
          {view === 'main' && (
            <View style={styles.pad}>
              <Text style={[type.title, { marginBottom: 4, marginRight: 44 }]}>Menu</Text>
              <Row title="Settings" onPress={() => setView('settings')} />
              {gameId !== 'chess' && <Row title="View map" onPress={() => setView('map')} />}
              <Row title="How to play" onPress={() => setView('rules')} />
              <Btn title="Leave game" variant="danger" onPress={confirmLeave} style={{ marginTop: 16 }} />
            </View>
          )}
          {view === 'settings' && (
            <ScrollView contentContainerStyle={styles.pad}>
              <Header title="Settings" onBack={() => setView('main')} />
              <Toggle label="Vibration" value={prefs.haptics} onChange={(v) => setPref('haptics', v)} />
              <Toggle label="Sound effects" value={prefs.sound} onChange={(v) => setPref('sound', v)} />
              {laser && <Text style={type.caption}>Gunshots, hits, bomb alerts and rumble when you fire or get hit.</Text>}
              {laser && (
                <>
                  <Toggle label="Show minimap" value={prefs.minimap} onChange={(v) => setPref('minimap', v)} />
                  <Toggle label="Target lock brackets" value={prefs.targetLock} onChange={(v) => setPref('targetLock', v)} />
                  <Text style={type.caption}>Highlights people the camera can see. Turn off to save battery — shooting still uses the camera.</Text>
                  <Segmented label="Aim & fire" value={prefs.aimMode} options={SEGMENTS.aimMode} onChange={(v) => setPref('aimMode', v)} />
                  <Text style={[type.caption, { marginTop: 6 }]}>
                    Auto switches as you rotate the phone. Portrait (upright) = Trigger: camera aim, the whole screen fires — tap for one shot, hold for continuous fire (head shots do double damage). Landscape or flat = Top edge: point the top of the phone at a player and tap anywhere (compass aim, less precise). Camera = crosshair with a FIRE button.
                  </Text>
                  <Segmented label="HUD layout" value={prefs.handed} options={SEGMENTS.handed} onChange={(v) => setPref('handed', v)} />
                </>
              )}
            </ScrollView>
          )}
          {view === 'map' && (
            <View style={styles.pad}>
              <Header title="Map" onBack={() => setView('main')} />
              <GameMap height={360} center={ov.center} markers={ov.markers} circles={ov.circles} />
              <Text style={[type.caption, { marginTop: 8 }]}>
                {gameId === 'beside-them' ? 'Pink stations are on your task list.' : gameId === 'lasertag' && snap?.state?.mode === 'snd' ? 'Only your teammates are shown.' : 'Positions update about once a second.'}
              </Text>
            </View>
          )}
          {view === 'rules' && (
            <ScrollView contentContainerStyle={styles.pad}>
              <Header title={h.title} onBack={() => setView('main')} />
              {h.steps.map((r, i) => (
                <Text key={r} style={[type.body, { marginBottom: 10 }]}>{i + 1}. {r}</Text>
              ))}
            </ScrollView>
          )}
        </GlassPanel>
      </View>
    </View>
  )
}

function Row({ title, onPress }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.row, { opacity: pressed ? 0.6 : 1 }]} accessibilityRole="button">
      <Text style={type.body}>{title}</Text>
      <Text style={[type.body, { color: colors.textFaint }]}>›</Text>
    </Pressable>
  )
}

function Header({ title, onBack }) {
  return (
    <View style={styles.header}>
      <Pressable onPress={onBack} hitSlop={10} accessibilityRole="button" accessibilityLabel="Back">
        <Text style={[type.body, { color: colors.magenta }]}>‹ Back</Text>
      </Pressable>
      <Text style={[type.title, { flex: 1, textAlign: 'center', marginRight: 64 }]} numberOfLines={1}>{title}</Text>
    </View>
  )
}

function Toggle({ label, value, onChange }) {
  return (
    <View style={styles.row}>
      <Text style={type.body}>{label}</Text>
      <Switch value={value} onValueChange={onChange} trackColor={{ true: colors.magenta }} />
    </View>
  )
}

function Segmented({ label, value, options, onChange }) {
  return (
    <View style={{ marginTop: 14 }}>
      <Text style={[type.label, { marginBottom: 8 }]}>{label}</Text>
      <View style={styles.seg}>
        {options.map(([v, l]) => (
          <Pressable
            key={v}
            onPress={() => onChange(v)}
            style={[styles.segItem, value === v && { backgroundColor: colors.magenta }]}
            accessibilityRole="button"
            accessibilityState={{ selected: value === v }}
          >
            <Text style={[type.caption, { color: value === v ? colors.onBrand : colors.text }]}>{l}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  root: { zIndex: 100, elevation: 100 },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.45)' },
  closeBtn: { position: 'absolute', top: 12, right: 12, zIndex: 2, width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.glassFillStrong, borderWidth: 1, borderColor: colors.hairline },
  sheetWrap: { flex: 1, justifyContent: 'flex-end', paddingHorizontal: 10 },
  sheet: { maxHeight: '88%' },
  pad: { padding: 18 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.hairline },
  header: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  seg: { flexDirection: 'row', borderRadius: radii.sm, borderWidth: 1, borderColor: colors.hairline, overflow: 'hidden' },
  segItem: { flex: 1, paddingVertical: 10, alignItems: 'center' },
})
