// Battle Royale HUD pieces: status card, zone pill, banner, feed, weapon slots, pickup,
// countdown, the transit overlay, spectate view, full map and the results screen.
import React, { memo, useMemo, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { LinearGradient } from 'expo-linear-gradient'
import { Ionicons } from '@expo/vector-icons'
import { formatClock } from '../MultiplayerUI'
import { AC, ArcadeBackground, GhostButton, PlayButton, StatTile } from '../arcadeUI'
import { font } from '../../theme'
import { ROYALE_COLORS, TRANSIT_TEXT } from './constants'
import { RoyaleMap } from './RoyaleMap'
import { RoyaleCover } from './RoyaleCover'
import { RARITY_COLORS, getWeapon } from './weaponsAdapter'

export const hudShadow = { textShadowColor: 'rgba(0,0,0,0.85)', textShadowRadius: 4, textShadowOffset: { width: 0, height: 1 } }

export const fmtDuration = (ms) => {
  const t = Math.max(0, Math.floor((Number(ms) || 0) / 1000))
  const h = Math.floor(t / 3600)
  const m = Math.floor((t % 3600) / 60)
  const sec = t % 60
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`
}

// ---- top-left status --------------------------------------------------------------

export const StatusCard = memo(function StatusCard({ hp, alive, total, kills }) {
  const v = Math.max(0, Math.min(100, Math.ceil(Number(hp) || 0)))
  return (
    <View style={s.status} pointerEvents="none">
      <View style={s.hpTrack}>
        <View style={[s.hpFill, { width: `${v}%`, backgroundColor: v > 50 ? '#2fdc8f' : v > 25 ? '#ffc94d' : '#ff5d6c' }]} />
      </View>
      <Text style={s.statusText}>{v} HP</Text>
      <View style={s.statusRow}>
        <Ionicons name="people" size={12} color="#fff" />
        <Text style={s.statusText}> {alive}{total ? `/${total}` : ''} alive  </Text>
        <Ionicons name="skull" size={12} color="#fff" />
        <Text style={s.statusText}> {kills}</Text>
      </View>
    </View>
  )
})

// ---- zone pill --------------------------------------------------------------------

export const ZonePill = memo(function ZonePill({ zone, gasText }) {
  if (!zone) return null
  const shrinking = zone.stage === 'shrink'
  let label
  if (zone.stage === 'final' || (!zone.next && !shrinking)) label = 'Final zone'
  else if (zone.stage === 'wait') label = `${zone.isFinal ? 'Final collapse' : 'Gas closing'} in ${formatClock(zone.msToShrink)}`
  else label = `${zone.isFinal ? 'Zone collapsing' : 'Gas moving'} · ${formatClock(zone.msToEnd)}`
  return (
    <View style={s.zoneWrap} pointerEvents="none">
      <View style={[s.zonePill, shrinking && { backgroundColor: 'rgba(161,77,255,0.8)' }]}>
        <Ionicons name={shrinking ? 'warning' : 'timer-outline'} size={14} color="#fff" />
        <Text style={s.zoneText}>{label}</Text>
        <Text style={s.zonePhase}>{Math.min(zone.phase, zone.phases)}/{zone.phases}</Text>
      </View>
      {!!gasText && (
        <View style={s.gasPill}>
          <Text style={s.gasText}>{gasText}</Text>
        </View>
      )}
    </View>
  )
})

// ---- banner (callouts) ------------------------------------------------------------

export const Banner = memo(function Banner({ banner, top }) {
  if (!banner) return null
  return (
    <View style={[s.banner, { top, backgroundColor: banner.color }]} pointerEvents="none" accessibilityLiveRegion="polite">
      <Text style={s.bannerTitle}>{banner.title}</Text>
      {!!banner.sub && <Text style={s.bannerSub}>{banner.sub}</Text>}
    </View>
  )
})

export const Feed = memo(function Feed({ feed, style }) {
  if (!Array.isArray(feed) || !feed.length) return null
  return (
    <View style={[s.feed, style]} pointerEvents="none">
      {feed.slice(0, 3).map((f) => <Text key={f.id} style={s.feedText} numberOfLines={1}>{f.t}</Text>)}
    </View>
  )
})

export const Flash = memo(function Flash({ flash }) {
  if (!flash) return null
  return (
    <View style={s.flashWrap} pointerEvents="none">
      <Text style={[s.flash, { color: flash.good ? '#2fdc8f' : '#fff' }]}>{flash.text}</Text>
    </View>
  )
})

// ---- weapons ----------------------------------------------------------------------

export const WeaponSlots = memo(function WeaponSlots({ ids, current, onSelect, disabled }) {
  return (
    <View style={s.slots}>
      {ids.map((id) => {
        const w = getWeapon(id)
        const on = id === current
        return (
          <Pressable
            key={id}
            onPress={() => onSelect(id)}
            disabled={disabled}
            style={[s.slot, on && { borderColor: RARITY_COLORS[w.rarity] || '#fff', backgroundColor: 'rgba(0,0,0,0.7)' }, disabled && { opacity: 0.5 }]}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            accessibilityLabel={`Equip ${w.name}`}
          >
            <Text style={s.slotIcon}>{w.icon}</Text>
            <Text style={[s.slotName, on && { color: '#fff' }]} numberOfLines={1}>{w.short}</Text>
            {w.automatic && <Text style={s.slotTag}>AUTO</Text>}
          </Pressable>
        )
      })}
    </View>
  )
})

export const PickupButton = memo(function PickupButton({ item, onPick }) {
  if (!item) return null
  const w = getWeapon(item.w)
  return (
    <Pressable onPress={() => onPick(item)} style={({ pressed }) => [s.pick, { borderColor: RARITY_COLORS[w.rarity] || AC.gold }, pressed && { transform: [{ scale: 0.96 }] }]} accessibilityRole="button" accessibilityLabel={`Pick up ${w.name}`}>
      <Ionicons name="hand-left" size={18} color="#10121f" />
      <Text style={s.pickText}>Pick up {w.short}</Text>
    </Pressable>
  )
})

// ---- countdown --------------------------------------------------------------------

export function CountdownOverlay({ msLeft, areaLabel }) {
  const secs = Math.max(0, Math.ceil(msLeft / 1000))
  return (
    <View style={s.countdown} pointerEvents="none">
      <Text style={s.cdLabel}>DROPPING IN</Text>
      <Text style={s.cdNum}>{secs}</Text>
      <Text style={s.cdSub}>{areaLabel ? `${areaLabel} zone · ` : ''}one life · last one standing wins</Text>
      <Text style={s.cdSafety}>Stay aware of traffic. Firing turns off at vehicle speed.</Text>
    </View>
  )
}

// ---- transit overlay (safety) -----------------------------------------------------

export function TransitOverlay({ insets, mph, hp, zone, gasText, mapProps, feed, alive, total }) {
  const [passenger, setPassenger] = useState(false)
  return (
    <View style={[StyleSheet.absoluteFill, s.transit]}>
      <LinearGradient colors={['#0b0d18', '#140a28']} style={StyleSheet.absoluteFill} />
      <View style={{ paddingTop: insets.top + 56, paddingHorizontal: 16, flex: 1, paddingBottom: insets.bottom + 16 }}>
        <View style={s.transitHead}>
          <View style={s.transitIcon}><Ionicons name="car-sport" size={26} color="#fff" /></View>
          <View style={{ flex: 1 }}>
            <Text style={s.transitTitle}>In transit</Text>
            <Text style={s.transitSpeed}>{mph > 0 ? `About ${mph} mph · ` : ''}{Math.ceil(hp)} HP</Text>
          </View>
        </View>
        <Text style={s.transitText} accessibilityLiveRegion="polite">{TRANSIT_TEXT}</Text>
        <Text style={s.transitNote}>You can’t fire and can’t be hit until you’ve been at walking pace for a few seconds. The gas still hurts.</Text>
        <View style={[s.transitMap, passenger && { flex: 1 }]}>
          <RoyaleMap {...mapProps} interactive={passenger} showRecenter={passenger} style={StyleSheet.absoluteFill} />
        </View>
        {passenger ? (
          <View style={{ marginTop: 10 }}>
            <ZonePill zone={zone} gasText={gasText} />
            <Text style={s.transitCallout}>{alive}/{total} players alive</Text>
            <Feed feed={feed} style={{ position: 'relative', left: 0, top: 0, marginTop: 6 }} />
            <GhostButton title="Hide map" icon="eye-off-outline" small onPress={() => setPassenger(false)} style={{ marginTop: 10 }} />
          </View>
        ) : (
          <View style={{ marginTop: 12 }}>
            <ZonePill zone={zone} gasText={gasText} />
            <GhostButton title="I’m a passenger" icon="map-outline" onPress={() => setPassenger(true)} style={{ marginTop: 12 }} />
            <Text style={s.transitNote}>Passengers can view the full map and callouts. Firing stays off until you’re on foot.</Text>
          </View>
        )}
      </View>
    </View>
  )
}

// ---- full map overlay -------------------------------------------------------------

export function MapPanel({ visible, onClose, insets, zone, mapProps, legend }) {
  if (!visible) return null
  return (
    <View style={[StyleSheet.absoluteFill, s.mapRoot]}>
      <Pressable style={s.backdrop} onPress={onClose} accessibilityLabel="Close map" />
      <View style={[s.mapPanelWrap, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 12 }]} pointerEvents="box-none">
        <View style={s.mapPanel}>
          <View style={s.mapHead}>
            <Text style={s.mapTitle}>Map</Text>
            <Pressable onPress={onClose} hitSlop={12} style={s.close} accessibilityRole="button" accessibilityLabel="Close map">
              <Ionicons name="close" size={20} color="#fff" />
            </Pressable>
          </View>
          <View style={s.bigMap}>
            <RoyaleMap {...mapProps} interactive showRecenter style={StyleSheet.absoluteFill} />
          </View>
          <View style={{ marginTop: 10 }}><ZonePill zone={zone} /></View>
          <Text style={s.legend}>{legend}</Text>
        </View>
      </View>
    </View>
  )
}

// ---- spectating -------------------------------------------------------------------

export function SpectateView({ insets, followName, followHp, followKills, onPrev, onNext, canCycle, myLine, mapProps, zone, alive, total, feed, onLeave }) {
  return (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: '#07080f' }]}>
      <RoyaleMap {...mapProps} style={StyleSheet.absoluteFill} />
      <LinearGradient pointerEvents="none" colors={['rgba(7,8,15,0.92)', 'rgba(7,8,15,0)']} style={[s.specShade, { height: insets.top + 190 }]} />
      <View style={[s.specTop, { top: insets.top + 56 }]}>
        <Text style={s.specLabel}>ELIMINATED · {myLine}</Text>
        <ZonePill zone={zone} />
        <Text style={s.specAlive}>{alive}/{total} alive</Text>
        <Feed feed={feed} style={{ position: 'relative', left: 0, top: 0, marginTop: 4 }} />
      </View>
      <View style={[s.specBottom, { bottom: insets.bottom + 16 }]}>
        <View style={s.specCard}>
          <Pressable onPress={onPrev} disabled={!canCycle} hitSlop={10} style={[s.specArrow, !canCycle && { opacity: 0.3 }]} accessibilityRole="button" accessibilityLabel="Previous player">
            <Ionicons name="chevron-back" size={22} color="#fff" />
          </Pressable>
          <View style={{ flex: 1, alignItems: 'center' }}>
            <Text style={s.specWatch}>SPECTATING</Text>
            <Text style={s.specName} numberOfLines={1}>{followName || 'No one left to follow'}</Text>
            {!!followName && <Text style={s.specStats}>{Math.ceil(followHp)} HP · {followKills} kills</Text>}
          </View>
          <Pressable onPress={onNext} disabled={!canCycle} hitSlop={10} style={[s.specArrow, !canCycle && { opacity: 0.3 }]} accessibilityRole="button" accessibilityLabel="Next player">
            <Ionicons name="chevron-forward" size={22} color="#fff" />
          </Pressable>
        </View>
        <GhostButton title="Leave match" icon="exit-outline" onPress={onLeave} style={{ marginTop: 10 }} />
      </View>
    </View>
  )
}

// ---- results ----------------------------------------------------------------------

export function ResultsView({ insets, state, meId, isHost, onLobby, onLeave }) {
  const me = state?.p?.[meId]
  const ranking = useMemo(() => {
    const p = state?.p || {}
    return Object.keys(p)
      .map((id) => ({ id, ...p[id] }))
      .sort((a, b) => ((a.pl || 999) - (b.pl || 999)) || ((b.k || 0) - (a.k || 0)))
      .slice(0, 25)
  }, [state?.p])
  const total = state?.total || ranking.length
  const won = !!me && state?.winner === meId
  const survived = me ? ((me.el || state?.endedAt || Date.now()) - (state?.startsAt || 0)) : 0
  return (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: AC.bg[0] }]}>
      <ArcadeBackground />
      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 30 }} showsVerticalScrollIndicator={false}>
        <RoyaleCover height={insets.top + 230} glyphSize={56}>
          <View style={s.resHead} pointerEvents="none">
            <Text style={s.resKicker}>{won ? 'LAST ONE STANDING' : 'MATCH OVER'}</Text>
            <Text style={s.resPlace}>{me ? `#${me.pl || '—'}` : '—'}<Text style={s.resOf}> / {total}</Text></Text>
            <Text style={s.resSub}>{won ? 'You won the Battle Royale!' : state?.winner ? `${state.p?.[state.winner]?.n || 'Someone'} won` : 'No winner'}</Text>
          </View>
        </RoyaleCover>
        <View style={{ paddingHorizontal: 18 }}>
          {me ? (
            <View style={s.tiles}>
              <StatTile label="Placement" value={`#${me.pl || '—'}`} accent={won ? AC.gold : undefined} />
              <StatTile label="Kills" value={me.k || 0} />
              <StatTile label="Survived" value={fmtDuration(survived)} />
            </View>
          ) : (
            <Text style={[s.legend, { marginTop: 16 }]}>You joined after this match started.</Text>
          )}
          <Text style={s.resSection}>Leaderboard</Text>
          {ranking.map((r) => (
            <View key={r.id} style={[s.rankRow, r.pl >= 1 && r.pl <= 3 && s.rankTop, r.id === meId && s.rankMe]}>
              <Text style={[s.rankPos, r.pl === 1 && { color: AC.gold }]}>{r.pl === 1 ? '🥇' : r.pl === 2 ? '🥈' : r.pl === 3 ? '🥉' : `#${r.pl || '—'}`}</Text>
              <Text style={s.rankName} numberOfLines={1}>{r.n}{r.id === meId ? ' (you)' : ''}</Text>
              <Text style={s.rankKills}>{r.k || 0} K</Text>
            </View>
          ))}
          <View style={{ height: 16 }} />
          {isHost && <PlayButton title="Back to lobby" icon="refresh" onPress={onLobby} colors={['#ff8a00', '#ff2e63']} />}
          {!isHost && <Text style={[s.legend, { marginBottom: 6 }]}>The host can take everyone back to the lobby for another match.</Text>}
          <GhostButton title="Leave" icon="exit-outline" onPress={onLeave} style={{ marginTop: 10 }} />
        </View>
      </ScrollView>
    </View>
  )
}

