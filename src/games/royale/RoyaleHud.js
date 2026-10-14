// Battle Royale HUD pieces in the studio look (src/games/studio.js): status strip + HP,
// zone callout, callout banner, kill feed, elimination / hit flashes, weapon slots, loot
// prompt, countdown, the transit overlay, spectate view, full map and the results screen.
//
// Studio rules: colour means role (you = friendly, others = enemy, zone = objective, HP =
// health, loot = rarity), black glass panels with square corners, caps labels, Chakra Petch
// for numbers and names, no emoji in the chrome.
import React, { memo, useMemo, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { LinearGradient } from 'expo-linear-gradient'
import { Ionicons } from '@expo/vector-icons'
import Svg, { Path } from 'react-native-svg'
import { PlayerTap, formatClock } from '../MultiplayerUI'
import GameFollowButton from '../../components/GameFollowButton'
import { FONT, ST, StBar, StButton, stShadow, stType, withAlpha } from '../studio'
import { COUNTDOWN_MS, TRANSIT_TEXT } from './constants'
import { RoyaleMap } from './RoyaleMap'
import { RARITY_COLORS, RARITY_LABEL, getWeapon } from './weaponsAdapter'
import { formatDistance } from './geo'

export const hudShadow = stShadow

export const fmtDuration = (ms) => {
  const t = Math.max(0, Math.floor((Number(ms) || 0) / 1000))
  const h = Math.floor(t / 3600)
  const m = Math.floor((t % 3600) / 60)
  const sec = t % 60
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`
}

/** Match score shown on results (same formula as the recorded round result). */
export const royaleScore = (kills, placement, total) => (kills || 0) * 100 + Math.max(0, (total || 0) - (placement || total || 0)) * 10

const hpColor = (v) => (v > 25 ? ST.health : ST.enemy)

// Zone timer for the status strip: label + value.
function zoneClock(zone) {
  if (!zone) return { label: 'ZONE', value: '—' }
  if (zone.stage === 'final') return { label: 'CLOSED', value: '0:00' }
  if (zone.stage === 'shrink') return { label: 'CLOSING', value: formatClock(zone.msToEnd) }
  return { label: zone.isFinal ? 'FINAL' : 'ZONE', value: formatClock(zone.msToShrink) }
}

// ---- top-left status: ALIVE · KILLS · ZONE, then HP ---------------------------------

export const StatusCard = memo(function StatusCard({ hp, alive, total, kills, zone }) {
  const v = Math.max(0, Math.min(100, Math.ceil(Number(hp) || 0)))
  const zc = zoneClock(zone)
  return (
    <View style={s.status} pointerEvents="none" accessible accessibilityLabel={`${v} health, ${alive} of ${total} alive, ${kills} kills`}>
      <View style={s.statRow}>
        <View style={s.statCell}>
          <Text style={stType.label}>ALIVE</Text>
          <Text style={s.statNum}>{alive}{total ? <Text style={s.statOf}>/{total}</Text> : null}</Text>
        </View>
        <View style={s.statCell}>
          <Text style={stType.label}>KILLS</Text>
          <Text style={s.statNum}>{kills}</Text>
        </View>
        <View style={s.statCell}>
          <Text style={[stType.label, { color: ST.objective }]}>{zc.label}</Text>
          <Text style={[s.statNum, { color: ST.objective }]} numberOfLines={1}>{zc.value}</Text>
        </View>
      </View>
      <StBar value={v / 100} color={hpColor(v)} height={8} style={{ marginTop: 6 }} />
      <Text style={s.hpLine}>{v} <Text style={s.hpUnit}>HP</Text></Text>
    </View>
  )
})

// ---- zone callout -------------------------------------------------------------------
// hint: where the next circle is ("Next zone 450 ft north-west" / "Inside the next zone").
// gasText: set while you're in the gas (red variant). showTimer adds the countdown to the
// title (for screens without the status strip).

export const ZonePill = memo(function ZonePill({ zone, gasText, hint, showTimer = false, style }) {
  if (!zone) return null
  const shrinking = zone.stage === 'shrink'
  let title
  if (zone.stage === 'final') title = 'ZONE CLOSED'
  else if (shrinking) title = zone.isFinal ? 'ZONE COLLAPSING' : 'ZONE CLOSING'
  else title = zone.isFinal ? 'FINAL CIRCLE' : `NEXT ZONE · PHASE ${Math.min(zone.phase, zone.phases)}/${zone.phases}`
  if (showTimer && zone.stage !== 'final') title += ` · ${formatClock(shrinking ? zone.msToEnd : zone.msToShrink)}`
  const gas = !!gasText
  const c = gas ? ST.enemy : ST.objective
  const sub = gas ? gasText : hint || (zone.stage === 'final' ? 'Last one standing wins' : null)
  return (
    <View style={[s.zone, { backgroundColor: withAlpha(c, gas ? 0.22 : 0.16), borderLeftColor: c }, style]} pointerEvents="none" accessibilityLiveRegion="polite">
      <View style={s.zoneHead}>
        <Ionicons name={gas ? 'warning' : shrinking ? 'contract' : 'locate-outline'} size={13} color={c} />
        <Text style={[s.zoneTitle, { color: c }]} numberOfLines={1}>{gas ? 'IN THE GAS' : title}</Text>
      </View>
      {!!sub && <Text style={s.zoneSub} numberOfLines={2}>{sub}</Text>}
    </View>
  )
})
export const ZoneCallout = ZonePill

// ---- banner (callouts) --------------------------------------------------------------

export const Banner = memo(function Banner({ banner, top }) {
  if (!banner) return null
  const c = banner.color || ST.friendly
  return (
    <View style={[s.banner, { top }]} pointerEvents="none" accessibilityLiveRegion="polite">
      <View style={[s.bannerPanel, { borderTopColor: c }]}>
        <Text style={[s.bannerTitle, { color: c }]} numberOfLines={2}>{banner.title}</Text>
        {!!banner.sub && <Text style={s.bannerSub} numberOfLines={2}>{banner.sub}</Text>}
      </View>
    </View>
  )
})

// ---- kill feed ----------------------------------------------------------------------

function GunGlyph() {
  return (
    <Svg width={16} height={10} viewBox="0 0 24 14" fill="none" stroke={ST.text} strokeWidth={2}>
      <Path d="M1 7h14l3-4h5M15 7l2 5" />
    </Svg>
  )
}

function FeedRow({ f, meName }) {
  const isMe = (n) => !!meName && n === meName
  const nameEl = (n, color) => (
    <Text style={[s.feedName, { color: isMe(n) ? ST.friendly : color }]} numberOfLines={1}>{isMe(n) ? 'YOU' : String(n || '').toUpperCase()}</Text>
  )
  const mine = isMe(f.v) || isMe(f.k)
  let body
  if (!f.c || !f.v) {
    body = <Text style={s.feedText} numberOfLines={1}>{f.t}</Text>
  } else if (f.c === 'kill') {
    body = <>{nameEl(f.k, ST.enemy)}<GunGlyph />{nameEl(f.v, ST.enemy)}</>
  } else if (f.c === 'gas') {
    body = <><Text style={[s.feedName, { color: ST.objective }]}>ZONE</Text><Text style={s.feedVerb}>took</Text>{nameEl(f.v, ST.enemy)}</>
  } else if (f.c === 'win') {
    body = <>{nameEl(f.v, ST.objective)}<Text style={s.feedVerb}>wins</Text></>
  } else {
    body = <>{nameEl(f.v, ST.enemy)}<Text style={s.feedVerb}>{f.c === 'left' ? 'left' : 'lost GPS'}</Text></>
  }
  return (
    <View style={[s.feedRow, mine && s.feedMine]}>
      {body}
      {f.c && f.c !== 'win' && f.pl ? <Text style={s.feedPl}>#{f.pl}</Text> : null}
    </View>
  )
}

export const Feed = memo(function Feed({ feed, style, meName, max = 3, align = 'flex-end' }) {
  if (!Array.isArray(feed) || !feed.length) return null
  return (
    <View style={[s.feed, { alignItems: align }, style]} pointerEvents="none">
      {feed.slice(0, max).map((f) => <FeedRow key={f.id} f={f} meName={meName} />)}
    </View>
  )
})

// ---- flashes: elimination banner, hit marker, notices ------------------------------
// flash: { text, good, kind?: 'kill' | 'hit' | 'notice', name?, sub?, head? }

export const Flash = memo(function Flash({ flash }) {
  if (!flash) return null
  if (flash.kind === 'kill') {
    return (
      <View style={s.killWrap} pointerEvents="none" accessibilityLiveRegion="assertive">
        <View style={s.killKicker}>
          <View style={s.killRule} />
          <Text style={s.killKickerText}>ELIMINATED</Text>
          <View style={s.killRule} />
        </View>
        <Text style={s.killName} numberOfLines={1}>{String(flash.name || '').toUpperCase()}</Text>
        <View style={s.killChip}>
          {!!flash.sub && <Text style={s.killSub}>{flash.sub}</Text>}
          <Text style={s.killPts}>+100</Text>
        </View>
      </View>
    )
  }
  if (flash.kind === 'hit') {
    return (
      <View style={s.flashWrap} pointerEvents="none">
        <Text style={[s.hitText, flash.head && { color: ST.objective }]}>{flash.text}</Text>
      </View>
    )
  }
  return (
    <View style={s.flashWrap} pointerEvents="none" accessibilityLiveRegion="polite">
      <View style={[s.notice, { borderLeftColor: flash.good ? ST.health : ST.lineStrong }]}>
        <Text style={[s.noticeText, flash.good && { color: ST.health }]}>{flash.text}</Text>
      </View>
    </View>
  )
})

// ---- weapons ------------------------------------------------------------------------

export const WeaponSlots = memo(function WeaponSlots({ ids, current, onSelect, disabled }) {
  return (
    <View style={s.slots}>
      {ids.map((id, i) => {
        const w = getWeapon(id)
        const on = id === current
        return (
          <Pressable
            key={id}
            onPress={() => onSelect(id)}
            disabled={disabled}
            style={({ pressed }) => [s.slot, on && s.slotOn, disabled && { opacity: 0.5 }, pressed && { opacity: 0.8 }]}
            accessibilityRole="button"
            accessibilityState={{ selected: on, disabled: !!disabled }}
            accessibilityLabel={`Equip ${w.name}`}
          >
            <View style={[s.slotRarity, { backgroundColor: RARITY_COLORS[w.rarity] || ST.faint }]} />
            <View style={{ flexShrink: 1 }}>
              <View style={s.slotTop}>
                <Text style={stType.label}>{i + 1}</Text>
                {w.automatic && <Text style={[stType.label, { color: ST.objective, letterSpacing: 1 }]}>AUTO</Text>}
              </View>
              <Text style={[s.slotName, on && { color: ST.text }]} numberOfLines={1}>{w.short.toUpperCase()}</Text>
            </View>
          </Pressable>
        )
      })}
    </View>
  )
})

// ---- loot prompt --------------------------------------------------------------------

// swapFor: the weapon id this pickup would replace (both slots full), shown as a hint.
export const PickupButton = memo(function PickupButton({ item, onPick, swapFor }) {
  if (!item) return null
  const w = getWeapon(item.w)
  const c = RARITY_COLORS[w.rarity] || ST.objective
  const away = Number.isFinite(item.d) ? ` · ${formatDistance(item.d).toUpperCase()} AWAY` : ''
  return (
    <Pressable
      onPress={() => onPick(item)}
      style={({ pressed }) => [s.pick, { borderTopColor: c }, pressed && { opacity: 0.85, transform: [{ scale: 0.98 }] }]}
      accessibilityRole="button"
      accessibilityLabel={`Pick up ${w.name}`}
    >
      <Text style={[stType.label, { color: c }]}>{RARITY_LABEL[w.rarity] || 'LOOT'}{away}</Text>
      <Text style={s.pickName} numberOfLines={1}>{w.name.toUpperCase()}</Text>
      <View style={s.pickHint}>
        <Ionicons name="hand-left-outline" size={12} color={ST.muted} />
        <Text style={s.pickHintText}>{swapFor ? `Tap to swap for your ${getWeapon(swapFor).short}` : 'Tap to pick up'}</Text>
      </View>
    </Pressable>
  )
})

// ---- countdown ----------------------------------------------------------------------

export function CountdownOverlay({ msLeft, areaLabel }) {
  const secs = Math.max(0, Math.ceil(msLeft / 1000))
  return (
    <View style={s.countdown} pointerEvents="none" accessibilityLiveRegion="polite">
      <Text style={[stType.kicker, { color: ST.objective }]}>DROPPING IN</Text>
      <Text style={s.cdNum}>{secs}</Text>
      <StBar value={1 - Math.max(0, msLeft) / COUNTDOWN_MS} color={ST.objective} height={4} style={{ width: 160 }} />
      <Text style={s.cdSub}>{areaLabel ? `${areaLabel} zone · ` : ''}One life · last one standing wins</Text>
      <View style={s.cdSafety}>
        <Ionicons name="warning-outline" size={14} color={ST.objective} />
        <Text style={s.cdSafetyText}>Stay aware of traffic. Firing turns off at vehicle speed.</Text>
      </View>
    </View>
  )
}

// ---- transit overlay (safety) -------------------------------------------------------

export function TransitOverlay({ insets, mph, hp, zone, gasText, hint, mapProps, feed, alive, total, meName }) {
  const [passenger, setPassenger] = useState(false)
  return (
    <View style={[StyleSheet.absoluteFill, s.transit]}>
      <View style={{ paddingTop: insets.top + 56, paddingHorizontal: 16, flex: 1, paddingBottom: insets.bottom + 16 }}>
        <View style={s.transitHead}>
          <View style={s.transitIcon}><Ionicons name="car-sport-outline" size={26} color={ST.objective} /></View>
          <View style={{ flex: 1 }}>
            <Text style={[stType.kicker, { color: ST.objective }]}>SAFETY · FIRING OFF</Text>
            <Text style={stType.title}>In transit</Text>
            <Text style={stType.label}>{mph > 0 ? `ABOUT ${mph} MPH · ` : ''}{Math.ceil(hp)} HP</Text>
          </View>
        </View>
        <Text style={[stType.body, { marginTop: 14, color: ST.text }]} accessibilityLiveRegion="polite">{TRANSIT_TEXT}</Text>
        <Text style={[stType.small, { marginTop: 6 }]}>You can’t fire and can’t be hit until you’ve been at walking pace for a few seconds. The gas is paused for you meanwhile (5 min per match), so there’s no need to hurry anywhere by car.</Text>
        <View style={[s.transitMap, passenger && { flex: 1 }]}>
          <RoyaleMap {...mapProps} interactive={passenger} showRecenter={passenger} style={StyleSheet.absoluteFill} />
        </View>
        <View style={{ marginTop: 10 }}>
          <ZonePill zone={zone} gasText={gasText} hint={hint} showTimer />
        </View>
        {passenger ? (
          <View style={{ marginTop: 8 }}>
            <Text style={[stType.label, { textAlign: 'center', marginTop: 4 }]}>{alive}/{total} PLAYERS ALIVE</Text>
            <Feed feed={feed} meName={meName} align="stretch" style={{ marginTop: 6 }} />
            <StButton title="Hide map" tone="ghost" height={42} onPress={() => setPassenger(false)} style={{ marginTop: 10 }} left={<Ionicons name="eye-off-outline" size={16} color="#fff" />} />
          </View>
        ) : (
          <View style={{ marginTop: 12 }}>
            <StButton title="I’m a passenger" tone="ghost" onPress={() => setPassenger(true)} left={<Ionicons name="map-outline" size={16} color="#fff" />} />
            <Text style={[stType.small, { marginTop: 8, textAlign: 'center' }]}>Passengers can view the full map and callouts. Firing stays off until you’re on foot.</Text>
          </View>
        )}
      </View>
    </View>
  )
}

// ---- full map overlay ---------------------------------------------------------------

export function MapPanel({ visible, onClose, insets, zone, hint, mapProps, legend }) {
  if (!visible) return null
  return (
    <View style={[StyleSheet.absoluteFill, s.mapRoot]}>
      <Pressable style={s.backdrop} onPress={onClose} accessibilityLabel="Close map" />
      <View style={[s.mapPanelWrap, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 12 }]} pointerEvents="box-none">
        <View style={s.mapPanel}>
          <View style={s.mapHead}>
            <View>
              <Text style={stType.kicker}>BATTLE ROYALE</Text>
              <Text style={stType.title}>Map</Text>
            </View>
            <Pressable onPress={onClose} hitSlop={12} style={s.close} accessibilityRole="button" accessibilityLabel="Close map">
              <Ionicons name="close" size={18} color="#fff" />
            </Pressable>
          </View>
          <View style={s.bigMap}>
            <RoyaleMap {...mapProps} interactive showRecenter style={StyleSheet.absoluteFill} />
          </View>
          <View style={{ marginTop: 10 }}><ZonePill zone={zone} hint={hint} showTimer /></View>
          <Text style={s.legend}>{legend}</Text>
        </View>
      </View>
    </View>
  )
}

// ---- spectating ---------------------------------------------------------------------

function SquareArrow({ icon, onPress, disabled, label }) {
  return (
    <Pressable onPress={onPress} disabled={disabled} hitSlop={10} style={({ pressed }) => [s.specArrow, disabled && { opacity: 0.3 }, pressed && { opacity: 0.7 }]} accessibilityRole="button" accessibilityLabel={label}>
      <Ionicons name={icon} size={20} color="#fff" />
    </Pressable>
  )
}

export function SpectateView({
  insets, followId, followName, followHp, followKills, onPrev, onNext, canCycle, myLine, mapProps, zone, alive, total, feed, onLeave,
  me, killerId, killerName, survivedMs, meName,
}) {
  const by = me?.by
  const killedBy = by && by !== 'gas' && by !== 'left' && by !== 'signal' ? (killerName || by) : null
  const hpV = Math.max(0, Math.min(100, Math.ceil(followHp || 0)))
  return (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: ST.ground }]}>
      <RoyaleMap {...mapProps} style={StyleSheet.absoluteFill} />
      <LinearGradient pointerEvents="none" colors={[withAlpha(ST.ground, 0.94), withAlpha(ST.ground, 0)]} style={[s.specShade, { height: insets.top + 300 }]} />
      <View style={[s.specTop, { top: insets.top + 56 }]}>
        {me ? (
          <>
            <View style={s.killKicker}>
              <View style={s.killRule} />
              <Text style={s.killKickerText}>ELIMINATED</Text>
              <View style={s.killRule} />
            </View>
            <Text style={s.specPlace}>#{me.pl || '—'}<Text style={s.specOf}> / {total}</Text></Text>
            <Text style={[stType.label, { color: ST.text }]}>{me.k || 0} KILLS · {fmtDuration(survivedMs)} SURVIVED</Text>
            {killedBy ? (
              <View style={s.byCard}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={stType.label}>ELIMINATED BY</Text>
                  <Text style={[stType.name, { color: ST.enemy, fontSize: 18 }]} numberOfLines={1}>{String(killedBy).toUpperCase()}</Text>
                </View>
                {killerId ? <GameFollowButton userId={killerId} name={killedBy} size="sm" /> : null}
              </View>
            ) : by ? (
              <Text style={[stType.small, { marginTop: 2 }]}>{by === 'gas' ? 'The zone got you' : by === 'signal' ? 'Lost GPS signal' : 'You left the match'}</Text>
            ) : null}
          </>
        ) : (
          <>
            <Text style={stType.kicker}>SPECTATING</Text>
            <Text style={stType.small}>{myLine || 'You joined after this match started.'}</Text>
          </>
        )}
        <ZonePill zone={zone} showTimer style={{ alignSelf: 'stretch', marginTop: 6 }} />
        <Text style={[stType.label, { color: ST.text }]}>{alive}/{total} ALIVE</Text>
        <Feed feed={feed} meName={meName} align="center" />
      </View>
      <View style={[s.specBottom, { bottom: insets.bottom + 16 }]}>
        <View style={s.specCard}>
          <SquareArrow icon="chevron-back" onPress={onPrev} disabled={!canCycle} label="Previous player" />
          <View style={{ flex: 1, minWidth: 0, paddingHorizontal: 10 }}>
            <Text style={[stType.kicker, { fontSize: 10 }]}>{followId && followId === killerId ? 'SPECTATING · YOUR KILLER' : 'SPECTATING'}</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Text style={[stType.name, { fontSize: 18, flexShrink: 1 }]} numberOfLines={1}>{followName ? String(followName).toUpperCase() : 'NO ONE LEFT'}</Text>
              {followId && followName ? <GameFollowButton userId={followId} name={followName} size="sm" /> : null}
            </View>
            {!!followName && (
              <>
                <StBar value={hpV / 100} color={hpColor(hpV)} height={5} style={{ marginTop: 6 }} />
                <Text style={[stType.label, { marginTop: 3 }]}>{hpV} HP · {followKills} KILLS</Text>
              </>
            )}
          </View>
          <SquareArrow icon="chevron-forward" onPress={onNext} disabled={!canCycle} label="Next player" />
        </View>
        <StButton title="Leave match" tone="ghost" onPress={onLeave} style={{ marginTop: 10 }} left={<Ionicons name="exit-outline" size={16} color="#fff" />} />
      </View>
    </View>
  )
}

// ---- results ------------------------------------------------------------------------

const causeLine = (r) => (r.pl === 1 ? 'Last one standing' : r.by === 'gas' ? 'Zone' : r.by === 'left' ? 'Left' : r.by === 'signal' ? 'Lost GPS' : r.by ? `by ${r.by}` : '')

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
  const winner = state?.winner ? { id: state.winner, ...(state.p?.[state.winner] || {}) } : null
  const survived = me ? ((me.el || state?.endedAt || Date.now()) - (state?.startsAt || 0)) : 0
  const played = (state?.endedAt || Date.now()) - (state?.startsAt || 0)
  const accent = won ? ST.friendly : me ? ST.enemy : ST.objective
  const score = me ? royaleScore(me.k, me.pl, total) : 0
  return (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: ST.ground }]}>
      <LinearGradient pointerEvents="none" colors={[withAlpha(accent, 0.22), withAlpha(accent, 0)]} style={[s.resTint, { height: insets.top + 300 }]} />
      <ScrollView contentContainerStyle={{ paddingTop: insets.top + 64, paddingBottom: insets.bottom + 30, paddingHorizontal: 16 }} showsVerticalScrollIndicator={false}>
        <View style={s.resHead}>
          <Text style={[stType.kicker, { color: accent }]}>BATTLE ROYALE · {total} PLAYERS</Text>
          <Text style={stType.display} numberOfLines={1} adjustsFontSizeToFit>{won ? 'Victory' : me ? `#${me.pl || '—'}` : 'Match over'}</Text>
          <Text style={[stType.body, { textAlign: 'center' }]}>
            {won ? 'Last one standing' : me ? `of ${total} · ` : ''}{!won ? (winner ? `${winner.n || 'Someone'} won` : 'No winner') : ''} · {fmtDuration(played)} played
          </Text>
        </View>

        {me ? (
          <View style={s.tiles}>
            {[
              { l: 'PLACE', v: `#${me.pl || '—'}`, c: won ? ST.objective : undefined },
              { l: 'KILLS', v: String(me.k || 0) },
              { l: 'SURVIVED', v: fmtDuration(survived) },
              { l: 'SCORE', v: `+${score}`, c: ST.objective },
            ].map((t) => (
              <View key={t.l} style={s.tile}>
                <Text style={stType.label} numberOfLines={1}>{t.l}</Text>
                <Text style={[s.tileNum, t.c && { color: t.c }]} numberOfLines={1} adjustsFontSizeToFit>{t.v}</Text>
              </View>
            ))}
          </View>
        ) : (
          <Text style={[s.legend, { marginTop: 16 }]}>You joined after this match started.</Text>
        )}

        {winner && (
          <View style={s.mvp}>
            <Ionicons name="star-outline" size={30} color={ST.objective} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={[stType.label, { color: ST.objective }]}>WINNER</Text>
              <Text style={[stType.name, { fontSize: 18 }]} numberOfLines={1}>{String(winner.n || 'Player').toUpperCase()} · {winner.k || 0} kills</Text>
            </View>
            {winner.id !== meId ? <GameFollowButton userId={winner.id} name={winner.n} size="sm" /> : null}
          </View>
        )}

        <Text style={[stType.label, { marginTop: 22, marginBottom: 6 }]}>LEADERBOARD · TAP A NAME FOR THEIR PROFILE</Text>
        <View style={s.rankHead}>
          <Text style={[s.rankHeadText, { width: 34 }]}>#</Text>
          <Text style={[s.rankHeadText, { flex: 1 }]}>PLAYER</Text>
          <Text style={[s.rankHeadText, { width: 30, textAlign: 'center' }]}>K</Text>
          <View style={{ width: 40 }} />
        </View>
        {ranking.map((r) => {
          const mine = r.id === meId
          return (
            <View key={r.id} style={[s.rankRow, mine && s.rankMe]}>
              <Text style={[s.rankPos, r.pl === 1 && { color: ST.objective }]}>{r.pl || '—'}</Text>
              <PlayerTap player={{ id: r.id, username: r.n }} style={{ flex: 1, minWidth: 0 }}>
                <Text style={s.rankName} numberOfLines={1}>{r.n}{mine ? ' (you)' : ''}</Text>
                {!!causeLine(r) && <Text style={s.rankCause} numberOfLines={1}>{causeLine(r)}</Text>}
              </PlayerTap>
              <Text style={s.rankKills}>{r.k || 0}</Text>
              <View style={{ width: 40, alignItems: 'flex-end' }}>
                {!mine ? <GameFollowButton userId={r.id} name={r.n} size="sm" /> : null}
              </View>
            </View>
          )
        })}
        <View style={{ height: 18 }} />
        {isHost && <StButton title="Back to lobby" onPress={onLobby} left={<Ionicons name="refresh" size={18} color={ST.ink} />} />}
        {!isHost && <Text style={[s.legend, { marginBottom: 6 }]}>The host can take everyone back to the lobby for another match.</Text>}
        <StButton title="Leave" tone="ghost" onPress={onLeave} style={{ marginTop: 10 }} left={<Ionicons name="exit-outline" size={16} color="#fff" />} />
      </ScrollView>
    </View>
  )
}

