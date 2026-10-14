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
import { Alert, BackHandler, Pressable, ScrollView, StyleSheet, Switch, Text, View, useWindowDimensions } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import GlassPanel from '../components/GlassPanel'
import { Btn } from './MultiplayerUI'
import { GameMap } from './GameMap'
import { LASER_MODES, TEAMS, howToPlay } from '../lib/multiplayer'
import { setPref, useGamePrefs } from '../lib/gamePrefs'
import { attackingTeam } from './laser/engine'
import { HUD, HudCta, hudSheet, hudType } from './laser/HudPro'
import { colors, radii, type } from '../theme'
import { FONT, ST } from './studio'

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
      circles.push({ id: `site-${x.id}`, lat: x.lat, lng: x.lng, radius: x.r || 12, color: HUD.gold })
      markers.push({ id: `site-${x.id}`, lat: x.lat, lng: x.lng, label: `SITE ${x.id}`, color: HUD.red })
    }
    if (state?.game === 'lasertag') {
      const myTeam = state.players?.[meId]?.team
      const bomb = state.snd?.bomb
      if (bomb && bomb.lat != null && (bomb.state === 'planted' || (bomb.state === 'dropped' && myTeam === attackingTeam(state)))) {
        markers.push({ id: 'bomb', lat: bomb.lat, lng: bomb.lng, label: bomb.state === 'planted' ? 'BOMB PLANTED' : 'BOMB DROPPED', color: HUD.red })
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
  handed: [['right', 'Right hand'], ['left', 'Left hand']],
}
const AIM_HINTS = {
  auto: 'Switches with how you hold the phone: upright = Trigger, flat or sideways = Top edge.',
  trigger: 'Camera aim. The whole screen is the trigger: tap for one shot, hold for automatic fire.',
  top: 'Point the top edge of the phone at a player and tap anywhere. Compass aim, less precise.',
  camera: 'Crosshair with a FIRE button and the first-person gun.',
}

export function GameMenu({ visible, onClose, gameId, snap, positions, onLeave }) {
  const insets = useSafeAreaInsets()
  const { height: winH } = useWindowDimensions()
  const prefs = useGamePrefs()
  const [view, setView] = useState('main')
  const close = () => { setView('main'); onClose?.() }
  // Shooters get the dark HUD language; board/word games keep the app's glass.
  const shooter = gameId === 'lasertag' || gameId === 'royale'
  const maxH = Math.max(260, winH - insets.top - insets.bottom - 72)
  const pageMaxH = maxH - 70

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
  // Laser Tag has its own tactical map in the HUD (double-tap the minimap), so the menu
  // only offers a map for the other location games.
  const showMap = gameId !== 'chess' && gameId !== 'lasertag'
  const ov = view === 'map' ? overlays(gameId, snap, positions) : null

  if (!visible) return null

  const modeShort = laser ? LASER_MODES[snap?.state?.mode || snap?.info?.settings?.mode]?.short : null
  const S = shooter ? dark : light
  const inner = (
    <>
      <Pressable onPress={close} hitSlop={12} style={[styles.closeBtn, shooter && styles.closeBtnHud]} accessibilityRole="button" accessibilityLabel="Close menu">
        <Ionicons name="close" size={shooter ? 18 : 20} color={shooter ? '#fff' : colors.text} />
      </Pressable>
      {view === 'main' && (
        <View style={styles.pad}>
          {shooter ? (
            <>
              <Text style={hudType.kicker}>MENU</Text>
              <Text style={[hudType.title, { marginTop: 2, marginRight: 44 }]} numberOfLines={1}>{laser ? `LASER TAG${modeShort ? ` · ${modeShort}` : ''}` : 'BATTLE ROYALE'}</Text>
              {snap?.code ? <Text style={[hudType.label, { marginTop: 3, marginBottom: 10 }]}>CODE {snap.code}  ·  {snap.roster?.length || 0} PLAYERS</Text> : <View style={{ height: 10 }} />}
            </>
          ) : (
            <Text style={[type.title, { marginBottom: 4, marginRight: 44 }]}>Menu</Text>
          )}
          <S.Row icon="settings-sharp" title="Settings" onPress={() => setView('settings')} />
          {showMap && <S.Row icon="map" title="View map" onPress={() => setView('map')} />}
          <S.Row icon="book" title="How to play" onPress={() => setView('rules')} />
          {shooter
            ? <HudCta tone="ghost" icon="exit-outline" title="Leave match" onPress={confirmLeave} style={{ marginTop: 18, borderColor: ST.enemy }} />
            : <Btn title="Leave game" variant="danger" onPress={confirmLeave} style={{ marginTop: 16 }} />}
        </View>
      )}
      {view === 'settings' && (
        <ScrollView style={{ maxHeight: pageMaxH }} contentContainerStyle={styles.pad}>
          <S.Header title="Settings" onBack={() => setView('main')} />
          <S.Toggle label="Vibration" value={prefs.haptics} onChange={(v) => setPref('haptics', v)} />
          <S.Toggle label="Sound effects" value={prefs.sound} onChange={(v) => setPref('sound', v)} />
          {laser && (
            <>
              <S.Toggle label="Show minimap" value={prefs.minimap} onChange={(v) => setPref('minimap', v)} />
              <S.Toggle label="Target lock brackets" value={prefs.targetLock} onChange={(v) => setPref('targetLock', v)} />
              <Text style={S.caption}>Highlights people the camera can see. Off saves battery; shooting still uses the camera.</Text>
              <S.Segmented label="Aim & fire" value={prefs.aimMode} options={SEGMENTS.aimMode} onChange={(v) => setPref('aimMode', v)} />
              <Text style={[S.caption, { marginTop: 6 }]}>{AIM_HINTS[prefs.aimMode] || AIM_HINTS.auto} Headshots do double damage.</Text>
              <S.Segmented label="HUD layout" value={prefs.handed} options={SEGMENTS.handed} onChange={(v) => setPref('handed', v)} />
            </>
          )}
        </ScrollView>
      )}
      {view === 'map' && (
        <View style={styles.pad}>
          <S.Header title="Map" onBack={() => setView('main')} />
          <GameMap height={Math.min(360, pageMaxH - 120)} center={ov.center} markers={ov.markers} circles={ov.circles} />
          <Text style={[S.caption, { marginTop: 8 }]}>
            {gameId === 'beside-them' ? 'Pink stations are on your task list.' : 'Positions update about once a second.'}
          </Text>
        </View>
      )}
      {view === 'rules' && (
        <ScrollView style={{ maxHeight: pageMaxH }} contentContainerStyle={styles.pad}>
          <S.Header title={h.title} onBack={() => setView('main')} />
          {h.steps.map((r, i) => (
            shooter ? (
              <View key={r} style={styles.ruleRow}>
                <Text style={styles.ruleNum}>{String(i + 1).padStart(2, '0')}</Text>
                <Text style={[hudType.body, { flex: 1 }]}>{r}</Text>
              </View>
            ) : (
              <Text key={r} style={[type.body, { marginBottom: 10 }]}>{i + 1}. {r}</Text>
            )
          ))}
        </ScrollView>
      )}
    </>
  )

  return (
    <View style={[StyleSheet.absoluteFill, styles.root]}>
      <Pressable style={styles.backdrop} onPress={close} accessibilityRole="button" accessibilityLabel="Close menu" />
      <View style={[styles.sheetWrap, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 12 }]} pointerEvents="box-none">
        {shooter
          ? <View style={[styles.sheetHud, { maxHeight: maxH }]}>{inner}</View>
          : <GlassPanel strong radius={radii.lg} style={styles.sheet} animateIn={false}>{inner}</GlassPanel>}
      </View>
    </View>
  )
}