const s = StyleSheet.create({
  status: { width: 150, padding: 8, borderRadius: 14, backgroundColor: 'rgba(0,0,0,0.45)' },
  hpTrack: { height: 9, borderRadius: 5, backgroundColor: 'rgba(255,255,255,0.22)', overflow: 'hidden' },
  hpFill: { height: 9, borderRadius: 5 },
  statusRow: { flexDirection: 'row', alignItems: 'center', marginTop: 3 },
  statusText: { fontSize: 12, ...font.bold, color: '#fff', marginTop: 3, ...hudShadow },
  zoneWrap: { alignItems: 'center' },
  zonePill: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, backgroundColor: 'rgba(0,0,0,0.6)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)' },
  zoneText: { fontSize: 14, ...font.heavy, color: '#fff' },
  zonePhase: { fontSize: 11, ...font.bold, color: 'rgba(255,255,255,0.65)' },
  gasPill: { marginTop: 6, paddingHorizontal: 12, paddingVertical: 5, borderRadius: 999, backgroundColor: 'rgba(161,77,255,0.85)' },
  gasText: { fontSize: 12, ...font.heavy, color: '#fff' },
  banner: { position: 'absolute', left: 20, right: 20, paddingVertical: 10, paddingHorizontal: 14, borderRadius: 16, alignItems: 'center' },
  bannerTitle: { fontSize: 16, ...font.heavy, color: '#fff', textAlign: 'center' },
  bannerSub: { fontSize: 13, color: 'rgba(255,255,255,0.9)', marginTop: 2, textAlign: 'center' },
  feed: { position: 'absolute', maxWidth: '62%' },
  feedText: { fontSize: 11, ...font.semibold, color: '#fff', ...hudShadow, marginTop: 2 },
  flashWrap: { position: 'absolute', left: 0, right: 0, top: '58%', alignItems: 'center' },
  flash: { fontSize: 20, ...font.heavy, ...hudShadow, textAlign: 'center' },
  slots: { gap: 6, alignItems: 'flex-end' },
  slot: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 7, borderRadius: 14, backgroundColor: 'rgba(0,0,0,0.45)', borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.15)', minWidth: 96 },
  slotIcon: { fontSize: 16 },
  slotName: { fontSize: 13, ...font.heavy, color: 'rgba(255,255,255,0.75)', flexShrink: 1 },
  slotTag: { fontSize: 8, ...font.heavy, color: AC.gold, letterSpacing: 0.5 },
  pick: { flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'center', paddingHorizontal: 18, paddingVertical: 12, borderRadius: 999, backgroundColor: AC.gold, borderWidth: 2 },
  pickText: { fontSize: 16, ...font.heavy, color: '#10121f' },
  countdown: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(7,8,15,0.72)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  cdLabel: { fontSize: 13, ...font.heavy, color: '#ffb36b', letterSpacing: 3 },
  cdNum: { fontSize: 96, ...font.heavy, color: '#fff' },
  cdSub: { fontSize: 15, color: 'rgba(255,255,255,0.85)', textAlign: 'center' },
  cdSafety: { fontSize: 13, color: AC.gold, textAlign: 'center', marginTop: 14 },
  transit: { zIndex: 40, elevation: 40 },
  transitHead: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  transitIcon: { width: 52, height: 52, borderRadius: 26, backgroundColor: '#ff8a00', alignItems: 'center', justifyContent: 'center' },
  transitTitle: { fontSize: 28, ...font.heavy, color: '#fff' },
  transitSpeed: { fontSize: 13, ...font.bold, color: AC.muted },
  transitText: { fontSize: 16, ...font.bold, color: '#fff', marginTop: 14 },
  transitNote: { fontSize: 12, color: AC.muted, marginTop: 6 },
  transitMap: { height: 220, borderRadius: 18, overflow: 'hidden', marginTop: 14, backgroundColor: '#141826' },
  transitCallout: { fontSize: 13, ...font.bold, color: '#fff', textAlign: 'center', marginTop: 8 },
  mapRoot: { zIndex: 50, elevation: 50 },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.55)' },
  mapPanelWrap: { flex: 1, justifyContent: 'center', paddingHorizontal: 12 },
  mapPanel: { backgroundColor: 'rgba(14,17,30,0.97)', borderRadius: 26, padding: 14, borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)' },
  mapHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  mapTitle: { fontSize: 20, ...font.heavy, color: '#fff' },
  close: { width: 34, height: 34, borderRadius: 17, backgroundColor: 'rgba(255,255,255,0.14)', alignItems: 'center', justifyContent: 'center' },
  bigMap: { height: 400, borderRadius: 16, overflow: 'hidden', backgroundColor: '#141826' },
  legend: { fontSize: 11, color: 'rgba(255,255,255,0.6)', marginTop: 8, textAlign: 'center' },
  specShade: { position: 'absolute', left: 0, right: 0, top: 0 },
  specTop: { position: 'absolute', left: 16, right: 16, alignItems: 'center', gap: 6 },
  specLabel: { fontSize: 12, ...font.heavy, color: '#ff8a9a', letterSpacing: 1 },
  specAlive: { fontSize: 12, ...font.bold, color: '#fff', ...hudShadow },
  specBottom: { position: 'absolute', left: 16, right: 16 },
  specCard: { flexDirection: 'row', alignItems: 'center', padding: 12, borderRadius: 22, backgroundColor: 'rgba(10,12,22,0.9)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)' },
  specArrow: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.1)', alignItems: 'center', justifyContent: 'center' },
  specWatch: { fontSize: 10, ...font.heavy, color: ROYALE_COLORS.follow, letterSpacing: 1.5 },
  specName: { fontSize: 18, ...font.heavy, color: '#fff' },
  specStats: { fontSize: 12, color: AC.muted },
  resHead: { position: 'absolute', left: 20, right: 20, bottom: 18 },
  resKicker: { fontSize: 12, ...font.heavy, color: 'rgba(255,255,255,0.85)', letterSpacing: 2 },
  resPlace: { fontSize: 56, ...font.heavy, color: '#fff', letterSpacing: -1 },
  resOf: { fontSize: 22, ...font.bold, color: 'rgba(255,255,255,0.75)' },
  resSub: { fontSize: 15, color: 'rgba(255,255,255,0.9)' },
  tiles: { flexDirection: 'row', gap: 8, marginTop: 16 },
  resSection: { fontSize: 18, ...font.bold, color: AC.text, marginTop: 22, marginBottom: 8 },
  rankRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, paddingHorizontal: 12, borderRadius: 14, backgroundColor: AC.card, borderWidth: 1, borderColor: AC.border, marginBottom: 6 },
  rankTop: { backgroundColor: 'rgba(255,201,77,0.08)' },
  rankMe: { borderColor: AC.gold, shadowColor: AC.gold, shadowOpacity: 0.4, shadowRadius: 10, shadowOffset: { width: 0, height: 0 } },
  rankPos: { width: 46, fontSize: 15, ...font.heavy, color: AC.text },
  rankName: { flex: 1, fontSize: 15, ...font.semibold, color: AC.text },
  rankKills: { fontSize: 13, ...font.bold, color: AC.muted },
})
