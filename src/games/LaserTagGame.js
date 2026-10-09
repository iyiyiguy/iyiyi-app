// Laser Tag — camera-first, raise-and-shoot.
//
// The live back camera fills the screen the whole time. Fire modes switch automatically
// with how the phone is held (see laser/useAim.js), or can be forced in the menu:
//   • Trigger (portrait): camera aim, the whole screen is the trigger.
//   • Top edge (landscape / flat): point the top of the phone, tap anywhere.
//   • Camera: crosshair + FIRE button.
// Map intel: enemies are hidden on the minimap / big map. An enemy who fires shows as a
// red ping for ~3s; a UAV (laser/Uav.js, lib/uav.js) reveals every enemy for 15s.
// Bystanders: opted-in iYiYi users who aren't in the match get a teal "iYiYi user" emblem
// on camera and can be tagged for fewer points (lib/bystanderTags.js, laser/Bystander.js).
// Weapons (guns.js): unlimited ammo; semi-auto fires once per tap with no rate cap,
// automatic fires continuously while held (useTrigger). Your phone decides who is in
// your sights; the host validates hits and runs the rules (laser/engine.js).
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { CameraView } from 'expo-camera'
import { CameraOff, useCameraGate } from '../components/CameraGate'
import { setAudioModeAsync } from 'expo-audio'
import { Btn, LocationGate, Spectating, formatClock } from './MultiplayerUI'
import { CountdownOverlay, MatchSummary, RoundBreak, hudShadow } from './laser/Hud'
import {
  AlertBanner, BigActionButton, BombCountdown, EnemyMarkers, ScoreboardOverlay, TapMiniGame, WeaponChip, WeaponWheel,
} from './laser/HudExtras'
import { DEFAULT_MAP_RANGE, MapMinimap, MapOverlay, allowedRanges, rangeById } from './laser/MapMinimap'
import { AIM_MODE_LABELS, useAim } from './laser/useAim'
import * as engine from './laser/engine'
import { classifyHit, photoRectToScreen, pickVisionTarget, useVisionCapture, visionAvailable, zoneDamage, VISION_RANGE_M } from './laser/vision'
import {
  TEAMS, angleDiff, bearingDeg, compassLabel, distanceMeters, formatDistance, recordRoundResult,
  useHostLoop, useRoomClock, useRoomPositions, useRoomSnapshot, useSharedLocation,
} from '../lib/multiplayer'
import { buzz, useGamePrefs } from '../lib/gamePrefs'
import {
  FREE_GUN_IDS, getEquippedGun, getLoadout, getWeapon, playShot, playSfx, preloadWeaponSounds, releaseWeaponSounds, setEquippedGun, useTrigger,
} from '../lib/guns'
import { recordGameResult } from '../lib/arcadeStats'
import { useUavControl } from './laser/useUavControl'
import { EnemyUavPill, UavButton, UavSheet } from './laser/Uav'
import { SHOT_BROADCAST_MIN_MS, isEnemy, useEnemyIntel } from './laser/intel'
import { BYSTANDER_COOLDOWN_MS, pickBystander, recordBystanderTag, useNearbyTaggable } from '../lib/bystanderTags'
import { sendBystanderTag } from '../lib/invites'
import { BystanderMarkers, useTaggablePrompt } from './laser/Bystander'
import { colors, radii, type } from '../theme'
import { useArcadeInsets } from './arcadeUI'
import { DOCK_GAP, TOP_BUTTONS_W, useHudMetrics, useMeasuredHeight } from './laser/hudLayout'
import { BINOCULAR_MAX_ZOOM, formatZoom, maxZoomFor, useScopeZoom } from './laser/useScopeZoom'
import { BinocularFrame, BinocularMarkers, binocularMarkers } from './laser/Binoculars'
import { GRENADE_FUSE_MS, GrenadeBlast, GrenadeButton, destinationPoint } from './laser/Grenade'
import GunViewModel from './laser/GunViewModel'
import { spendGrenade, useGrenadeInventory } from '../lib/grenades'

function normalizeGun(g) {
  const gun = g || getWeapon('pistol')
  const automatic = gun.fireMode === 'automatic'
  return {
    id: gun.id,
    name: gun.name,
    icon: gun.icon,
    sound: gun.sound,
    fireMode: gun.fireMode,
    automatic,
    shotsPerClick: automatic ? 1 : Math.max(1, Math.min(5, gun.shotsPerClick || 1)),
    fireRate: Math.max(0.25, Math.min(15, gun.fireRate || 1)),
    autoRateScale: gun.autoRateScale,
    fixedAutoRate: gun.fixedAutoRate,
    accuracy: Math.max(-30, Math.min(40, gun.accuracy || 0)),
    damage: Math.max(5, Math.min(100, gun.damage || 33)),
    damageMultiplier: Math.max(0.3, Math.min(3, gun.damageMultiplier || 1)),
    range: gun.range || 60,
  }
}

// Compass aim can't see walls or cover, so it only reaches this far (camera aim uses the gun's range).
const COMPASS_MAX_RANGE_M = 40

// Compass calibration level (0-3) → extra degrees of slack.
const COMPASS_SLACK = { 3: 4, 2: 8, 1: 12, 0: 15 }

// Half-angle (degrees) within which a player counts as "in your sights". GPS
// error matters more up close, so the window widens as distance shrinks.
function aimTolerance(d, myAcc, theirAcc, headingAcc) {
  const err = Math.min(30, Math.max(3, Math.hypot(myAcc ?? 10, theirAcc ?? 10)))
  const deg = (Math.atan2(err * 0.6 + 0.5, Math.max(d, 1)) * 180) / Math.PI
  return Math.min(35, Math.max(3, deg) + (COMPASS_SLACK[headingAcc] ?? 10))
}

function hitChance(d, gun, offCenter) {
  const base = d <= 10 ? 0.9 : d <= 25 ? 0.75 : d <= 45 ? 0.6 : d <= 70 ? 0.45 : 0.3
  const p = (base + gun.accuracy / 100) * (1 - 0.35 * Math.min(1, offCenter))
  return Math.max(0.05, Math.min(0.95, p))
}

const FREE_LOADOUT = FREE_GUN_IDS.map((id) => getWeapon(id))
const HOST_HIT_MIN_MS = 55 // per-player spam guard on the host (autos fire up to 12/s; semi-auto has no client cap)

// The player's loadout (owned guns + free SMG) and the active weapon; switching persists
// the choice as the equipped gun.
function useLoadout() {
  const [loadout, setLoadout] = useState(FREE_LOADOUT)
  const [weaponId, setWeaponId] = useState('pistol')
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const [list, eq] = await Promise.all([getLoadout(), getEquippedGun()])
        if (cancelled) return
        const l = list?.length ? list : FREE_LOADOUT
        setLoadout(l)
        setWeaponId(l.some((w) => w.id === eq?.id) ? eq.id : l[0].id)
        preloadWeaponSounds(l.map((w) => w.id), ['hit', 'tap', 'planted', 'beep', 'defused', 'explosion'])
      } catch {
        // Free loadout is fine.
      }
    })()
    return () => { cancelled = true }
  }, [])
  const select = useCallback((id) => {
    setWeaponId(id)
    setEquippedGun(id).catch(() => {})
  }, [])
  return { loadout, weaponId, select }
}