// ---- App-glass variants (board / word games) ----
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
const light = { Row, Header, Toggle, Segmented, caption: type.caption }

// ---- HUD variants (shooters) ----
const HUD_ICONS = { 'settings-sharp': 'options-outline', map: 'map-outline', book: 'book-outline' }
function HudRow({ title, icon, onPress }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={title} style={({ pressed }) => [styles.rowHud, pressed && styles.rowHudOn]}>
      <View style={styles.rowHudIcon}><Ionicons name={HUD_ICONS[icon] || icon} size={16} color={ST.friendly} /></View>
      <Text style={styles.rowHudText}>{title}</Text>
      <Ionicons name="chevron-forward" size={16} color={ST.faint} />
    </Pressable>
  )
}

function HudHeader({ title, onBack }) {
  return (
    <View style={styles.header}>
      <Pressable onPress={onBack} hitSlop={10} accessibilityRole="button" accessibilityLabel="Back" style={styles.backHud}>
        <Ionicons name="chevron-back" size={18} color={ST.friendly} />
        <Text style={[hudType.label, { color: ST.friendly, fontSize: 11 }]}>BACK</Text>
      </Pressable>
      <Text style={[hudType.title, { flex: 1, textAlign: 'center', marginRight: 72 }]} numberOfLines={1}>{title}</Text>
    </View>
  )
}