const panel = { backgroundColor: ST.panel, borderRadius: ST.radius }

const s = StyleSheet.create({
  status: { ...panel, minWidth: 196, paddingHorizontal: 12, paddingVertical: 8 },
  statRow: { flexDirection: 'row', gap: 12 },
  statCell: { minWidth: 0 },
  statNum: { ...stType.num, fontSize: 22, lineHeight: 26 },
  statOf: { fontFamily: FONT.displaySemi, fontSize: 13, color: ST.faint },
  hpLine: { ...stType.num, fontSize: 16, marginTop: 3 },
  hpUnit: { fontFamily: FONT.ui, fontSize: 10, letterSpacing: 1.6, color: ST.muted },

  zone: { alignSelf: 'flex-start', maxWidth: 320, paddingHorizontal: 10, paddingVertical: 6, borderLeftWidth: 3, borderRadius: ST.radius },
  zoneHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  zoneTitle: { fontFamily: FONT.display, fontSize: 14, letterSpacing: 0.5, includeFontPadding: false },
  zoneSub: { fontFamily: FONT.uiSemi, fontSize: 12, lineHeight: 16, color: ST.text, marginTop: 1 },

  banner: { position: 'absolute', left: 16, right: 16, alignItems: 'center' },
  bannerPanel: { ...panel, backgroundColor: ST.panelStrong, borderTopWidth: 2, paddingVertical: 10, paddingHorizontal: 16, alignItems: 'center', maxWidth: 420 },
  bannerTitle: { fontFamily: FONT.display, fontSize: 18, letterSpacing: 1, textTransform: 'uppercase', textAlign: 'center', includeFontPadding: false },
  bannerSub: { ...stType.body, fontSize: 13, color: 'rgba(242,244,247,0.85)', marginTop: 3, textAlign: 'center' },

  feed: { gap: 4 },
  feedRow: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 8, paddingVertical: 3, backgroundColor: 'rgba(8,10,14,0.62)', maxWidth: 260 },
  feedMine: { backgroundColor: withAlpha(ST.friendly, 0.22), borderLeftWidth: 2, borderLeftColor: ST.friendly },
  feedName: { fontFamily: FONT.ui, fontSize: 12, flexShrink: 1 },
  feedVerb: { fontFamily: FONT.ui, fontSize: 12, color: ST.text },
  feedText: { fontFamily: FONT.uiSemi, fontSize: 12, color: ST.text, flexShrink: 1 },
  feedPl: { fontFamily: FONT.displaySemi, fontSize: 11, color: ST.faint },

  flashWrap: { position: 'absolute', left: 16, right: 16, top: '58%', alignItems: 'center' },
  hitText: { fontFamily: FONT.display, fontSize: 20, letterSpacing: 1, color: ST.text, textTransform: 'uppercase', ...stShadow },
  notice: { ...panel, backgroundColor: ST.panelStrong, borderLeftWidth: 3, paddingHorizontal: 12, paddingVertical: 8, maxWidth: 340 },
  noticeText: { ...stType.body, color: ST.text, textAlign: 'center' },
  killWrap: { position: 'absolute', left: 0, right: 0, top: '56%', alignItems: 'center', gap: 6, paddingHorizontal: 16 },
  killKicker: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  killRule: { width: 40, height: 2, backgroundColor: ST.enemy },
  killKickerText: { fontFamily: FONT.ui, fontSize: 11, letterSpacing: 2.6, color: ST.enemy },
  killName: { fontFamily: FONT.display, fontSize: 34, letterSpacing: 1.5, color: '#fff', includeFontPadding: false, ...stShadow, textShadowRadius: 12 },
  killChip: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 4, backgroundColor: ST.panel },
  killSub: { fontFamily: FONT.ui, fontSize: 12, letterSpacing: 1.2, color: 'rgba(242,244,247,0.8)', textTransform: 'uppercase' },
  killPts: { ...stType.num, fontSize: 16, color: ST.objective },

  slots: { gap: 6, alignItems: 'stretch' },
  slot: { ...panel, flexDirection: 'row', alignItems: 'center', gap: 8, paddingRight: 10, height: 44, minWidth: 104, borderWidth: 1, borderColor: ST.line, overflow: 'hidden' },
  slotOn: { borderWidth: 2, borderColor: ST.friendly, backgroundColor: ST.panelStrong },
  slotRarity: { width: 3, alignSelf: 'stretch' },
  slotTop: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  slotName: { fontFamily: FONT.display, fontSize: 13, color: ST.muted, includeFontPadding: false },

  pick: { ...panel, width: 220, alignSelf: 'center', alignItems: 'center', gap: 2, padding: 10, borderTopWidth: 2 },
  pickName: { ...stType.name, fontSize: 16 },
  pickHint: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  pickHintText: { ...stType.small, fontSize: 11 },

  countdown: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(8,10,14,0.78)', alignItems: 'center', justifyContent: 'center', padding: 24, gap: 8 },
  cdNum: { ...stType.num, fontSize: 96, lineHeight: 100 },
  cdSub: { ...stType.body, textAlign: 'center', marginTop: 6 },
  cdSafety: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10, paddingHorizontal: 10, paddingVertical: 6, borderLeftWidth: 3, borderLeftColor: ST.objective, backgroundColor: withAlpha(ST.objective, 0.12) },
  cdSafetyText: { ...stType.small, color: ST.text, flexShrink: 1 },

  transit: { zIndex: 40, elevation: 40, backgroundColor: ST.ground },
  transitHead: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  transitIcon: { width: 52, height: 52, borderRadius: ST.radius, borderWidth: 1, borderColor: ST.objective, backgroundColor: withAlpha(ST.objective, 0.12), alignItems: 'center', justifyContent: 'center' },
  transitMap: { height: 220, borderRadius: ST.radius, overflow: 'hidden', marginTop: 14, backgroundColor: ST.ground2, borderWidth: 1, borderColor: ST.line },

  mapRoot: { zIndex: 50, elevation: 50 },
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.6)' },
  mapPanelWrap: { flex: 1, justifyContent: 'center', paddingHorizontal: 12 },
  mapPanel: { backgroundColor: ST.panelStrong, borderRadius: ST.radius, padding: 14, borderWidth: 1, borderColor: ST.line },
  mapHead: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 10 },
  close: { width: 40, height: 40, borderRadius: ST.radius, borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center' },
  bigMap: { height: 400, borderRadius: ST.radius, overflow: 'hidden', backgroundColor: ST.ground2, borderWidth: 1, borderColor: ST.line },
  legend: { ...stType.small, fontSize: 11, marginTop: 8, textAlign: 'center' },

  specShade: { position: 'absolute', left: 0, right: 0, top: 0 },
  specTop: { position: 'absolute', left: 16, right: 16, alignItems: 'center', gap: 4 },
  specPlace: { ...stType.num, fontSize: 40, lineHeight: 44, letterSpacing: 1 },
  specOf: { fontFamily: FONT.displaySemi, fontSize: 18, color: ST.muted },
  byCard: { flexDirection: 'row', alignItems: 'center', gap: 10, alignSelf: 'stretch', marginTop: 6, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: ST.panelStrong, borderLeftWidth: 3, borderLeftColor: ST.enemy },
  specBottom: { position: 'absolute', left: 16, right: 16 },
  specCard: { flexDirection: 'row', alignItems: 'center', padding: 10, borderRadius: ST.radius, backgroundColor: ST.panelStrong, borderTopWidth: 2, borderTopColor: ST.friendly },
  specArrow: { width: 40, height: 40, borderRadius: ST.radius, borderWidth: 1, borderColor: ST.lineStrong, alignItems: 'center', justifyContent: 'center' },

  resTint: { position: 'absolute', left: 0, right: 0, top: 0 },
  resHead: { alignItems: 'center', gap: 4 },
  tiles: { flexDirection: 'row', gap: 6, marginTop: 20 },
  tile: { ...panel, flex: 1, paddingHorizontal: 8, paddingVertical: 10, gap: 2, minWidth: 0 },
  tileNum: { ...stType.num, fontSize: 20 },
  mvp: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 12, paddingHorizontal: 14, paddingVertical: 12, borderWidth: 1, borderColor: ST.objective, backgroundColor: withAlpha(ST.objective, 0.08), borderRadius: ST.radius },
  rankHead: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingBottom: 6, borderBottomWidth: 1, borderBottomColor: ST.line },
  rankHeadText: { fontFamily: FONT.ui, fontSize: 10, letterSpacing: 1.4, color: ST.muted },
  rankRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 9, paddingHorizontal: 8, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.07)' },
  rankMe: { backgroundColor: withAlpha(ST.friendly, 0.12), borderLeftWidth: 3, borderLeftColor: ST.friendly },
  rankPos: { width: 34, fontFamily: FONT.displaySemi, fontSize: 13, color: ST.muted },
  rankName: { fontFamily: FONT.ui, fontSize: 15, color: ST.text },
  rankCause: { fontFamily: FONT.uiMedium, fontSize: 11, color: ST.faint },
  rankKills: { width: 30, textAlign: 'center', ...stType.num, fontFamily: FONT.displaySemi, fontSize: 14 },
})
