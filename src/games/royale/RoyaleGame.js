// Battle Royale — real-world, up to 100 players, one life, a shrinking gas zone.
//
// Room phases: 'lobby' → RoyaleLobby; 'playing' → the match (state.phase countdown →
// playing → ended → results). The host is authoritative (engine.js): it builds the zone
// schedule, applies gas damage, validates hits/pickups and decides eliminations. Every
// phone shares its position (≤1/s), aims with the camera like Laser Tag (CombatView) and
// reports its own transit state; the host cross-checks transit from shared positions.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Animated, Pressable, StyleSheet, View } from 'react-native'
import { useArcadeInsets } from '../arcadeUI'
import { DOCK_GAP, TOP_BUTTONS_W, useHudMetrics, useMeasuredHeight } from '../laser/hudLayout'
import { setAudioModeAsync } from 'expo-audio'
import { useKeepAwake } from 'expo-keep-awake'
import { Ionicons } from '@expo/vector-icons'
import { ErrorBoundary } from '../../components/ErrorBoundary'
import { LocationGate, Spectating } from '../MultiplayerUI'
import { recordRoundResult, useHostLoop, useRoomClock, useRoomSnapshot } from '../../lib/multiplayer'
import { buzz, useGamePrefs } from '../../lib/gamePrefs'
import { ABSENT_ELIMINATE_MS, PICKUP_RANGE_M, ROYALE_AREAS, ROYALE_COLORS } from './constants'
import { applyAction, gpsSlack, initialState, newHostMem, pickCenter, tick } from './engine'
import { zoneAt, outsideBy } from './zone'
import { dirWord, directionToCircle, dist, formatDistance, formatMiles, bearingDeg, validPos } from './geo'
import { useAnnouncer, usePlayersRemainingCallout } from './announcer'
import { useRoyaleLocation, useThrottledPositions } from './useRoyaleLocation'
import { useTransit } from './useTransit'
import { CombatView } from './CombatView'
import { RoyaleLobby } from './RoyaleLobby'
import { RoyaleMap } from './RoyaleMap'
import {
  Banner, CountdownOverlay, Feed, Flash, MapPanel, PickupButton, ResultsView, SpectateView, StatusCard, TransitOverlay, WeaponSlots, ZonePill, fmtDuration,
} from './RoyaleHud'
import { RARITY_COLORS, START_WEAPON_IDS, getWeapon, playSfx, preloadSounds, releaseSounds } from './weaponsAdapter'
import { useUavControl } from '../laser/useUavControl'
import { EnemyUavPill, RadarSweep, UavButton, UavSheet } from '../laser/Uav'

// UAV in Battle Royale: reveals the nearest enemies inside the current safe zone.
const UAV_REVEAL_MAX = 5
const FIRE_W = 96 + 10 // CombatView's FIRE button + gap
const FIRE_RESERVE = 96 + 10 // portrait: FIRE sits above the dock, so the aim band ends above it

const POS_FRESH_MS = 15000
const PUBLISH_COALESCE_MS = 150

export function RoyaleGame({ room, onExit }) {
  const snap = useRoomSnapshot(room)
  if (!room || !snap) return null
  const inMatch = snap.info?.phase === 'playing'
  return (
    <ErrorBoundary screen="BattleRoyale">
      {inMatch ? <RoyaleMatch room={room} snap={snap} onExit={onExit} /> : <RoyaleLobby room={room} snap={snap} onExit={onExit} />}
    </ErrorBoundary>
  )
}

// Keeps the screen on during a match (expo-keep-awake ships with expo).
function KeepAwake() {
  useKeepAwake(undefined, { suppressDeactivateWarnings: true })
  return null
}