function HudToggle({ label, value, onChange }) {
  return (
    <View style={styles.rowHudPlain}>
      <Text style={styles.toggleHudText}>{label}</Text>
      <Switch value={value} onValueChange={onChange} trackColor={{ false: 'rgba(255,255,255,0.14)', true: ST.friendly }} thumbColor="#fff" ios_backgroundColor="rgba(255,255,255,0.14)" accessibilityLabel={label} />
    </View>
  )
}

function HudSegmented({ label, value, options, onChange }) {
  return (
    <View style={{ marginTop: 16 }}>
      <Text style={[hudType.label, { marginBottom: 8 }]}>{label}</Text>
      <View style={styles.segHud}>
        {options.map(([v, l]) => {
          const on = value === v
          return (
            <Pressable key={v} onPress={() => onChange(v)} style={[styles.segItem, styles.segItemHud, on && { backgroundColor: ST.friendly }]} accessibilityRole="button" accessibilityState={{ selected: on }}>
              <Text style={[styles.segHudText, on && { color: ST.ink }]} numberOfLines={1}>{l}</Text>
            </Pressable>
          )
        })}
      </View>
    </View>
  )
}
const dark = { Row: HudRow, Header: HudHeader, Toggle: HudToggle, Segmented: HudSegmented, caption: { fontFamily: FONT.uiSemi, fontSize: 12.5, lineHeight: 17, color: ST.muted, marginTop: 6 } }

const styles = StyleSheet.create({
  root: { zIndex: 100, elevation: 100 },
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.45)' },
  closeBtn: { position: 'absolute', top: 12, right: 12, zIndex: 2, width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.glassFillStrong, borderWidth: 1, borderColor: colors.hairline },
  sheetWrap: { flex: 1, justifyContent: 'flex-end', paddingHorizontal: 10 },
  sheet: { maxHeight: '88%' },
  sheetHud: { ...hudSheet, backgroundColor: 'rgba(11,13,17,0.97)', borderTopWidth: 2, borderTopColor: ST.friendly },
  closeBtnHud: { width: 40, height: 40, borderRadius: ST.radius, backgroundColor: 'transparent', borderColor: 'rgba(255,255,255,0.18)' },
  pad: { padding: 18 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.hairline },
  rowHud: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 52, paddingHorizontal: 10, borderLeftWidth: 3, borderLeftColor: 'transparent', borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.07)' },
  rowHudOn: { backgroundColor: 'rgba(57,213,255,0.10)', borderLeftColor: ST.friendly },
  rowHudIcon: { width: 32, height: 32, borderRadius: ST.radius, borderWidth: 1, borderColor: 'rgba(255,255,255,0.16)', alignItems: 'center', justifyContent: 'center' },
  rowHudText: { flex: 1, fontFamily: FONT.display, fontSize: 14, letterSpacing: 1.6, color: '#fff', textTransform: 'uppercase' },
  rowHudPlain: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', minHeight: 50, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.07)' },
  toggleHudText: { fontFamily: FONT.ui, fontSize: 15, color: '#fff' },
  backHud: { flexDirection: 'row', alignItems: 'center', gap: 2, width: 72 },
  header: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  seg: { flexDirection: 'row', borderRadius: radii.sm, borderWidth: 1, borderColor: colors.hairline, overflow: 'hidden' },
  segHud: { flexDirection: 'row', borderRadius: ST.radius, borderWidth: 1, borderColor: 'rgba(255,255,255,0.16)', overflow: 'hidden', backgroundColor: 'rgba(255,255,255,0.04)' },
  segHudText: { fontFamily: FONT.ui, fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', color: '#fff' },
  segItemHud: { minHeight: 40, justifyContent: 'center', paddingHorizontal: 4 },
  segItem: { flex: 1, paddingVertical: 10, alignItems: 'center' },
  ruleRow: { flexDirection: 'row', gap: 12, marginBottom: 12 },
  ruleNum: { fontFamily: FONT.display, fontSize: 13, color: ST.friendly, width: 26, paddingTop: 1 },
})