export function LaserTagGame({ room, onExit }) {
  const insets = useArcadeInsets()
  const snap = useRoomSnapshot(room)
  const positions = useRoomPositions(room)
  const now = useRoomClock(room, 250)
  const loc = useSharedLocation(room)
  const prefs = useGamePrefs()
  const hud = useHudMetrics(insets, { minimap: prefs.minimap !== false })
  const [topH, onTopLayout] = useMeasuredHeight()
  const [dockH, onDockLayout] = useMeasuredHeight()
  const aim = useAim({ enabled: loc.status === 'granted', override: prefs.aimMode })
  const { loadout, weaponId, select: selectWeapon } = useLoadout()
  const gun = useMemo(() => normalizeGun(getWeapon(weaponId)), [weaponId])
  const [camPerm] = useCameraGate()
  const [marker, setMarker] = useState(null)
  const [shotsBy, setShotsBy] = useState({})
  const [wheelOpen, setWheelOpen] = useState(false)
  const [scoresOpen, setScoresOpen] = useState(false)
  const [miniGame, setMiniGame] = useState(null) // { kind: 'plant'|'defuse', site?, key }
  const [actLost, setActLost] = useState(0)
  const [alert, setAlert] = useState(null)
  const markerTimer = useRef(null)
  const alertTimer = useRef(null)
  const lastShotByPlayer = useRef({})
  const shotsRef = useRef(0)
  const cameraRef = useRef(null)
  const vision = useVisionCapture(cameraRef)
  const [bodies, setBodies] = useState(null) // latest target-lock detections
  const [view, setView] = useState({ width: 0, height: 0 })
  // Scope zoom (pinch or the zoom button). Precision guns (sniper, DMR, railgun) go to 4×.
  // Binoculars: look up to 8× with GPS name tags on every enemy; shooting is off while they're up.
  const [bino, setBino] = useState(false)
  const scope = useScopeZoom(bino ? BINOCULAR_MAX_ZOOM : maxZoomFor(getWeapon(weaponId)), { enabled: !!camPerm?.granted, onChange: () => buzz('select') })
  const toggleBino = () => {
    buzz('select')
    setBino((b) => !b)
  }
  // Runs after the zoom limit has switched (8× for binoculars, the gun's own limit after).
  useEffect(() => { scope.setZoom(bino ? 4 : 1) }, [bino]) // eslint-disable-line react-hooks/exhaustive-deps
  const vignette = useRef(new Animated.Value(0)).current

  const meId = snap?.me?.id
  const isHost = !!snap?.isHost
  const state = snap?.state?.game === 'lasertag' ? snap.state : null
  const myState = state?.players?.[meId]
  const myTeam = myState?.team || null
  const playing = state?.phase === 'playing' && now >= (state?.startsAt || 0)
  const dead = !!myState && !myState.alive
  const leftHanded = prefs.handed === 'left'
  // Camera (body-hit) aiming works in both upright modes: classic crosshair + FIRE, and trigger.
  const visionAim = visionAvailable && !!camPerm?.granted && (aim.mode === 'camera' || aim.mode === 'trigger')
  const isProtected = (myState?.protectedUntil || 0) > now
  const snd = state?.mode === 'snd' ? state.snd : null

  useEffect(() => {
    setAudioModeAsync({ playsInSilentMode: true, interruptionMode: 'mixWithOthers' }).catch(() => {})
    return () => releaseWeaponSounds()
  }, [])

  // ---- grenades + first-person gun ----
  const grenadeInv = useGrenadeInventory()
  const [shotTick, setShotTick] = useState(0)
  const [blastKey, setBlastKey] = useState(0)
  const grenadeTimers = useRef([])
  useEffect(() => () => grenadeTimers.current.forEach(clearTimeout), [])

  const flash = useCallback((text, good) => {
    setMarker({ text, good })
    clearTimeout(markerTimer.current)
    markerTimer.current = setTimeout(() => setMarker(null), 1400)
  }, [])
  const showAlert = useCallback((a, ms = 3500) => {
    setAlert({ ...a, key: Date.now() })
    clearTimeout(alertTimer.current)
    alertTimer.current = setTimeout(() => setAlert(null), ms)
  }, [])
  useEffect(() => () => {
    clearTimeout(markerTimer.current)
    clearTimeout(alertTimer.current)
  }, [])

  // ---- UAV (shared with Battle Royale: laser/useUavControl.js) ----
  const triggerRef = useRef(null)
  const uavStateRef = useRef({})
  uavStateRef.current = { state, meId, myTeam }
  const uav = useUavControl({
    room,
    matchKey: `${snap?.code}:${snap?.info?.round}`,
    canUse: playing,
    alert: showAlert,
    onBeforeCall: () => triggerRef.current?.stop(),
    payload: () => ({ name: uavStateRef.current.state?.players?.[uavStateRef.current.meId]?.name || null }),
    classify: (from) => {
      const { state: s, meId: me, myTeam: team } = uavStateRef.current
      if (!s?.players?.[from] || from === me) return null
      return isEnemy(s, me, team, from) ? 'enemy' : 'team'
    },
  })
  const uavActive = uav.uavActive
  const overlayOpen = wheelOpen || scoresOpen || !!miniGame || uav.sheetOpen

  // New round/match: fresh shot counter, close round-specific overlays.
  const roundKey = `${state?.round}:${state?.snd?.roundNo ?? 0}`
  useEffect(() => {
    if (state?.snd?.roundNo == null || state.snd.roundNo === 1) shotsRef.current = 0
    setMiniGame(null)
  }, [roundKey]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!room) return undefined
    const offs = [
      room.onMessage('hit_ok', (d) => {
        playSfx('hit')
        buzz(d?.killed ? 'success' : 'medium')
        const dmg = d?.damage ? ` −${d.damage}` : ''
        if (d?.killed) flash(`${d.zone === 'head' ? '🎯 ' : ''}Tagged out ${d.name}!`, true)
        else if (d?.zone === 'head') flash(`🎯 HEADSHOT${dmg}`, true)
        else flash(`✕ ${d?.zone === 'limb' ? 'Limb' : 'Hit'}${dmg}`, true)
      }),
      room.onMessage('notice', (d) => flash(String(d?.text || ''), false)),
      room.onMessage('grenade_ok', (d) => {
        const hits = Array.isArray(d?.hits) ? d.hits : []
        const kills = hits.filter((h) => h.killed)
        if (!hits.length) { flash('💥 Grenade missed', false); return }
        playSfx('hit')
        buzz('success')
        if (kills.length) flash(`💥 Grenade tagged out ${kills.map((k) => k.name).join(', ')}!`, true)
        else flash(`💥 Grenade hit ${hits.map((h) => `${h.name} −${h.damage}`).join(', ')}`, true)
      }),
      room.onMessage('got_hit', (d) => {
        const by = String(d?.by || 'Someone').slice(0, 24)
        const dmg = d?.damage ? ` −${d.damage}` : ''
        if (d?.zone === 'grenade') { playSfx('explosion'); setBlastKey(Date.now()) }
        if (d?.killed) flash(`💀 Tagged out by ${by}${d?.zone === 'grenade' ? '’s grenade' : ''}`, false)
        else flash(`${d?.zone === 'head' ? '🎯 Headshot' : d?.zone === 'grenade' ? '💥 Grenade' : 'Hit'} by ${by}${dmg}`, false)
      }),
      room.onMessage('bystander_ok', (d) => {
        try {
          const userId = typeof d?.userId === 'string' ? d.userId : null
          if (!userId) return
          playSfx('hit')
          buzz('success')
          flash(`🎯 Tagged iYiYi user @${String(d.username || 'iyiyi').slice(0, 24)} +${d.points || engine.BYSTANDER_POINTS}`, true)
          const { fromName, code } = btCtx.current
          // Stored row first (missed-alert inbox), then the live alert carrying its id.
          recordBystanderTag({ targetId: userId, fromName, code })
            .then((tagId) => sendBystanderTag(userId, { fromName, gameId: 'lasertag', code, tagId }))
            .catch(() => {})
        } catch {
          // Never break the match over an alert.
        }
      }),
      room.onMessage('mystats', (d, from) => {
        if (d && typeof d.shots === 'number') setShotsBy((m) => ({ ...m, [from]: d.shots }))
      }),
    ]
    return () => offs.forEach((off) => off())
  }, [room, flash])

  // Feedback when I take damage: thud + rumble (each respects its own setting).
  const myHp = myState?.hp
  const prevHp = useRef(myHp)
  useEffect(() => {
    if (typeof myHp === 'number' && typeof prevHp.current === 'number' && myHp < prevHp.current) {
      playSfx('hit')
      buzz('heavy')
      const t1 = setTimeout(() => buzz('heavy'), 120)
      const t2 = setTimeout(() => buzz(myHp <= 0 ? 'error' : 'heavy'), 260)
      vignette.setValue(myHp <= 0 ? 0.85 : 0.6)
      Animated.timing(vignette, { toValue: 0, duration: 700, useNativeDriver: true }).start()
      prevHp.current = myHp
      return () => { clearTimeout(t1); clearTimeout(t2) }
    }
    prevHp.current = myHp
  }, [myHp, vignette])

  // Match over: share my shot count (for accuracy) and record the result.
  useEffect(() => {
    if (state?.phase !== 'ended' || !myState) return
    setShotsBy((m) => ({ ...m, [meId]: shotsRef.current }))
    room.send('mystats', { shots: shotsRef.current })
    const result = state.mode === 'ffa'
      ? (state.winners?.includes(meId) ? 'win' : 'loss')
      : (!state.winnerTeam ? 'draw' : state.winnerTeam === myTeam ? 'win' : 'loss')
    recordRoundResult(room, { result, score: myState.score })
  }, [state?.phase]) // eslint-disable-line react-hooks/exhaustive-deps

  // Public arena: there is no final whistle, so bank the score when leaving.
  const arenaScoreRef = useRef(null)
  arenaScoreRef.current = state?.endless && myState ? { score: myState.score || 0, kills: myState.kills || 0 } : arenaScoreRef.current
  useEffect(() => () => {
    const a = arenaScoreRef.current
    if (!a || a.score <= 0) return
    const points = Math.min(80, Math.max(5, Math.floor(a.score / 20)))
    Promise.resolve()
      .then(() => recordGameResult('laser-tag', { score: a.score, points }))
      .catch(() => {})
  }, [])

  // ---- S&D: bomb events for everyone (banner + sound), countdown beeps ----
  const bombState = snd?.bomb?.state || null
  const bombEventKey = snd ? `${state.round}:${snd.roundNo}:${bombState}` : null
  const prevBombKey = useRef(bombEventKey)
  useEffect(() => {
    if (!snd || bombEventKey === prevBombKey.current) { prevBombKey.current = bombEventKey; return }
    prevBombKey.current = bombEventKey
    const attacker = myTeam === engine.attackingTeam(state)
    if (bombState === 'planted') {
      playSfx('planted')
      buzz('warning')
      showAlert({ title: `Bomb planted at site ${snd.bomb.site}`, sub: attacker ? 'Bomb is active — defend the bomb' : 'Find the bomb and defuse it!', color: '#d4202f' }, 4500)
      setMiniGame((g) => (g?.kind === 'plant' ? null : g))
    } else if (bombState === 'defused') {
      playSfx('defused')
      buzz('success')
      showAlert({ title: 'Bomb defused', sub: attacker ? 'They stopped the bomb' : 'Nice work!', color: '#1f9d6b' })
      setMiniGame(null)
    } else if (bombState === 'exploded') {
      playSfx('explosion')
      buzz('heavy')
      showAlert({ title: '💥 The bomb exploded', color: '#d4202f' })
      setMiniGame(null)
    }
  }, [bombEventKey]) // eslint-disable-line react-hooks/exhaustive-deps

  const bombSecs = bombState === 'planted' ? Math.max(0, Math.ceil(((snd?.bomb?.explodesAt || now) - now) / 1000)) : null
  useEffect(() => {
    if (bombSecs == null || bombSecs <= 0) return
    if (bombSecs <= 10 || bombSecs % 5 === 0) playSfx('beep', { volume: bombSecs <= 10 ? 1 : 0.6 })
  }, [bombSecs])

  // The host dropped my plant/defuse (e.g. I was hit) while the mini-game is running.
  const myActive = snd?.act?.by === meId
  const sawAct = useRef(false)
  useEffect(() => {
    if (!miniGame) { sawAct.current = false; return }
    if (myActive) sawAct.current = true
    else if (sawAct.current) { sawAct.current = false; setActLost(Date.now()) }
  }, [myActive, miniGame])

  // ---- host ----
  const posOf = (id) => room.freshPosition(id)
  useHostLoop(room, isHost, {
    onTick: () => {
      const s = room.getState()
      const t = room.now()
      const roundNo = room.info.round || 0
      if (roundNo > 0 && (!s || s.game !== 'lasertag' || s.round !== roundNo)) {
        room.publishState(engine.initialState(room.roster, room.info, t))
        return
      }
      if (!s) return
      const presentIds = room.presentIds()
      const synced = engine.syncEndlessPlayers(s, room.roster, presentIds, t)
      const next = engine.tick(synced, { now: t, presentIds, posOf })
      if (next !== s) room.publishState(next)
    },
    onAction: (action, from) => {
      const s = room.getState()
      if (!s || s.game !== 'lasertag') return
      const t = room.now()
      if (action?.type === 'hit') {
        if (t - (lastShotByPlayer.current[from] || 0) < HOST_HIT_MIN_MS) return
        lastShotByPlayer.current[from] = t
      }
      const { state: next, reply } = engine.applyAction(s, action, from, { now: t, posOf })
      if (next !== s) room.publishState(next)
      // Tell the person who got hit who shot them (their phone already rumbles from the HP drop).
      if (action?.type === 'grenade' && reply?.type === 'grenade_ok') {
        for (const h of reply.data?.hits || []) {
          const victimMsg = { by: s.players?.[from]?.name || 'Someone', zone: 'grenade', damage: h.damage, killed: h.killed }
          if (h.id === meId) room.emitter.emit('msg:got_hit', victimMsg, from)
          else room.send('got_hit', victimMsg, { to: h.id })
        }
      }
      if (action?.type === 'hit' && reply?.type === 'hit_ok' && action.target) {
        const victimMsg = { by: s.players?.[from]?.name || 'Someone', zone: reply.data.zone, damage: reply.data.damage, killed: reply.data.killed }
        if (action.target === meId) room.emitter.emit('msg:got_hit', victimMsg, from)
        else room.send('got_hit', victimMsg, { to: action.target })
        // Rocket splash: notify everyone caught in the blast
        for (const sh of reply.data?.splash || []) {
          const splashMsg = { by: s.players?.[from]?.name || 'Someone', zone: 'rocket', damage: sh.damage, killed: sh.killed }
          if (sh.id === meId) room.emitter.emit('msg:got_hit', splashMsg, from)
          else room.send('got_hit', splashMsg, { to: sh.id })
        }
      }
      if (reply) {
        if (from === meId) room.emitter.emit(`msg:${reply.type}`, reply.data, meId)
        else room.send(reply.type, reply.data, { to: from })
      }
    },
  }, 300)

  // ---- aiming ----
  const myPos = loc.coords
  const heading = aim.heading
  const enemies = useMemo(() => {
    if (!state || !myPos) return []
    const out = []
    for (const id of Object.keys(state.players)) {
      if (id === meId) continue
      const pl = state.players[id]
      if (state.mode !== 'ffa' && pl.team === myTeam) continue
      const p = positions?.[id]
      if (!p || Date.now() - p.at > 15000) continue
      out.push({ id, ...pl, pos: p, d: distanceMeters(myPos, p), bearing: bearingDeg(myPos, p) })
    }
    return out
  }, [state, positions, myPos, meId, myTeam])

  const inSights = useMemo(() => {
    if (!heading || !myPos) return null
    let best = null
    for (const o of enemies) {
      if (!o.alive || o.d > (visionAim ? gun.range : Math.min(gun.range, COMPASS_MAX_RANGE_M))) continue
      const tol = aimTolerance(o.d, myPos.acc, o.pos.acc, heading.accuracy)
      const off = Math.abs(angleDiff(o.bearing, heading.deg))
      if (off > tol) continue
      const ratio = off / tol
      if (!best || ratio < best.ratio) best = { ...o, ratio, chance: hitChance(o.d, gun, ratio) }
    }
    return best
  }, [enemies, heading, myPos, gun, visionAim])

  // ---- bystanders (opted-in iYiYi users outside the match) ----
  const playerKeys = state ? Object.keys(state.players).sort().join(',') : ''
  const participantIds = useMemo(() => new Set(playerKeys ? playerKeys.split(',') : []), [playerKeys])
  const bystanders = useNearbyTaggable({ enabled: visionAim && !!state && state.phase !== 'ended', myPos, excludeIds: participantIds })
  const bystandersRef = useRef([])
  bystandersRef.current = bystanders
  const participantsRef = useRef([])
  participantsRef.current = useMemo(() => {
    const out = []
    for (const id of participantIds) {
      if (id === meId) continue
      const p = positions?.[id]
      if (p && Date.now() - (p.at || 0) <= 15000) out.push({ id, pos: p })
    }
    return out
  }, [participantIds, positions, meId])
  const btCtx = useRef({})
  btCtx.current = { fromName: myState?.name || snap?.me?.username || 'Someone', code: snap?.code || null }
  const btLast = useRef({}) // userId -> last tag time (local mirror of the host's 60 s cap)
  useTaggablePrompt(!!state)

  const aimRef = useRef({})
  aimRef.current = { pos: myPos, heading }
  const enemiesRef = useRef([])
  enemiesRef.current = enemies
  const inSightsRef = useRef(null)
  inSightsRef.current = inSights

  // Live target lock: detect people in the camera view ~2.5×/s (setting).
  const lockOn = visionAim && prefs.targetLock && playing && !dead && !miniGame && !bino
  useEffect(() => {
    if (!lockOn) { setBodies(null); return undefined }
    let cancelled = false
    const t = setInterval(() => {
      if (vision.busy()) return
      vision.capture().then((r) => { if (!cancelled && r) setBodies(r.bodies) })
    }, 400)
    return () => { cancelled = true; clearInterval(t) }
  }, [lockOn]) // eslint-disable-line react-hooks/exhaustive-deps

  // Enemy markers: match each detected person to an enemy player; only enemies get one.
  // A person who fits an opted-in bystander better than any player gets the teal emblem.
  const { enemyMarkers, bystanderMarkers } = useMemo(() => {
    const none = { enemyMarkers: [], bystanderMarkers: [] }
    if (!visionAim || !bodies?.length || !(view.width > 0)) return none
    const h = aimRef.current
    if (!h.pos || !h.heading) return none
    const seen = new Set()
    const out = []
    const bys = []
    for (const b of bodies) {
      try {
        const by = pickBystander({ body: b, users: bystandersRef.current, participants: participantsRef.current, myPos: h.pos, headingDeg: h.heading.deg })
        if (by) {
          if (seen.has(by.user.id)) continue
          seen.add(by.user.id)
          const r = scope.zoomRect(photoRectToScreen(b.head || b.box, b, view), view)
          if (Number.isFinite(r.left + r.width / 2) && Number.isFinite(r.top)) bys.push({ id: by.user.id, x: r.left + r.width / 2, y: r.top, username: by.user.username })
          continue
        }
      } catch {
        // Fall through to enemy matching.
      }
      const picked = pickVisionTarget({
        opponents: enemiesRef.current,
        myPos: h.pos,
        headingDeg: h.heading.deg,
        headingAcc: h.heading.accuracy,
        body: b,
        tolerance: aimTolerance,
      })
      const t = picked?.target
      if (!t || seen.has(t.id)) continue
      seen.add(t.id)
      const r = scope.zoomRect(photoRectToScreen(b.head || b.box, b, view), view)
      if (!Number.isFinite(r.left + r.width / 2) || !Number.isFinite(r.top)) continue // NaN in a native-driven spring
      const color = state?.mode === 'ffa' ? colors.danger : TEAMS[t.team]?.color || colors.danger
      out.push({ id: t.id, x: r.left + r.width / 2, y: r.top, color, label: t.name })
    }
    return { enemyMarkers: out, bystanderMarkers: bys }
  }, [bodies, view, visionAim, bystanders, scope.zoom]) // eslint-disable-line react-hooks/exhaustive-deps

  // ---- firing ----
  // Tell the room I fired (throttled) so enemies get a red ping where I am.
  const lastShotSent = useRef(0)
  const broadcastShot = (pos) => {
    try {
      const t = Date.now()
      if (!pos || !Number.isFinite(pos.lat) || !Number.isFinite(pos.lng) || t - lastShotSent.current < SHOT_BROADCAST_MIN_MS) return
      lastShotSent.current = t
      room.send('lt_shot', { lat: Math.round(pos.lat * 1e6) / 1e6, lng: Math.round(pos.lng * 1e6) / 1e6 })
    } catch {
      // Best effort.
    }
  }

  // One trigger pull. Unlimited ammo; semi-auto has no rate cap (useTrigger handles holds).
  const fireShot = () => {
    if (dead || !playing) return
    const shots = gun.shotsPerClick
    shotsRef.current += shots
    setShotTick((n) => n + 1)
    playShot(gun)
    buzz(gun.automatic ? 'light' : 'medium') // recoil rumble (respects the Vibration setting)
    const h = aimRef.current
    broadcastShot(h.pos)
    if (!h.pos || !h.heading) { flash('No GPS/compass fix yet', false); return }
    if (visionAim) { fireVision(shots); return }
    // Compass aim (top-edge mode or no on-device detection): probabilistic.
    const target = inSightsRef.current
    if (!target) return
    let hits = 0
    for (let i = 0; i < shots; i++) if (Math.random() < target.chance) hits += 1
    if (!hits) return
    const per = zoneDamage('body', gun, target.d)
    room.sendAction({ type: 'hit', target: target.id, hits, zone: 'body', damage: hits * per, method: 'compass', weapon: gun.id })
  }

  // Camera aim: what's actually under the crosshair decides the hit. Rapid shots share
  // the in-flight camera frame instead of queueing more captures.
  const fireVision = async (shots) => {
    const frame = await vision.capture()
    if (!frame) { flash('Camera not ready — try again', false); return }
    setBodies(frame.bodies)
    const hit = classifyHit(frame.bodies)
    if (!hit) { flash('Miss', false); return }
    const h = aimRef.current
    let by = null
    try {
      by = pickBystander({ body: hit.body, users: bystandersRef.current, participants: participantsRef.current, myPos: h.pos, headingDeg: h.heading?.deg })
    } catch {
      by = null
    }
    if (by) { tagBystander(by.user); return }
    const picked = pickVisionTarget({
      opponents: enemiesRef.current.map((e) => ({ ...e, alive: e.alive && !((e.protectedUntil || 0) > room.now()) })),
      myPos: h.pos,
      headingDeg: h.heading?.deg,
      headingAcc: h.heading?.accuracy,
      body: hit.body,
      tolerance: aimTolerance,
    })
    if (!picked) { flash('That’s not a player in this game', false); return }
    const per = zoneDamage(hit.zone, gun, picked.distance)
    room.sendAction({ type: 'hit', target: picked.target.id, hits: shots, zone: hit.zone, damage: per * shots, method: 'vision', weapon: gun.id })
  }

  // Throw along the compass heading; it goes off after the fuse, where it landed.
  const throwGrenade = async (distance, how) => {
    if (dead || !playing) return
    const h = aimRef.current
    if (!h.pos || !h.heading) { flash('No GPS/compass fix yet', false); return }
    if (!grenadeInv.owner && !(grenadeInv.balance > 0)) { flash('No grenades left — get more in the Arcade Shop', false); return }
    const ok = await spendGrenade()
    if (!ok) { flash('No grenades left — get more in the Arcade Shop', false); return }
    const land = destinationPoint(h.pos, h.heading.deg, distance)
    buzz('medium')
    flash(`💣 Grenade ${how === 'swing' ? 'thrown' : 'out'} — ${distance} m`, true)
    const t = setTimeout(() => {
      try {
        playSfx('explosion')
        buzz('heavy')
        setBlastKey(Date.now())
        room.sendAction({ type: 'grenade', lat: Math.round(land.lat * 1e6) / 1e6, lng: Math.round(land.lng * 1e6) / 1e6 })
      } catch {
        // The match may have ended mid-fuse.
      }
    }, GRENADE_FUSE_MS)
    grenadeTimers.current.push(t)
  }

  const tagBystander = (user) => {
    const t = Date.now()
    if (t - (btLast.current[user.id] || 0) < BYSTANDER_COOLDOWN_MS) {
      flash(`Already tagged @${user.username} — once a minute`, false)
      return
    }
    btLast.current[user.id] = t
    room.sendAction({ type: 'bystander', userId: user.id, username: user.username })
  }

  const trigger = useTrigger(gun, fireShot, { enabled: playing && !dead && !overlayOpen && !bino })
  triggerRef.current = trigger

  // ---- weapon switching ----
  const pickWeapon = useCallback((id) => {
    setWheelOpen(false)
    const w = getWeapon(id)
    try { playShot(w) } catch {}
    buzz('medium')
    if (id === weaponId) return
    selectWeapon(id)
    flash(`${w.name}`, true)
  }, [weaponId, selectWeapon, flash])
  const openWheel = useCallback(() => { trigger.stop(); buzz('medium'); setWheelOpen(true) }, [trigger])

  // ---- map ----
  // Range (minimap + large map) is remembered for this match; limited by the lobby's play area.
  const [mapRangeId, setMapRangeId] = useState(DEFAULT_MAP_RANGE)
  const [mapOpen, setMapOpen] = useState(false)
  const matchKey = `${snap?.code}:${snap?.info?.round}`
  useEffect(() => { setMapRangeId(DEFAULT_MAP_RANGE); setMapOpen(false) }, [matchKey])
  const allowedMapRanges = allowedRanges({ endless: !!snap?.info?.settings?.endless, areaR: snap?.info?.settings?.area?.r })
  const effectiveRangeId = allowedMapRanges.includes(mapRangeId) ? mapRangeId : allowedMapRanges[allowedMapRanges.length - 1]
  const openMap = useCallback(() => { trigger.stop(); buzz('select'); setMapOpen(true) }, [trigger])

  // Minimap contents (memoized so sensor-driven re-renders don't rebuild markers).
  const { mapPoints, mapAreas } = useMemo(() => {
    const pts = []
    if (!state) return { mapPoints: pts, mapAreas: [] }
    const sndS = state.mode === 'snd' ? state.snd : null
    for (const id of Object.keys(state.players)) {
      if (id === meId) continue
      const p = positions?.[id]
      if (!p || Date.now() - p.at > 15000) continue
      const pl = state.players[id]
      const mate = state.mode !== 'ffa' && pl.team === myTeam
      if (!mate) continue // Enemies are hidden (shot pings / UAV come from useEnemyIntel)
      pts.push({
        id,
        pos: p,
        color: !pl.alive ? '#7a8099' : mate ? TEAMS[pl.team]?.color || colors.success : colors.danger,
        ring: !!sndS && sndS.bomb?.carrier === id,
      })
    }
    const areas = sndS ? sndS.sites.map((x) => ({ id: x.id, pos: x, r: x.r, color: colors.gold, label: x.id })) : []
    const b = sndS?.bomb
    // A planted bomb is shown to everyone; a dropped one to attackers.
    if (b && (b.state === 'planted' || (b.state === 'dropped' && myTeam === engine.attackingTeam(state))) && b.lat != null) {
      pts.push({ id: 'bomb', pos: b, color: b.state === 'planted' ? colors.danger : colors.gold, label: '💣' })
    }
    return { mapPoints: pts, mapAreas: areas }
  }, [state, positions, meId, myTeam])
  const area = snap?.info?.settings?.area
  const mapBoundary = useMemo(
    () => (area && Number.isFinite(area.lat) && Number.isFinite(area.lng) && area.r > 0 ? { lat: area.lat, lng: area.lng, r: area.r } : null),
    [area?.lat, area?.lng, area?.r], // eslint-disable-line react-hooks/exhaustive-deps
  )
  const mapHeading = Math.round((heading?.deg ?? 0) / 4) * 4 // coarse: fewer minimap re-renders

  const intelPoints = useEnemyIntel({ room, state, positions, meId, myTeam, uavActive, color: colors.danger })
  const allMapPoints = useMemo(() => (intelPoints.length ? [...mapPoints, ...intelPoints] : mapPoints), [mapPoints, intelPoints])

  // ---- render ----
  if (!room || !snap) return null
  if (loc.status !== 'granted') return <LocationGate status={loc.status} onExit={onExit} what="Laser Tag" />
  if (!state) return <Spectating text="Starting…" />
  if (!myState) return <Spectating text={state.endless ? 'Dropping you into the arena…' : undefined} />

  if (state.phase === 'ended') {
    return (
      <View style={{ flex: 1, paddingTop: insets.top + 44, backgroundColor: '#07080f' }}>
        <MatchSummary
          state={state}
          meId={meId}
          roster={snap.roster}
          shotsBy={shotsBy}
          isHost={isHost}
          onPlayAgain={() => room.setInfo({ round: (snap.info.round || 0) + 1 })}
          onExit={onExit}
        />
      </View>
    )
  }

  const topMode = aim.mode === 'top'
  const triggerMode = aim.mode === 'trigger'
  const fullScreenTrigger = topMode || triggerMode
  const objective = snd ? sndObjective(state, meId, myPos, now) : null

  const arenaRank = (() => {
    if (!state.endless) return null
    const ids = Object.keys(state.players)
    const mine = myState.score || 0
    return { rank: 1 + ids.filter((id) => (state.players[id].score || 0) > mine).length, of: ids.length }
  })()
  const outsideArea = !!(mapBoundary && myPos && distanceMeters(myPos, mapBoundary) > mapBoundary.r + engine.gpsSlack(myPos.acc))

  const timerMs = state.endsAt - Math.max(now, state.startsAt)
  const side = leftHanded ? 'right' : 'left'
  const otherSide = leftHanded ? 'left' : 'right'

  const startMiniGame = (action) => {
    trigger.stop()
    buzz('medium')
    setMiniGame({ kind: action.kind, site: action.site, key: Date.now() })
  }

  return (
    <View style={styles.fill} {...scope.panHandlers}>
      {camPerm?.granted ? (
        <View style={[StyleSheet.absoluteFill, { overflow: 'hidden' }]} onLayout={(e) => setView(e.nativeEvent.layout)}>
          <View style={[StyleSheet.absoluteFill, scope.zoom !== 1 && { transform: [{ scale: scope.zoom }] }]}>
            <CameraView ref={cameraRef} style={StyleSheet.absoluteFill} facing="back" animateShutter={false} />
          </View>
        </View>
      ) : (
        <View style={[StyleSheet.absoluteFill, styles.noCam]}>
          {camPerm && !camPerm.granted && camPerm.status === 'denied' ? <CameraOff what="aiming in Laser Tag" compact /> : null}
        </View>
      )}

      {/* Top-edge and trigger modes: the whole screen is the trigger. */}
      {fullScreenTrigger && !bino && (
        <Pressable
          style={StyleSheet.absoluteFill}
          onPressIn={trigger.onPressIn}
          onPressOut={trigger.onPressOut}
          disabled={dead || !playing}
          accessibilityRole="button"
          accessibilityLabel={gun.automatic ? 'Fire. Hold for continuous fire' : 'Fire. Every tap fires'}
        />
      )}

      {/* Target-lock brackets around people the camera sees */}
      {visionAim && bodies && view.width > 0 && bodies.map((b, i) => {
        const r = scope.zoomRect(photoRectToScreen(b.box, b, view), view)
        const locked = !!classifyHit([b])
        return (
          <View key={i} pointerEvents="none" style={[styles.bracket, { left: r.left, top: r.top, width: r.width, height: r.height, borderColor: locked ? colors.danger : 'rgba(255,255,255,0.4)' }]} />
        )
      })}
      {bino ? <BinocularFrame zoom={scope.zoom} view={view} /> : null}
      {bino ? (
        <BinocularMarkers
          markers={binocularMarkers({
            players: enemies.filter((e) => e.alive).map((e) => ({ id: e.id, name: e.name, d: e.d, bearing: e.bearing, color: state?.mode === 'ffa' ? colors.danger : TEAMS[e.team]?.color || colors.danger })),
            headingDeg: heading?.deg,
            zoom: scope.zoom,
            view,
          })}
        />
      ) : <EnemyMarkers markers={enemyMarkers} />}
      <BystanderMarkers markers={bystanderMarkers} />

      {camPerm?.granted && !topMode && !bino && aim.mode === 'camera' ? (
        <GunViewModel gun={gun} shotTick={shotTick} bottom={dockH || 0} hidden={dead} leftHanded={leftHanded} />
      ) : null}
      <GrenadeBlast key={blastKey} visible={!!blastKey} />
      <Animated.View pointerEvents="none" style={[styles.vignette, { opacity: vignette }]} />

      {/* HUD — top: explicit rows in normal flow (see laser/hudLayout.js). The right edge
          leaves room for GamePlayScreen's floating 👥 💬 ☰ buttons. */}
      <View style={[styles.topCol, { top: hud.top, left: hud.side, right: hud.side }]} pointerEvents="box-none" onLayout={onTopLayout}>
        {/* Row 1: status */}
        <View style={[styles.row1, { marginRight: TOP_BUTTONS_W - 12 }]} pointerEvents="none">
          <View style={[styles.statusBlock, hud.compact && { width: 96 }]}>
            <View style={styles.hpTrack}>
              <View style={[styles.hpFill, { width: `${Math.max(0, Math.min(100, myState.hp))}%`, backgroundColor: myState.hp > 34 ? colors.success : colors.danger }]} />
            </View>
            <Text style={styles.hudText} numberOfLines={1}>{myState.hp} HP · {myState.score} pts</Text>
            <Text style={styles.hudText} numberOfLines={1}>{myState.kills || 0} K · {myState.deaths || 0} D</Text>
            {myTeam && <Text style={styles.hudText} numberOfLines={1}><Text style={{ color: TEAMS[myTeam].color }}>●</Text> {TEAMS[myTeam].name}{snd ? ` · ${snd.sides[myTeam] === 'attack' ? 'Atk' : 'Def'}` : ''}</Text>}
          </View>
          <View style={styles.centerBlock}>
            {state.endless ? (
              <>
                <Text style={[styles.timer, hud.compact && { fontSize: 17 }]} numberOfLines={1}><Text style={{ color: colors.danger }}>●</Text> LIVE</Text>
                <Text style={styles.hudText} numberOfLines={1}>Arena · #{arenaRank.rank}/{arenaRank.of}</Text>
              </>
            ) : bombState !== 'planted' ? (
              <Text style={[styles.timer, hud.compact && { fontSize: 18 }]} numberOfLines={1}>{formatClock(timerMs)}</Text>
            ) : null}
            {state.mode === 'tdm' && <Text style={styles.hudText} numberOfLines={1}>{state.teamScore.A} – {state.teamScore.B}</Text>}
            {snd && <Text style={styles.hudText} numberOfLines={1}>R{snd.roundNo}/{snd.totalRounds} · {snd.wins.A}–{snd.wins.B}</Text>}
          </View>
        </View>

        {bombState === 'planted' && (
          <View style={styles.rowCenter} pointerEvents="none">
            <BombCountdown msLeft={(snd.bomb.explodesAt || now) - now} inline />
          </View>
        )}

        {/* Row 2: fire mode pill + Scores */}
        <View style={styles.row2} pointerEvents="box-none">
          <Pressable onPress={() => { trigger.stop(); buzz('select'); setScoresOpen(true) }} hitSlop={8} style={styles.scoreBtn} accessibilityRole="button" accessibilityLabel="Open scoreboard">
            <Ionicons name="podium" size={13} color="#fff" />
            <Text style={styles.scoreBtnText}>Scores</Text>
          </Pressable>
          <View style={styles.modePill} pointerEvents="none">
            <Text style={styles.modePillText} numberOfLines={1}>
              {aim.mode === 'trigger' ? '☝︎' : aim.mode === 'top' ? '▲' : '⌖'} {AIM_MODE_LABELS[aim.mode] || ''}{aim.autoDetected ? ' · auto' : ''}
            </Text>
          </View>
        </View>

        {!triggerMode && state.feed.length > 0 && (
          <View style={styles.feed} pointerEvents="none">
            {state.feed.slice(0, hud.compact ? 2 : 3).map((f) => <Text key={f.id} style={styles.feedText} numberOfLines={1}>{f.text}</Text>)}
          </View>
        )}

        {/* Row 3: top-edge AIM marker */}
        {topMode && <Text style={styles.topEdge} pointerEvents="none">▲ AIM ▲</Text>}
      </View>

      {/* Aim indicator: the space between the top rows and the bottom dock. */}
      <View style={[styles.center, { top: (topH ? hud.top + topH : hud.top + 120) + 8, bottom: hud.bottom + (dockH || 160) + 8 }]} pointerEvents="none">
        {topMode ? (
          <View style={{ alignItems: 'center' }}>
            <Text style={[styles.arrow, hud.compact && { fontSize: 46 }, inSights && { color: colors.danger }]}>▲</Text>
            <Text style={styles.sightText}>Point the top edge at a player · tap anywhere to fire</Text>
          </View>
        ) : (
          <View style={[styles.cross, (inSights || enemyMarkers.length > 0) && { borderColor: colors.danger }]}>
            <View style={[styles.crossH, inSights && { backgroundColor: colors.danger }]} />
            <View style={[styles.crossV, inSights && { backgroundColor: colors.danger }]} />
          </View>
        )}
        {!triggerMode && <Text style={styles.sightText} numberOfLines={2}>
          {visionAim
            ? (bodies?.some((b) => classifyHit([b])) ? 'Target locked' : enemies.some((e) => e.alive) ? `Camera aim · range ${formatDistance(VISION_RANGE_M)}` : 'Waiting for other players’ GPS…')
            : inSights
              ? `${inSights.name} · ${formatDistance(inSights.d)} · ~${Math.round(inSights.chance * 100)}% hit`
              : enemies.some((e) => e.alive) ? 'No one in your sights' : 'Waiting for other players’ GPS…'}
        </Text>}
        {!visionAim && !triggerMode && <Text style={styles.aimMode}>Compass aim — can’t see cover · {formatDistance(Math.min(gun.range, COMPASS_MAX_RANGE_M))} range</Text>}
        {isProtected && <Text style={[styles.aimMode, { color: colors.success }]}>Spawn protection</Text>}
        {!!marker && <Text style={[styles.marker, { color: marker.good ? colors.success : colors.onBrand }]} numberOfLines={2}>{marker.text}</Text>}
      </View>

      {/* Above the dock: S&D objective + GPS/compass warnings. */}
      <View style={[styles.aboveDock, { bottom: hud.bottom + (dockH || 160) + 8, left: hud.side, right: hud.side }]} pointerEvents="box-none">
        {objective && (
          <View style={styles.objective} pointerEvents="box-none">
            <Text style={styles.objectiveText} pointerEvents="none" numberOfLines={2}>{objective.text}</Text>
            {objective.action && !dead && playing && !miniGame && (
              objective.action.kind === 'pickup' ? (
                <Btn title="Pick up bomb" variant="primary" onPress={() => { buzz('medium'); room.sendAction({ type: 'pickup' }) }} />
              ) : (
                <BigActionButton
                  key={`${objective.action.kind}-${objective.action.site || ''}`}
                  title={objective.action.kind === 'plant' ? `💣 PLANT BOMB${objective.action.site ? ` · ${objective.action.site}` : ''}` : '🛠 DEFUSE'}
                  color={objective.action.kind === 'plant' ? colors.gold : '#3ad1ff'}
                  onPress={() => startMiniGame(objective.action)}
                />
              )
            )}
          </View>
        )}
        {(myPos?.acc > 20 || (heading && heading.accuracy < 2)) && (
          <Text style={[styles.warn, { alignSelf: leftHanded ? 'flex-end' : 'flex-start' }]} pointerEvents="none" numberOfLines={2}>
            {myPos?.acc > 20 ? `Weak GPS (±${Math.round(myPos.acc)} m)` : 'Compass needs calibrating — move your phone in a figure 8'}
          </Text>
        )}
      </View>

      {/* Bottom dock: minimap on one side; UAV, weapon and FIRE stacked on the other. */}
      <View
        style={[styles.dock, { bottom: hud.bottom, left: hud.side, right: hud.side, flexDirection: leftHanded ? 'row-reverse' : 'row' }]}
        pointerEvents="box-none"
        onLayout={onDockLayout}
      >
        {/* Minimap (double-tap opens the large map; swallows taps so it never fires) */}
        {prefs.minimap ? (
          <MapMinimap
            size={hud.mapSize}
            me={myPos}
            headingDeg={mapHeading}
            rangeM={rangeById(effectiveRangeId).r}
            rangeLabel={rangeById(effectiveRangeId).label}
            points={allMapPoints}
            areas={mapAreas}
            boundary={mapBoundary}
            rangeRingM={gun.range}
            onOpen={openMap}
            uavActive={uavActive}
          />
        ) : <View />}
        <View style={[styles.fireCol, hud.landscape && { flexDirection: leftHanded ? 'row-reverse' : 'row', alignItems: 'flex-end' }, !hud.landscape && { alignItems: leftHanded ? 'flex-start' : 'flex-end' }, { maxWidth: hud.landscape ? hud.width - hud.side * 2 - hud.mapSize - DOCK_GAP : hud.chipMaxW }]} pointerEvents="box-none">
          <UavButton count={uav.count} activeMsLeft={uav.myMs} disabled={!playing && !uav.empty} onPress={uav.callUav} size={hud.compact ? 48 : 54} />
          <GrenadeButton
            count={grenadeInv.owner ? Infinity : grenadeInv.balance}
            disabled={!playing || dead || bino}
            size={hud.compact ? 48 : 54}
            onThrow={throwGrenade}
            onEmpty={() => flash('No grenades — get 10 in the Arcade Shop', false)}
          />
          {camPerm?.granted && !topMode ? (
            <Pressable
              onPress={toggleBino}
              hitSlop={6}
              style={({ pressed }) => [styles.zoomBtn, bino && styles.zoomBtnOn, pressed && { opacity: 0.75 }]}
              accessibilityRole="button"
              accessibilityLabel={bino ? 'Lower binoculars' : 'Binoculars: look far and see enemy names. You can’t shoot while they’re up.'}
            >
              <Text style={{ fontSize: 14 }}>🔭</Text>
              <Text style={[styles.zoomText, bino && { color: colors.onGold }]}>{bino ? 'Lower' : 'Scout'}</Text>
            </Pressable>
          ) : null}
          {camPerm?.granted && !topMode ? (
            <Pressable
              onPress={scope.cycle}
              hitSlop={6}
              style={({ pressed }) => [styles.zoomBtn, scope.zoom > 1 && styles.zoomBtnOn, pressed && { opacity: 0.75 }]}
              accessibilityRole="button"
              accessibilityLabel={`Scope zoom ${formatZoom(scope.zoom)}. Tap to change, or pinch the screen.`}
            >
              <Ionicons name="scan" size={14} color={scope.zoom > 1 ? colors.onGold : '#fff'} />
              <Text style={[styles.zoomText, scope.zoom > 1 && { color: colors.onGold }]}>{formatZoom(scope.zoom)}</Text>
            </Pressable>
          ) : null}
          <WeaponChip weapon={gun} count={loadout.length} onWheel={openWheel} maxWidth={hud.landscape ? 240 : hud.chipMaxW} />
          {aim.mode === 'camera' && (
            <Pressable
              onPressIn={trigger.onPressIn}
              onPressOut={trigger.onPressOut}
              disabled={dead || !playing}
              style={({ pressed }) => [styles.fire, hud.compact && styles.fireCompact, { opacity: dead || !playing ? 0.4 : pressed ? 0.75 : 1 }]}
              accessibilityRole="button"
              accessibilityLabel="Fire"
            >
              <Text style={styles.fireText}>FIRE</Text>
            </Pressable>
          )}
        </View>
      </View>

      <EnemyUavPill msLeft={uav.enemyMs} top={(topH ? hud.top + topH : hud.top + 120) + 6} />
      {outsideArea && (
        <View style={[styles.areaWarn, { top: (topH ? hud.top + topH : hud.top + 120) + (uav.enemyMs > 0 ? 40 : 6) }]} pointerEvents="none">
          <Text style={styles.areaWarnText} numberOfLines={2}>⚠️ You’re outside the play area — head back in</Text>
        </View>
      )}

      {dead && state.phase === 'playing' && (
        <View style={styles.deadOverlay} pointerEvents="none">
          <Text style={[type.display, { color: colors.onBrand }]}>Tagged out</Text>
          <Text style={[type.body, { color: colors.onBrand, marginTop: 8 }]}>
            {snd ? 'No respawns this round — you’re back next round.' : `Back in ${Math.max(0, Math.ceil(((myState.respawnAt || now) - now) / 1000))}s`}
          </Text>
        </View>
      )}
      <AlertBanner alert={alert} top={(topH ? hud.top + topH : hud.top + 120) + 6} />
      {state.phase === 'countdown' && <CountdownOverlay state={state} now={now} meTeam={myTeam} />}
      {state.phase === 'roundEnd' && snd && <RoundBreak state={state} now={now} />}

      {miniGame && (
        <TapMiniGame
          key={miniGame.key}
          kind={miniGame.kind}
          durationMs={miniGame.kind === 'plant' ? engine.PLANT_MS : engine.DEFUSE_MS}
          needed={miniGame.kind === 'plant' ? engine.PLANT_TAPS : engine.DEFUSE_TAPS}
          insets={insets}
          interruptedAt={actLost}
          onStart={() => room.sendAction(miniGame.kind === 'plant' ? { type: 'plant_start', site: miniGame.site } : { type: 'defuse_start' })}
          onSuccess={() => room.sendAction({ type: miniGame.kind === 'plant' ? 'plant_done' : 'defuse_done' })}
          onFail={() => room.sendAction({ type: 'act_cancel' })}
          onClose={() => { room.sendAction({ type: 'act_cancel' }); setMiniGame(null) }}
        />
      )}
      <WeaponWheel visible={wheelOpen} loadout={loadout} currentId={weaponId} onPick={pickWeapon} onClose={() => setWheelOpen(false)} />
      <ScoreboardOverlay visible={scoresOpen} state={state} meId={meId} insets={insets} onClose={() => setScoresOpen(false)} />
      <MapOverlay
        visible={mapOpen}
        onClose={() => setMapOpen(false)}
        insets={insets}
        me={myPos}
        rangeId={effectiveRangeId}
        allowed={allowedMapRanges}
        onRange={(id) => { buzz('select'); setMapRangeId(id) }}
        points={allMapPoints}
        areas={mapAreas}
        boundary={mapBoundary}
        rangeRingM={gun.range}
        uavActive={uavActive}
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

// What an S&D player should be doing right now, plus a contextual action.
function sndObjective(state, meId, myPos, now) {
  const snd = state.snd
  const me = state.players[meId]
  const atk = engine.attackingTeam(state)
  const attacker = me.team === atk
  const bomb = snd.bomb || {}
  const act = snd.act
  const myAct = act?.by === meId
  const where = (target) => (myPos && target?.lat != null ? `${formatDistance(distanceMeters(myPos, target))} ${compassLabel(bearingDeg(myPos, target))}` : '')
  const nearest = myPos ? [...snd.sites].sort((a, b) => distanceMeters(myPos, a) - distanceMeters(myPos, b))[0] : snd.sites[0]
  if (!me.alive) return { text: 'Spectating until the next round' }
  if (bomb.state === 'planted') {
    if (attacker) return { text: `Bomb is active at ${bomb.site} — defend the bomb!` }
    const inside = engine.insideRadius(myPos, bomb, bomb.r || engine.SITE_RADIUS_M)
    return {
      text: inside ? (act?.kind === 'defuse' && !myAct ? 'A teammate is defusing — cover them' : 'You’re at the bomb') : `Defuse the bomb at ${bomb.site}: ${where(bomb)}`,
      action: inside && (!act || myAct) ? { kind: 'defuse' } : null,
    }
  }
  if (attacker) {
    if (bomb.state === 'carried' && bomb.carrier === meId) {
      const site = snd.sites.find((x) => engine.insideRadius(myPos, x, x.r))
      if (site) return { text: `Inside site ${site.id}`, action: !act || myAct ? { kind: 'plant', site: site.id } : null }
      return { text: `You have the bomb 💣 — site ${nearest?.id}: ${where(nearest)}` }
    }
    if (bomb.state === 'dropped') {
      const close = myPos && bomb.lat != null && distanceMeters(myPos, bomb) <= engine.PICKUP_RANGE_M + engine.gpsSlack(myPos.acc)
      return { text: close ? 'The bomb is here' : `Bomb dropped: ${where(bomb)}`, action: close ? { kind: 'pickup' } : null }
    }
    const carrier = state.players[bomb.carrier]
    return { text: carrier ? `${carrier.name} has the bomb — cover them` : 'Eliminate the defenders' }
  }
  if (act?.kind === 'plant') return { text: `They’re planting at ${act.site}! Stop them` }
  return { text: `Defend ${snd.sites.map((x) => x.id).join(' & ')} · nearest ${where(nearest)}` }
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: '#000', overflow: 'hidden' },
  noCam: { alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: '#111' },
  topCol: { position: 'absolute', gap: 6 },
  row1: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, minHeight: 40 },
  statusBlock: { width: 112 },
  centerBlock: { flex: 1, minWidth: 0, alignItems: 'center' },
  rowCenter: { alignItems: 'center' },
  row2: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  aboveDock: { position: 'absolute', gap: 8 },
  dock: { position: 'absolute', alignItems: 'flex-end', justifyContent: 'space-between' },
  fireCol: { gap: DOCK_GAP },
  zoomBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, height: 36, borderRadius: 18, backgroundColor: 'rgba(0,0,0,0.45)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.35)' },
  zoomBtnOn: { backgroundColor: colors.gold, borderColor: colors.gold },
  zoomText: { color: '#fff', fontWeight: '800', fontSize: 13 },
  fireCompact: { width: 88, height: 88, borderRadius: 44 },
  hpTrack: { height: 10, borderRadius: 5, backgroundColor: 'rgba(255,255,255,0.25)', overflow: 'hidden' },
  hpFill: { height: 10, borderRadius: 5 },
  hudText: { fontSize: 11.5, fontWeight: '600', color: colors.onBrand, marginTop: 2, ...hudShadow },
  scoreBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 5, borderRadius: radii.pill, backgroundColor: 'rgba(0,0,0,0.5)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.25)' },
  scoreBtnText: { fontSize: 11, fontWeight: '800', color: '#fff' },
  timer: { fontSize: 20, fontWeight: '800', color: colors.onBrand, letterSpacing: -0.3, ...hudShadow },
  feed: { alignSelf: 'flex-end', alignItems: 'flex-end', maxWidth: '70%' },
  feedText: { fontSize: 11.5, color: colors.onBrand, ...hudShadow },
  center: { position: 'absolute', left: 0, right: 0, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 30, overflow: 'hidden' },
  cross: { width: 68, height: 68, borderRadius: 34, borderWidth: 2, borderColor: colors.onBrand, alignItems: 'center', justifyContent: 'center' },
  crossH: { position: 'absolute', width: 30, height: 2, backgroundColor: colors.onBrand },
  crossV: { position: 'absolute', width: 2, height: 30, backgroundColor: colors.onBrand },
  arrow: { fontSize: 64, color: colors.onBrand, ...hudShadow },
  topEdge: { alignSelf: 'center', marginTop: 4, fontSize: 12, fontWeight: '800', letterSpacing: 3, color: colors.gold, ...hudShadow },
  sightText: { ...type.caption, color: colors.onBrand, marginTop: 10, textAlign: 'center', ...hudShadow },
  marker: { ...type.title, marginTop: 6, ...hudShadow },
  objective: { alignItems: 'center', gap: 10 },
  objectiveText: { ...type.body, fontWeight: '700', color: colors.onBrand, textAlign: 'center', ...hudShadow },
  fire: { width: 104, height: 104, borderRadius: 52, backgroundColor: colors.crimson, alignItems: 'center', justifyContent: 'center', borderWidth: 3, borderColor: colors.onBrand },
  fireText: { ...type.title, color: colors.onBrand, letterSpacing: 2 },
  warn: { ...type.caption, color: colors.gold, ...hudShadow, maxWidth: 220 },
  bracket: { position: 'absolute', borderWidth: 1.5, borderRadius: 6 },
  areaWarn: { position: 'absolute', alignSelf: 'center', backgroundColor: 'rgba(224,79,79,0.85)', paddingHorizontal: 14, paddingVertical: 8, borderRadius: radii.pill },
  areaWarnText: { ...type.caption, color: '#fff', fontWeight: '700' },
  vignette: { ...StyleSheet.absoluteFillObject, borderWidth: 40, borderColor: 'rgba(224,79,79,0.7)', backgroundColor: 'rgba(224,79,79,0.18)' },
  modePill: { flexShrink: 1, backgroundColor: 'rgba(0,0,0,0.5)', paddingHorizontal: 10, paddingVertical: 4, borderRadius: radii.pill },
  modePillText: { fontSize: 11, fontWeight: '700', color: colors.onBrand, letterSpacing: 0.3 },
  aimMode: { ...type.caption, color: colors.gold, marginTop: 4, textAlign: 'center', ...hudShadow },
  deadOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(120,0,20,0.5)', alignItems: 'center', justifyContent: 'center' },
})