function RoyaleMatch({ room, snap, onExit }) {
  const insets = useArcadeInsets()
  const prefs = useGamePrefs()
  const hud = useHudMetrics(insets)
  const [topH, onTopLayout] = useMeasuredHeight()
  const [dockH, onDockLayout] = useMeasuredHeight()
  const now = useRoomClock(room, 1000)
  const positions = useThrottledPositions(room, 1000)
  const meId = snap.me?.id
  const isHost = !!snap.isHost
  const roundNo = snap.info?.round || 0
  const raw = snap.state
  const state = raw && raw.game === 'royale' && raw.round === roundNo && raw.p && typeof raw.p === 'object' ? raw : null
  const me = state?.p?.[meId] || null
  const playing = state?.phase === 'playing'
  const alive = !!me?.a
  const loc = useRoyaleLocation(room, { enabled: true, share: !state || state.phase !== 'ended' })
  const myPos = loc.coords
  const transit = useTransit(myPos, { enabled: !!state && state.phase !== 'ended' && (alive || !me) })
  const inTransit = alive && (transit.inTransit || me?.tr === 1)
  const { banner, announce } = useAnnouncer()
  const [flash, setFlash] = useState(null)
  const flashTimer = useRef(null)
  const [mapOpen, setMapOpen] = useState(false)
  const [weaponId, setWeaponId] = useState(START_WEAPON_IDS[0] || 'pistol')
  const [followId, setFollowId] = useState(null)
  const vignette = useRef(new Animated.Value(0)).current

  // ---- feedback helpers ----
  const showFlash = useCallback((text, good) => {
    setFlash({ text: String(text || ''), good: !!good })
    clearTimeout(flashTimer.current)
    flashTimer.current = setTimeout(() => setFlash(null), 1400)
  }, [])
  useEffect(() => () => clearTimeout(flashTimer.current), [])
  useEffect(() => {
    setAudioModeAsync({ playsInSilentMode: true, interruptionMode: 'mixWithOthers' }).catch(() => {})
    return () => releaseSounds()
  }, [])

  // ---- host ----
  const mem = useRef(newHostMem())
  const work = useRef(null) // host's latest computed state (published coalesced)
  const pubTimer = useRef(null)
  const locRef = useRef(null)
  locRef.current = myPos
  useEffect(() => {
    // New host or new match: start from what's been published.
    work.current = null
    mem.current = newHostMem()
  }, [isHost, roundNo])
  useEffect(() => () => clearTimeout(pubTimer.current), [])

  const posOf = (id) => {
    const p = room.freshPosition(id)
    return p && validPos(p) ? p : null
  }
  const current = () => {
    const s = work.current || room.getState()
    return s && s.game === 'royale' && s.round === (room.info.round || 0) ? s : null
  }
  const commit = (next, immediate) => {
    work.current = next
    if (immediate) {
      clearTimeout(pubTimer.current)
      pubTimer.current = null
      room.publishState(next)
      return
    }
    if (pubTimer.current) return
    pubTimer.current = setTimeout(() => {
      pubTimer.current = null
      if (work.current && room.isHost()) room.publishState(work.current)
    }, PUBLISH_COALESCE_MS)
  }
  useHostLoop(room, isHost, {
    onTick: () => {
      const t = room.now()
      const r = room.info.round || 0
      if (r <= 0) return
      const s = current()
      if (!s) {
        const center = pickCenter(room.info, room.positions?.[room.me.id] || locRef.current)
        if (!center) return // wait for the host's GPS
        commit(initialState({ roster: room.roster, info: room.info, now: t, center }), true)
        return
      }
      const next = tick(s, { now: t, presentIds: room.presentIds(ABSENT_ELIMINATE_MS), posOf, mem: mem.current })
      if (next !== s) commit(next, next.phase !== s.phase)
    },
    onAction: (action, from) => {
      const s = current()
      if (!s) return
      const { state: next, reply } = applyAction(s, action, from, { now: room.now(), posOf, mem: mem.current })
      if (next !== s) commit(next, next.phase !== s.phase)
      if (reply) {
        if (from === room.me.id) room.emitter.emit(`msg:${reply.type}`, reply.data, from)
        else room.send(reply.type, reply.data, { to: from })
      }
    },
  }, 1000)

  // ---- messages for me ----
  useEffect(() => {
    const offs = [
      room.onMessage('hit_ok', (d) => {
        playSfx('hit')
        buzz(d?.killed ? 'success' : 'medium')
        const dmg = d?.dmg ? ` −${d.dmg}` : ''
        if (d?.killed) showFlash(`Eliminated ${String(d.name || '').slice(0, 24)}!`, true)
        else if (d?.zone === 'head') showFlash(`HEADSHOT${dmg}`, true)
        else showFlash(`Hit${dmg}`, true)
      }),
      room.onMessage('notice', (d) => showFlash(String(d?.text || ''), false)),
      room.onMessage('picked', (d) => {
        if (typeof d?.w === 'string') {
          setWeaponId(d.w)
          const w = getWeapon(d.w)
          playSfx('tap')
          buzz('success')
          showFlash(`${w.icon} Picked up ${w.name}`, true)
        }
      }),
    ]
    return () => offs.forEach((off) => off())
  }, [room, showFlash])

  // ---- transit: tell the host whenever it changes (and keep reminding while on) ----
  useEffect(() => {
    if (!state || !me) return undefined
    const sendIt = () => { try { room.sendAction({ type: 'tr', on: !!transit.inTransit }) } catch { /* offline */ } }
    sendIt()
    if (transit.inTransit) {
      buzz('warning')
      const t = setInterval(sendIt, 10000)
      return () => clearInterval(t)
    }
    return undefined
  }, [transit.inTransit, !!me, roundNo]) // eslint-disable-line react-hooks/exhaustive-deps

  // ---- inventory ----
  const inventory = useMemo(() => {
    const ids = [...START_WEAPON_IDS]
    if (me?.pri && !ids.includes(me.pri)) ids.push(me.pri)
    return ids
  }, [me?.pri])
  useEffect(() => {
    if (!inventory.includes(weaponId)) setWeaponId(me?.pri || inventory[0])
  }, [inventory, weaponId, me?.pri])
  useEffect(() => { preloadSounds(inventory) }, [inventory])
  const weapon = useMemo(() => getWeapon(weaponId), [weaponId])
  const selectWeapon = useCallback((id) => {
    setWeaponId(id)
    playSfx('empty')
    buzz('select')
  }, [])

  // ---- damage feedback ----
  const hp = me?.hp
  const prevHp = useRef(hp)
  useEffect(() => {
    if (typeof hp === 'number' && typeof prevHp.current === 'number' && hp < prevHp.current - 0.5) {
      const big = prevHp.current - hp >= 10
      if (big) { playSfx('hit'); buzz('heavy') } else buzz('light')
      vignette.setValue(hp <= 0 ? 0.85 : big ? 0.6 : 0.3)
      Animated.timing(vignette, { toValue: 0, duration: 700, useNativeDriver: true }).start()
    }
    prevHp.current = hp
  }, [hp, vignette])

  // ---- zone + callouts ----
  const zone = useMemo(() => (state?.z ? zoneAt(state.z, now) : null), [state?.z, now])
  const outside = zone && validPos(myPos) ? outsideBy(myPos, zone.current) - gpsSlack(myPos.acc) : -1
  const inGas = playing && alive && outside > 0
  const gasText = inGas
    ? `In the gas −${zone.dps}/s · safe zone ${formatDistance(Math.max(0, outside))} ${dirWord(bearingDeg(myPos, zone.current))}`
    : null

  const callRef = useRef({ phase: null, stage: null, warned60: null, gasAt: 0 })
  useEffect(() => {
    if (!zone || !playing) return
    const c = callRef.current
    const nextDir = zone.next && validPos(myPos) ? directionToCircle(myPos, zone.next) : null
    if (c.phase !== zone.phase && zone.stage === 'wait') {
      const first = c.phase == null
      c.phase = zone.phase
      c.stage = zone.stage
      if (zone.isFinal) announce('Final zone', { sub: 'Hold your ground — the zone closes completely soon', tone: 'danger' })
      else announce(nextDir ? `Next zone is ${formatMiles(nextDir.meters)} ${nextDir.dir}` : 'You’re inside the next zone', {
        sub: first ? `Gas closes in ${fmtDuration(zone.msToShrink)}` : `Phase ${zone.phase} of ${zone.phases}`,
        tone: 'info',
      })
      return
    }
    if (zone.stage === 'wait' && zone.msToShrink <= 60000 && zone.msToShrink > 50000 && c.warned60 !== zone.phase) {
      c.warned60 = zone.phase
      announce('Gas closing in 60 seconds', { sub: nextDir ? `Next zone is ${formatMiles(nextDir.meters)} ${nextDir.dir}` : 'You’re inside the next zone', tone: 'warn' })
      return
    }
    if (zone.stage === 'shrink' && c.stage !== 'shrink') {
      c.stage = 'shrink'
      announce(zone.isFinal ? 'The zone is collapsing!' : 'The gas is closing in!', { sub: nextDir ? `Head ${nextDir.dir} · ${formatMiles(nextDir.meters)}` : null, tone: 'danger' })
      return
    }
    if (zone.stage === 'wait') c.stage = 'wait'
    if (inGas && Date.now() - c.gasAt > 12000) {
      c.gasAt = Date.now()
      announce('You’re in the gas!', { sub: gasText, tone: 'danger', ms: 3500 })
    }
  }, [zone?.phase, zone?.stage, Math.floor((zone?.msToShrink || 0) / 5000), inGas, playing]) // eslint-disable-line react-hooks/exhaustive-deps

  // Match start / eliminated / win callouts.
  const prevAlive = useRef(null)
  useEffect(() => {
    if (!me) return
    if (prevAlive.current === true && !me.a && state?.phase !== 'ended') {
      announce(`Eliminated · #${me.pl}`, { sub: me.by === 'gas' ? 'The gas got you' : me.by && me.by !== 'left' && me.by !== 'signal' ? `By ${me.by}` : null, tone: 'danger' })
    }
    prevAlive.current = !!me.a
  }, [me?.a]) // eslint-disable-line react-hooks/exhaustive-deps

  // Record the result once.
  useEffect(() => {
    if (state?.phase !== 'ended' || !me) return
    const placement = me.pl || state.total || 0
    const score = (me.k || 0) * 100 + Math.max(0, (state.total || 0) - placement) * 10
    recordRoundResult(room, { result: state.winner === meId ? 'win' : 'loss', score })
    if (state.winner === meId) { playSfx('defused'); buzz('success') }
  }, [state?.phase]) // eslint-disable-line react-hooks/exhaustive-deps

  // ---- derived lists (positions re-render at most 1/s) ----
  const opponents = useMemo(() => {
    if (!state) return []
    const out = []
    const t = Date.now()
    for (const id of Object.keys(state.p)) {
      if (id === meId) continue
      const pl = state.p[id]
      if (!pl?.a || pl.tr) continue
      const p = positions?.[id]
      if (!p || t - p.at > POS_FRESH_MS || !validPos(p)) continue
      out.push({ id, name: pl.n, pos: { lat: p.lat, lng: p.lng, acc: p.acc } })
    }
    return out
  }, [state?.p, positions, meId]) // eslint-disable-line react-hooks/exhaustive-deps

  const aliveIds = useMemo(() => (state ? Object.keys(state.p).filter((id) => state.p[id]?.a && id !== meId) : []), [state?.p, meId]) // eslint-disable-line react-hooks/exhaustive-deps
  usePlayersRemainingCallout(aliveIds.length + (me?.a ? 1 : 0), announce, playing)
  const spectating = !!state && state.phase !== 'ended' && (!me || !me.a)
  useEffect(() => {
    if (!spectating) return
    if (!followId || !aliveIds.includes(followId)) setFollowId(aliveIds[0] || null)
  }, [spectating, aliveIds, followId])

  // ---- UAV: enemies stay off your map unless a UAV reveals them ----
  const [uavIds, setUavIds] = useState([])
  const uavCtx = useRef({})
  uavCtx.current = { state, meId, myPos, zone, positions }
  const pickRevealed = () => {
    try {
      const { state: s, meId: mine, myPos: mp, zone: z, positions: ps } = uavCtx.current
      if (!s?.p) return []
      const t = Date.now()
      const ring = z?.current
      const cands = []
      for (const id of Object.keys(s.p)) {
        if (id === mine || !s.p[id]?.a) continue
        const p = ps?.[id]
        if (!p || t - p.at > POS_FRESH_MS || !validPos(p)) continue
        if (ring && validPos(ring) && dist(p, ring) > ring.r) continue
        cands.push({ id, d: validPos(mp) ? dist(mp, p) : 0 })
      }
      return cands.sort((a, b) => a.d - b.d).slice(0, UAV_REVEAL_MAX).map((c) => c.id)
    } catch {
      return []
    }
  }
  const uav = useUavControl({
    room,
    matchKey: `${snap.code}:${roundNo}`,
    canUse: playing && alive && now >= (state?.startsAt || 0),
    alert: (a) => announce(a.title, { sub: a.sub, tone: a.title.startsWith('Enemy') ? 'danger' : 'info', ms: 3000 }),
    payload: () => {
      const ids = pickRevealed()
      setUavIds(ids)
      return { ids }
    },
    classify: (from, d) => (Array.isArray(d?.ids) && d.ids.includes(uavCtx.current.meId) ? 'enemy' : null),
  })

  const mapPlayers = useMemo(() => {
    if (!state) return []
    const revealed = uav.uavActive ? new Set(uavIds) : null
    const out = []
    const t = Date.now()
    for (const id of Object.keys(state.p)) {
      if (id === meId) continue
      const pl = state.p[id]
      if (!pl?.a) continue
      if (!spectating && !(revealed && revealed.has(id))) continue // hidden unless a UAV is up
      const p = positions?.[id]
      if (!p || t - p.at > POS_FRESH_MS || !validPos(p)) continue
      const followed = spectating && id === followId
      out.push({ id, lat: p.lat, lng: p.lng, color: followed ? ROYALE_COLORS.follow : pl.tr ? '#9aa3c0' : ROYALE_COLORS.enemy, ring: followed })
    }
    return out
  }, [state?.p, positions, meId, spectating, followId, uav.uavActive, uavIds]) // eslint-disable-line react-hooks/exhaustive-deps

  const mapLoot = useMemo(() => (state?.loot || []).filter((l) => validPos(l)).map((l) => {
    const w = getWeapon(l.w)
    return { id: l.id, lat: l.lat, lng: l.lng, label: `${w.icon} ${w.short}`, color: RARITY_COLORS[w.rarity] }
  }), [state?.loot])

  // Zone circles for the map: only change when the rounded radius moves (fewer native updates).
  const mapZone = useMemo(() => {
    if (!zone) return null
    const r5 = (c) => (c ? { lat: Math.round(c.lat * 1e5) / 1e5, lng: Math.round(c.lng * 1e5) / 1e5, r: Math.max(1, Math.round(c.r / 5) * 5) } : null)
    return { current: r5(zone.current), next: r5(zone.next) }
  }, [zone && Math.round(zone.current.r / 5), zone?.phase]) // eslint-disable-line react-hooks/exhaustive-deps

  const nearLoot = useMemo(() => {
    if (!playing || !alive || inTransit || !validPos(myPos)) return null
    let best = null
    for (const l of state?.loot || []) {
      const d = dist(myPos, l)
      if (d <= PICKUP_RANGE_M + gpsSlack(myPos.acc) && (!best || d < best.d)) best = { ...l, d }
    }
    if (best && best.w === me?.pri) return null
    return best
  }, [state?.loot, myPos, playing, alive, inTransit, me?.pri]) // eslint-disable-line react-hooks/exhaustive-deps
  const pick = useCallback((item) => {
    buzz('medium')
    try { room.sendAction({ type: 'pick', id: item.id }) } catch { /* offline */ }
  }, [room])

  const myCoarse = useMemo(
    () => (validPos(myPos) ? { lat: Math.round(myPos.lat * 1e5) / 1e5, lng: Math.round(myPos.lng * 1e5) / 1e5, acc: myPos.acc } : null),
    [myPos && Math.round(myPos.lat * 1e5), myPos && Math.round(myPos.lng * 1e5)], // eslint-disable-line react-hooks/exhaustive-deps
  )

  const shotsRef = useRef(0)
  const onShot = useCallback((n) => { shotsRef.current += n || 1 }, [])
  const canFire = playing && alive && !inTransit && !mapOpen && !uav.sheetOpen && now >= (state?.startsAt || 0)

  // ---- render ----
  if (loc.status !== 'granted') return <LocationGate status={loc.status} onExit={onExit} what="Battle Royale" />
  if (!state) return <Spectating text="Starting the match… waiting for the host’s GPS fix." />

  if (state.phase === 'ended') {
    return (
      <ResultsView
        insets={insets}
        state={state}
        meId={meId}
        isHost={isHost}
        onLobby={() => { buzz('medium'); room.setInfo({ phase: 'lobby' }) }}
        onLeave={onExit}
      />
    )
  }

  const totalAlive = state.alive || 0
  const total = state.total || 0
  const areaLabel = ROYALE_AREAS[state.area?.id]?.label

  if (spectating) {
    const f = followId ? state.p[followId] : null
    const fp = followId ? positions?.[followId] : null
    const cycle = (dir) => {
      if (!aliveIds.length) return
      const i = Math.max(0, aliveIds.indexOf(followId))
      setFollowId(aliveIds[(i + dir + aliveIds.length) % aliveIds.length])
      buzz('select')
    }
    const survived = me ? (me.el || now) - state.startsAt : 0
    return (
      <View style={styles.fill}>
        <KeepAwake />
        <SpectateView
          insets={insets}
          followName={f?.n}
          followHp={f?.hp || 0}
          followKills={f?.k || 0}
          canCycle={aliveIds.length > 1}
          onPrev={() => cycle(-1)}
          onNext={() => cycle(1)}
          myLine={me ? `#${me.pl} · ${me.k || 0} kills · ${fmtDuration(survived)}` : 'joined late'}
          mapProps={{ me: null, focus: fp && validPos(fp) ? { id: followId, lat: fp.lat, lng: fp.lng } : null, zone: mapZone, players: mapPlayers, loot: mapLoot, rangeM: 250, sizePx: 400 }}
          zone={zone}
          alive={totalAlive}
          total={total}
          feed={state.feed}
          onLeave={onExit}
        />
        <Banner banner={banner} top={insets.top + 200} />
      </View>
    )
  }

  const leftHanded = prefs.handed === 'left'
  const side = leftHanded ? 'right' : 'left'
  const otherSide = leftHanded ? 'left' : 'right'
  const countdown = now < state.startsAt
  const mapProps = { me: myCoarse, focus: myCoarse, zone: mapZone, players: mapPlayers, loot: mapLoot }
  // Free band between the top rows and the bottom dock (measured).
  const bandTop = (topH ? hud.top + topH : hud.top + 130) + 8
  const bandBottom = hud.bottom + (dockH || 200) + 10
  const miniLegal = { top: 0, left: Math.max(0, Math.round(hud.mapSize / 2 - 34)), right: 0, bottom: Math.round(hud.mapSize * 0.07) }

  return (
    <View style={styles.fill}>
      <KeepAwake />
      <CombatView
        room={room}
        weapon={weapon}
        myPos={myCoarse}
        opponents={opponents}
        canFire={canFire}
        cameraOn={!inTransit}
        onFlash={showFlash}
        onShot={onShot}
        centerTop={bandTop}
        centerBottom={hud.landscape ? bandBottom : bandBottom + FIRE_RESERVE}
        fireButtonStyle={hud.landscape ? { [otherSide]: hud.side + 150, bottom: hud.bottom } : { [otherSide]: hud.side, bottom: bandBottom }}
      />
      <Animated.View pointerEvents="none" style={[styles.vignette, { opacity: vignette }]} />
      {inGas && <View pointerEvents="none" style={styles.gasTint} />}

      {/* Top rows (laser/hudLayout.js): status | GamePlayScreen buttons, then zone, then feed. */}
      <View style={[styles.topCol, { top: hud.top, left: hud.side, right: hud.side }]} pointerEvents="none" onLayout={onTopLayout}>
        <View style={[styles.topRow, { marginRight: TOP_BUTTONS_W - 12, alignSelf: leftHanded ? 'flex-end' : 'flex-start' }]}>
          <StatusCard hp={me?.hp ?? 0} alive={totalAlive} total={total} kills={me?.k || 0} />
        </View>
        <ZonePill zone={zone} gasText={gasText} />
        <Feed feed={state.feed} style={{ position: 'relative', alignSelf: leftHanded ? 'flex-end' : 'flex-start' }} />
      </View>
      <Banner banner={banner} top={bandTop} />
      <EnemyUavPill msLeft={uav.enemyMs} top={bandTop + (banner ? 64 : 0)} />
      <Flash flash={flash} />

      {/* Above the dock: pickup (kept clear of the FIRE button's column). */}
      <View style={[styles.pickDock, { bottom: bandBottom, left: hud.side + (leftHanded && !hud.landscape ? FIRE_W : 0), right: hud.side + (!leftHanded && !hud.landscape ? FIRE_W : 0) }]} pointerEvents="box-none">
        <PickupButton item={nearLoot} onPick={pick} />
      </View>

      {/* Bottom dock: UAV above the minimap on one side, weapon slots on the other. */}
      <View style={[styles.dock, { bottom: hud.bottom, left: hud.side, right: hud.side, flexDirection: leftHanded ? 'row-reverse' : 'row' }]} pointerEvents="box-none" onLayout={onDockLayout}>
        <View style={{ gap: DOCK_GAP, alignItems: leftHanded ? 'flex-end' : 'flex-start' }} pointerEvents="box-none">
          <UavButton count={uav.count} activeMsLeft={uav.myMs} disabled={!(playing && alive) && !uav.empty} onPress={uav.callUav} size={hud.compact ? 48 : 54} />
          <Pressable
            onPress={() => { buzz('select'); setMapOpen(true) }}
            style={[styles.mini, { width: hud.mapSize, height: hud.mapSize, borderRadius: hud.mapSize / 2 }]}
            accessibilityRole="button"
            accessibilityLabel="Open the map"
          >
            <RoyaleMap {...mapProps} rangeM={300} sizePx={hud.mapSize} style={StyleSheet.absoluteFill} legalLabelInsets={miniLegal} />
            {uav.uavActive ? <RadarSweep size={hud.mapSize} /> : <View style={[styles.miniRim, { borderRadius: hud.mapSize / 2 }]} pointerEvents="none" />}
            <View style={styles.miniTag} pointerEvents="none"><Ionicons name="expand" size={10} color="#fff" /></View>
          </Pressable>
        </View>
        <View style={{ alignItems: leftHanded ? 'flex-start' : 'flex-end', maxWidth: hud.chipMaxW }} pointerEvents="box-none">
          <WeaponSlots ids={inventory} current={weaponId} onSelect={selectWeapon} disabled={!alive} />
        </View>
      </View>

      {countdown && <CountdownOverlay msLeft={state.startsAt - now} areaLabel={areaLabel} />}

      {inTransit && (
        <TransitOverlay
          insets={insets}
          mph={transit.mph}
          hp={me?.hp ?? 0}
          zone={zone}
          gasText={gasText}
          feed={state.feed}
          alive={totalAlive}
          total={total}
          mapProps={{ ...mapProps, rangeM: Math.max(400, Math.round(((zone?.current?.r || 800) * 1.1) / 100) * 100), sizePx: 340 }}
        />
      )}

      <MapPanel
        visible={mapOpen && !inTransit}
        onClose={() => setMapOpen(false)}
        insets={insets}
        zone={zone}
        mapProps={{ ...mapProps, rangeM: Math.max(300, Math.round(((zone?.current?.r || 800) * 1.15) / 100) * 100), sizePx: 360 }}
        legend={uav.uavActive ? 'UAV online · red: nearest enemies in the zone · tags: weapons' : 'Solid ring: safe zone · dashed: next zone · enemies hidden (use a UAV) · tags: weapons'}
      />
      <UavSheet
        visible={uav.sheetOpen}
        onClose={() => uav.setSheetOpen(false)}
        balance={uav.inv.balance}
        owner={uav.inv.owner}
        freeLeft={uav.freeLeft}
        insets={insets}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: '#000', overflow: 'hidden' },
  vignette: { ...StyleSheet.absoluteFillObject, borderWidth: 40, borderColor: 'rgba(224,79,79,0.7)', backgroundColor: 'rgba(224,79,79,0.18)' },
  gasTint: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(140,60,255,0.18)', borderWidth: 6, borderColor: 'rgba(161,77,255,0.6)' },
  topCol: { position: 'absolute', gap: 6 },
  topRow: { maxWidth: 220 },
  dock: { position: 'absolute', alignItems: 'flex-end', justifyContent: 'space-between' },
  mini: { overflow: 'hidden', backgroundColor: '#141826' },
  miniRim: { ...StyleSheet.absoluteFillObject, borderWidth: 2, borderColor: 'rgba(255,255,255,0.55)' },
  miniTag: { position: 'absolute', top: 18, alignSelf: 'center', paddingHorizontal: 5, paddingVertical: 2, borderRadius: 6, backgroundColor: 'rgba(0,0,0,0.5)' },
  pickDock: { position: 'absolute', alignItems: 'center' },
})

export default RoyaleGame
