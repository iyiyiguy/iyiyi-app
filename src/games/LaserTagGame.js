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
// Weapons (guns.js): unlimited ammo; semi-auto fires once per tap, automatic fires
// continuously while held (useTrigger); slow weapons keep their cycle (rocket 1 per 3 s,
// laser/aimRules.minShotGapMs), on this phone and on the host. Your phone picks who is in
// your sights; the host re-checks the bearing, rolls compass hits, rate-limits and runs the
// rules (laser/engine.js). Rockets are a visible projectile that always explodes where it
// lands — at a wall in front of you too, once the surface scanner (laser/useSceneDepth.js,
// a depth model downloaded on first open) sees one; laser shots into cover show a COVER
// spark (visual only). Placed explosives show on the ground in the camera (laser/GroundExplosives.js) in
// AIM and HIP FIRE. Safety: firing / placing is off above ~15 km/h (laser/useSpeedLock.js).
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Animated, BackHandler, Easing, Platform, Pressable, StyleSheet, Text, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { Camera, CameraView } from 'expo-camera'
import { useKeepAwake } from 'expo-keep-awake'
import { CameraOff, useCameraGate } from '../components/CameraGate'
import { setAudioModeAsync } from 'expo-audio'
import { LocationGate, PlayerTap, Spectating, formatClock } from './MultiplayerUI'
import GameFollowButton from '../components/GameFollowButton'
import { CountdownOverlay, MatchSummary, RoundBreak } from './laser/Hud'
import {
  AlertBanner, BombCountdown, EnemyMarkers, HoldActionButton, LiveTargetBrackets, ScoreboardOverlay, TargetBrackets, WeaponWheel,
} from './laser/HudExtras'
import { CompassTape, FireButton, HUD, HudButton, HudCta, KillFeed, MatchClock, Nameplates, ScorePanel, ScorePops, StatusPanel, WeaponCard, stripSymbols } from './laser/HudPro'
import { HipFireRadar, HipFireStatus, HipFireZone, radarPoint } from './laser/HipFire'
import { FONT, ST, stShadow, stType, useStudioFonts } from './studio'
import { mapsAvailable } from '../components/SafeMapView'
import { DEFAULT_MAP_RANGE, MapMinimap, MapOverlay, allowedRanges, rangeById } from './laser/MapMinimap'
import { AIM_MODE_TIPS, useAim } from './laser/useAim'
import * as engine from './laser/engine'
import { angularBody, photoRectToScreen, pickVisionTarget, useVisionCapture, viewBodiesFromLive, viewBodiesFromStill, visionAvailable, VISION_RANGE_M } from './laser/vision'
import { pickAimTarget, pickTapTarget, zoneAtRelative } from './laser/aimAssist'
import { useLiveBodies } from './laser/liveBodies'
import {
  angleDiff, bearingDeg, compassLabel, distanceMeters, formatDistance, recordRoundResult,
  useHostLoop, useRoomClock, useRoomPositions, useRoomSnapshot, useSharedLocation,
} from '../lib/multiplayer'
import { buzz, useGamePrefs } from '../lib/gamePrefs'
import {
  FREE_GUN_IDS, getEquippedGun, getLoadout, getWeapon, playShot, playSfx, preloadWeaponSounds, releaseWeaponSounds, setEquippedGun, useTrigger,
} from '../lib/guns'
import { recordGameResult } from '../lib/arcadeStats'
import { useUavControl } from './laser/useUavControl'
import { UavButton, UavSheet } from './laser/Uav'
import { SHOT_BROADCAST_MIN_MS, isEnemy, useEnemyIntel } from './laser/intel'
import { BYSTANDER_COOLDOWN_MS, pickBystander, recordBystanderTag, useNearbyTaggable } from '../lib/bystanderTags'
import { sendBystanderTag } from '../lib/invites'
import { BystanderMarkers, useTaggablePrompt } from './laser/Bystander'
import { useArcadeInsets } from './arcadeUI'
import { DOCK_GAP, useHudMetrics, useMeasuredHeight } from './laser/hudLayout'
import { BINOCULAR_MAX_ZOOM, formatZoom, maxZoomFor, useScopeZoom } from './laser/useScopeZoom'
import { BinocularFrame, BinocularMarkers, binocularMarkers } from './laser/Binoculars'
import { GroundExplosives, groundMarkers } from './laser/GroundExplosives'
import { DualCameraView, isDualCameraSupported, isRecordingSupported, startRecording, stopRecording } from '../../modules/dual-camera'
import * as MediaLibrary from 'expo-media-library/legacy'
import { GRENADE_FUSE_MS, GrenadeBlast, GrenadeButton, destinationPoint } from './laser/Grenade'
import { DetonateAllButton, StickyBombButton, LandMineButton } from './laser/Consumables'
import { COMPASS_MAX_RANGE_M, compassTolerance, gpsErr, hitChance, minShotGapMs, visionTolerance } from './laser/aimRules'
import { laserCover, rocketImpactWithCover } from './laser/sceneDepth'
import { useSceneDepth } from './laser/useSceneDepth'
import { CoverEffects } from './laser/CoverEffects'
import { round6 } from './laser/geo'
import { speedLockText, useSpeedLock } from './laser/useSpeedLock'
import { localizeUavAlert } from './laser/uavText'
import { useBattleEffects, directionToAngle } from './laser/BattleEffects'
import Svg, { Path, Rect } from 'react-native-svg'
import GunViewModel, { muzzlePoint } from './laser/GunViewModel'
import FpsCrosshair from './laser/FpsCrosshair'
import { spendGrenade, useGrenadeInventory } from '../lib/grenades'
import { spendStickyBomb, useStickyBombInventory } from '../lib/stickyBombs'
import { spendLandMine, useLandMineInventory } from '../lib/landMines'
import { matchCheck } from '../lib/matchLimits'
import { translate, useT } from '../i18n'
import S from '../i18n/strings/laserTag'

// Call-time lookup for callbacks and helpers outside render.
const tr = (k, v) => translate(S, k, v)
// "Ana −25, Ben −10"
const hitList = (hits) => hits.map((h) => `${h.name} −${h.damage}`).join(', ')

// Tagged-out screen (studio "Down" board): red dim, who got you (with Follow), the respawn
// countdown, and a shortcut to the weapon wheel while you wait.
function DeathOverlay({ respawnSecs, snd, killer, onChangeWeapon }) {
  const t = useT(S)
  const fade = useRef(new Animated.Value(0)).current
  useEffect(() => {
    Animated.timing(fade, { toValue: 1, duration: 260, easing: Easing.out(Easing.quad), useNativeDriver: true }).start()
  }, [fade])
  const total = engine.RESPAWN_MS / 1000
  const pct = respawnSecs != null ? Math.max(0, Math.min(1, 1 - respawnSecs / total)) : 0
  const sub = killer ? [killer.weapon, killer.where, Number.isFinite(killer.hpLeft) ? t('hp_left', { n: killer.hpLeft }) : null].filter(Boolean).join(' · ') : ''
  return (
    <Animated.View style={[StyleSheet.absoluteFill, { opacity: fade }]} pointerEvents="box-none">
      <View style={[StyleSheet.absoluteFill, styles.deadDim]} pointerEvents="none" />
      <View style={[StyleSheet.absoluteFill, styles.deadEdge]} pointerEvents="none" />
      <View style={styles.deadBody} pointerEvents="box-none">
        {killer?.name ? (
          <View style={{ alignItems: 'center', gap: 10 }} pointerEvents="box-none">
            <Text style={styles.deadLabel}>{t('tagged_out_by')}</Text>
            <PlayerTap player={killer.id ? { id: killer.id, username: killer.name } : null} style={styles.killerCard}>
              <View style={styles.killerAvatar}><Text style={styles.killerInitial}>{String(killer.name).slice(0, 1).toUpperCase()}</Text></View>
              <View style={{ flexShrink: 1 }}>
                <Text style={styles.killerName} numberOfLines={1}>{String(killer.name).toUpperCase()}</Text>
                {sub ? <Text style={styles.killerHow} numberOfLines={2}>{sub}</Text> : null}
              </View>
            </PlayerTap>
          </View>
        ) : (
          <Text style={[stType.display, stShadow, { fontSize: 40, lineHeight: 44, color: '#fff' }]}>{t('tagged_out')}</Text>
        )}
        <View style={{ alignItems: 'center', gap: 8 }} pointerEvents="none">
          <Text style={styles.deadLabel}>{snd ? t('back_next_round') : t('back_in')}</Text>
          {snd ? (
            <Text style={[stType.body, stShadow, { textAlign: 'center' }]}>{t('snd_no_respawn')}</Text>
          ) : (
            <>
              <Text style={styles.deadCount}>{respawnSecs ?? ''}</Text>
              <View style={styles.deadTrack}><View style={[styles.deadFill, { width: `${pct * 100}%` }]} /></View>
              <Text style={[stType.small, { color: 'rgba(242,244,247,0.8)' }]}>{t('spawn_shield', { n: Math.round(engine.SPAWN_PROTECT_MS / 1000) })}</Text>
            </>
          )}
        </View>
        <View style={styles.deadButtons} pointerEvents="box-none">
          {onChangeWeapon ? (
            <Pressable onPress={onChangeWeapon} style={({ pressed }) => [styles.deadBtn, pressed && { opacity: 0.8 }]} accessibilityRole="button" accessibilityLabel={t('change_weapon_a11y')}>
              <Svg width={16} height={16} viewBox="0 0 24 24" fill="none"><Path d="M12 3v18M3 12h18" stroke="#fff" strokeWidth={2} /><Rect x={3} y={3} width={18} height={18} rx={9} stroke="#fff" strokeWidth={2} /></Svg>
              <Text style={styles.deadBtnText}>{t('change_weapon')}</Text>
            </Pressable>
          ) : null}
          {killer?.id ? <GameFollowButton userId={killer.id} name={killer.name} style={styles.deadFollow} /> : null}
        </View>
      </View>
    </Animated.View>
  )
}

// Where the person who tagged me was, in words: "24 m behind you".
function relativeWhere(myPos, headingDeg, pos) {
  try {
    if (!myPos || !pos || !Number.isFinite(pos.lat)) return null
    const d = distanceMeters(myPos, pos)
    if (!Number.isFinite(d)) return null
    const a = directionToAngle(myPos, headingDeg, pos)
    const dir = a < 45 || a >= 315 ? 'dir_front' : a < 135 ? 'dir_right' : a < 225 ? 'dir_behind' : 'dir_left'
    return tr(dir, { d: formatDistance(d) })
  } catch { return null }
}

// "Tagged out" marker left where the enemy stood (studio "Kill" board), fades out.
function TagOutMark({ x, y }) {
  const t = useT(S)
  const a = useRef(new Animated.Value(1)).current
  useEffect(() => {
    Animated.sequence([Animated.delay(700), Animated.timing(a, { toValue: 0, duration: 500, useNativeDriver: true })]).start()
  }, [a])
  return (
    <Animated.View pointerEvents="none" style={[styles.tagOut, { left: x - 50, top: y - 10, opacity: a }]}>
      <Svg width={26} height={26} viewBox="0 0 24 24" fill="none">
        <Path d="M5 5l14 14M19 5L5 19" stroke={ST.enemy} strokeWidth={2} />
        <Rect x={2} y={2} width={20} height={20} transform="rotate(45 12 12)" stroke={ST.enemy} strokeWidth={1.4} />
      </Svg>
      <Text style={styles.tagOutText}>{t('tagged_out')}</Text>
    </Animated.View>
  )
}

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
    blastRadius: gun.blastRadius || 0,
  }
}

// Aim rules (compass cone capped at 35°, chance lower inside GPS error, camera matching keeps
// the wide point-blank window) live in laser/aimRules.js, shared with the host.

// Can this enemy be shot at all right now? Within the gun's reach, or so close that GPS can't
// tell you apart (same room).
function withinReach(o, myPos, maxRange) {
  return o.d <= maxRange || o.d <= gpsErr(myPos?.acc, o.pos?.acc)
}

const FREE_LOADOUT = FREE_GUN_IDS.map((id) => getWeapon(id))
const HOST_HIT_MIN_MS = 55 // per-player spam guard on the host, by the SENDER's clock (autos fire up to 12/s)
const STICKY_RESTORE_WINDOW_MS = 30000 // a new host accepts re-sent sticky placements this long
const ROCKET_GAP_MS = engine.ROCKET_GAP_MS
const PLATE_RANGE_M = 45 // GPS nameplates show for enemies this close (or anyone the map reveals)
const HIT_BATCH_MS = 140 // automatic fire: rounds on one target inside this window travel as one action
const ENDLESS_PRESENCE_GRACE_MS = 120000 // arena: keep a player's score through a 2-minute drop (lock screen, call)

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
  // The screen stays on for the whole match: a phone that dims mid-game backgrounds the app
  // (Android then drops the connection).
  useKeepAwake(undefined, { suppressDeactivateWarnings: true })
  useStudioFonts()
  const t = useT(S)
  const insets = useArcadeInsets()
  const snap = useRoomSnapshot(room)
  const positions = useRoomPositions(room)
  const now = useRoomClock(room, 250)
  const loc = useSharedLocation(room)
  const prefs = useGamePrefs()
  const hud = useHudMetrics(insets, { minimap: prefs.minimap !== false })
  const [topH, onTopLayout] = useMeasuredHeight()
  const [dockH, onDockLayout] = useMeasuredHeight()
  const [row1H, onRow1Layout] = useMeasuredHeight()
  const [aboveH, onAboveLayout] = useMeasuredHeight()
  const aim = useAim({ enabled: loc.status === 'granted', override: prefs.aimMode })
  const { loadout, weaponId, select: selectWeapon } = useLoadout()
  const gun = useMemo(() => normalizeGun(getWeapon(weaponId)), [weaponId])
  const gunNameRef = useRef('')
  gunNameRef.current = gun?.name || 'Gun'
  const [camPerm] = useCameraGate()
  const [marker, setMarker] = useState(null)
  const [shotsBy, setShotsBy] = useState({})
  const [wheelOpen, setWheelOpen] = useState(false)
  const [scoresOpen, setScoresOpen] = useState(false)
  const [holding, setHolding] = useState(null) // 'plant' | 'defuse' while I hold the S&D button
  const [alert, setAlert] = useState(null)
  const markerTimer = useRef(null)
  const alertTimer = useRef(null)
  const lastShotByPlayer = useRef({})
  const shotsRef = useRef(0)
  const cameraRef = useRef(null)
  const vision = useVisionCapture(cameraRef)
  const [bodies, setBodies] = useState(null) // latest detections, preview space (aimAssist.js)
  const bodiesRef = useRef(null)
  bodiesRef.current = bodies
  const [view, setView] = useState({ width: 0, height: 0 })
  const viewRef = useRef(view)
  viewRef.current = view
  const tapAimRef = useRef(null) // { id, rx, ry, x, y } while a tap on a target holds the trigger
  const tapHeldRef = useRef(false)
  // Scope zoom (pinch or the zoom button). Precision guns (sniper, DMR, railgun) go to 4×.
  // Binoculars: look up to 8× with GPS name tags on every enemy; shooting is off while they're up.
  const [bino, setBino] = useState(false)
  // Selfie bubble (front camera) while the back camera aims. Only on phones that can run
  // both cameras at once; otherwise the toggle never shows.
  const dualOk = isDualCameraSupported()
  const [selfieOn, setSelfieOn] = useState(false)
  // Gameplay recording: screen + game sound + your voice, saved to Photos.
  const recOk = isRecordingSupported()
  const [recAt, setRecAt] = useState(null) // start time while recording
  const [recNow, setRecNow] = useState(0)
  useEffect(() => {
    if (!recAt) return undefined
    const t = setInterval(() => setRecNow(Date.now()), 500)
    return () => clearInterval(t)
  }, [recAt])
  const recBusy = useRef(false)
  const toggleRecording = async () => {
    if (recBusy.current) return
    recBusy.current = true
    try {
      if (!recAt) {
        buzz('medium')
        // Your voice: ask for the mic first (Android asks separately from the screen prompt).
        let mic = true
        try { mic = !!(await Camera.requestMicrophonePermissionsAsync())?.granted } catch { mic = false }
        const ok = await startRecording(mic)
        if (ok) { setRecAt(Date.now()); setRecNow(Date.now()) }
      } else {
        buzz('select')
        setRecAt(null)
        const uri = await stopRecording()
        if (uri) {
          const perm = await MediaLibrary.requestPermissionsAsync(true)
          if (perm?.granted) {
            await MediaLibrary.saveToLibraryAsync(uri)
            flash(tr('rec_saved'), true)
          } else {
            flash(tr('rec_perm'), false)
          }
        }
      }
    } catch (e) {
      setRecAt(null)
      flash(tr('rec_failed'), false)
    } finally {
      recBusy.current = false
    }
  }
  // Stop a recording if you leave the game.
  useEffect(() => () => { stopRecording().catch(() => {}) }, [])
  const scope = useScopeZoom(bino ? BINOCULAR_MAX_ZOOM : maxZoomFor(getWeapon(weaponId)), { enabled: !!camPerm?.granted, onChange: () => buzz('select') })
  const toggleBino = () => {
    buzz('select')
    setBino((b) => !b)
  }
  // Runs after the zoom limit has switched (8× for binoculars, the gun's own limit after).
  useEffect(() => { scope.setZoom(bino ? 4 : 1) }, [bino]) // eslint-disable-line react-hooks/exhaustive-deps
  const zoomRef = useRef(1)
  zoomRef.current = scope.zoom || 1
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
  // Safety: no firing / placing at vehicle (or bike) speed.
  const speedLock = useSpeedLock(loc.coords, { enabled: loc.status === 'granted' && !!state && state.phase !== 'ended' })
  const tooFast = speedLock.locked
  const tooFastRef = useRef(false)
  tooFastRef.current = tooFast
  const snd = state?.mode === 'snd' ? state.snd : null

  // Real-time people tracking (target brackets that follow people, aim assist, tap-to-shoot).
  // Older binaries / no native tracker: liveRunning stays false and the still-frame path below
  // does the job as before.
  const liveOn = visionAim && playing && !dead && !bino
  const live = useLiveBodies({ enabled: liveOn, restartKey: dualOk && selfieOn ? 'dual' : 'single' })
  const [liveRunning, setLiveRunning] = useState(false)
  useEffect(() => live.subscribe(() => setLiveRunning(live.running())), [live])

  // Surface scanner: walls / buildings / cover under the crosshair (laser/useSceneDepth.js).
  // The model downloads in the background the first time Laser Tag opens.
  const camAimRef = useRef({})
  camAimRef.current = { pitch: aim.pitch, heading: aim.cameraHeading ?? aim.heading?.deg }
  const depth = useSceneDepth({
    active: true,
    scanning: visionAim && playing && !dead && !bino && !tooFast,
    fast: gun?.id === 'rocket',
    vision,
    getAim: () => camAimRef.current,
  })
  const [coverMarks, setCoverMarks] = useState([]) // scorch marks / COVER sparks on walls (laser/CoverEffects.js)
  const coverMarkId = useRef(0)
  const lastSparkAt = useRef(0)
  const addCoverMark = useCallback((m) => {
    if (!Number.isFinite(m?.bearing) || !Number.isFinite(m?.range)) return
    setCoverMarks((a) => [...a, { ...m, id: ++coverMarkId.current }].slice(-6))
  }, [])
  const removeCoverMark = useCallback((id) => setCoverMarks((a) => a.filter((m) => m.id !== id)), [])
  const [liveLocked, setLiveLocked] = useState(false)
  const onLiveLock = useCallback((id) => setLiveLocked(id != null), [])
  useEffect(() => { if (!liveRunning) setLiveLocked(false) }, [liveRunning])

  useEffect(() => {
    setAudioModeAsync({ playsInSilentMode: true, interruptionMode: 'mixWithOthers' }).catch(() => {})
    return () => releaseWeaponSounds()
  }, [])

  // ---- grenades, sticky bombs, land mines + first-person gun ----
  const grenadeInv = useGrenadeInventory()
  const stickyBombInv = useStickyBombInventory()
  const landMineInv = useLandMineInventory()
  // Sticky bombs: the HOST records each placement (state.stickies); `pendingStickies` are ones
  // sent but not yet in the state. stickyKnown: every placement of mine still live (re-sent
  // to a new host after host migration). stickyAck: the host understands sticky_place.
  const [pendingStickies, setPendingStickies] = useState([])
  const stickyKnown = useRef(new Map())
  const stickyAck = useRef(false)
  const [goneStickies, setGoneStickies] = useState(() => new Set()) // detonated, until the host's state drops them
  const myStickies = useMemo(() => {
    const fromState = (state?.stickies || []).filter((b) => b?.by === meId && b.lat != null && !goneStickies.has(b.id))
    const ids = new Set(fromState.map((b) => b.id))
    return [...fromState, ...pendingStickies.filter((p) => !ids.has(p.id))]
  }, [state?.stickies, pendingStickies, meId, goneStickies])
  const myStickiesRef = useRef([])
  myStickiesRef.current = myStickies
  // Placements the host has stored are confirmed; remember them for host migration.
  useEffect(() => {
    const mine = (state?.stickies || []).filter((b) => b?.by === meId && !goneStickies.has(b.id))
    if (!mine.length) return
    stickyAck.current = true
    for (const b of mine) stickyKnown.current.set(b.id, { id: b.id, lat: b.lat, lng: b.lng })
    const ids = new Set(mine.map((b) => b.id))
    setPendingStickies((a) => (a.some((p) => ids.has(p.id)) ? a.filter((p) => !ids.has(p.id)) : a))
  }, [state?.stickies, meId]) // eslint-disable-line react-hooks/exhaustive-deps
  // A placement the host refused (it said why) drops off after a few seconds. With an older
  // host that never confirms anything, the local ones stay (detonate falls back to sticky_bomb).
  useEffect(() => {
    if (!pendingStickies.length) return undefined
    const t = setInterval(() => {
      if (!stickyAck.current) return
      setPendingStickies((a) => {
        const keep = a.filter((p) => Date.now() - p.at < 8000)
        return keep.length === a.length ? a : keep
      })
    }, 2000)
    return () => clearInterval(t)
  }, [pendingStickies.length])
  // Host migration: the new host's state may predate my last placements, so re-send them.
  useEffect(() => {
    if (!room) return undefined
    let timer = null
    const off = room.emitter.on('host', () => {
      clearTimeout(timer)
      timer = setTimeout(() => {
        try {
          const have = new Set((room.getState()?.stickies || []).map((b) => b.id))
          const items = [...stickyKnown.current.values()].filter((b) => !have.has(b.id))
          if (items.length) room.sendAction({ type: 'sticky_restore', items })
        } catch {}
      }, 2500)
    })
    return () => { off(); clearTimeout(timer) }
  }, [room])
  const battle = useBattleEffects()
  const myPosRef = useRef(null)
  const headingRef = useRef(null)
  const positionsRef = useRef(null)
  positionsRef.current = positions
  const [shotTick, setShotTick] = useState(0)
  const [hitTick, setHitTick] = useState(0) // a shot of yours connected (hit marker)
  const [killTick, setKillTick] = useState(0)
  const [pops, setPops] = useState([]) // floating "+10 HIT" score pops
  const popId = useRef(0)
  const addPop = useCallback((points, label, color) => {
    setPops((a) => [...a, { id: ++popId.current, points, label, color }].slice(-4))
  }, [])
  const removePop = useCallback((id) => setPops((a) => a.filter((p) => p.id !== id)), [])
  const [blastKey, setBlastKey] = useState(0)
  const [killer, setKiller] = useState(null) // who tagged me out last (shown on the death screen with Follow)
  const killerRef = useRef(null)
  killerRef.current = killer
  // Tag-out streak (since my last death) + recent tag-out times for multi-tag medals.
  const [streak, setStreak] = useState(0)
  const streakRef = useRef(0)
  const recentKills = useRef([])
  const [tagOuts, setTagOuts] = useState([]) // "TAGGED OUT" marks where enemies stood
  const plateMarkersRef = useRef([])
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
    kills: state?.players?.[meId]?.kills,
    deaths: state?.players?.[meId]?.deaths,
    alert: (a, ms) => showAlert(localizeUavAlert(a), ms),
    onBeforeCall: () => triggerRef.current?.stop(),
    payload: () => ({ name: uavStateRef.current.state?.players?.[uavStateRef.current.meId]?.name || null }),
    classify: (from) => {
      const { state: s, meId: me, myTeam: team } = uavStateRef.current
      if (!s?.players?.[from] || from === me) return null
      return isEnemy(s, me, team, from) ? 'enemy' : 'team'
    },
  })
  const uavActive = uav.uavActive
  const overlayOpen = wheelOpen || scoresOpen || !!holding || uav.sheetOpen

  // Coaching line under the crosshair: how to fire in the current hold, for the first seconds
  // of a match and for a moment whenever the hold changes.
  const [tipUntil, setTipUntil] = useState(0)
  useEffect(() => { if (playing) setTipUntil(Date.now() + 12000) }, [playing, roundKeyForTip(state)])
  useEffect(() => { setTipUntil((t) => Math.max(t, Date.now() + 4500)) }, [aim.mode])
  const showTip = playing && !dead && now < tipUntil + (room?.clockOffset || 0)

  // My tag-outs: streak, multi-tag / payback medals, and a "TAGGED OUT" mark where they stood.
  const stateRef = useRef(null)
  stateRef.current = state
  const onTagOuts = (names) => {
    try {
      const t0 = Date.now()
      recentKills.current = [...recentKills.current.filter((x) => t0 - x < 4000), ...names.map(() => t0)]
      const n = recentKills.current.length
      streakRef.current += names.length
      setStreak(streakRef.current)
      const s = streakRef.current
      const payback = killerRef.current?.name && names.includes(killerRef.current.name)
      if (n >= 2) battle.addMedal({ title: tr(n === 2 ? 'medal_double' : n === 3 ? 'medal_triple' : 'medal_multi'), sub: tr('medal_multi_sub', { n }) })
      else if (payback) battle.addMedal({ title: tr('medal_payback'), sub: tr('medal_payback_sub', { name: killerRef.current.name }) })
      else if (s === 3 || s === 5 || s === 10) battle.addMedal({ title: tr(s === 3 ? 'medal_roll' : s === 5 ? 'medal_unstoppable' : 'medal_untouchable'), sub: tr('medal_streak_sub', { n: s }) })
      const marks = []
      for (const nm of names) {
        const m = enemyMarkersRef.current.find((e) => e.label === nm) || plateMarkersRef.current.find((e) => e.name === nm && e.inView)
        if (m && Number.isFinite(m.x) && Number.isFinite(m.y)) marks.push({ id: `${t0}-${nm}`, x: m.x, y: m.y })
      }
      if (marks.length) {
        setTagOuts((a) => [...a, ...marks].slice(-4))
        const t = setTimeout(() => setTagOuts((a) => a.filter((x) => !marks.includes(x))), 1300)
        grenadeTimers.current.push(t)
      }
    } catch {}
  }

  // New round/match: fresh shot counter, close round-specific overlays.
  const roundKey = `${state?.round}:${state?.snd?.roundNo ?? 0}`
  useEffect(() => {
    if (state?.snd?.roundNo == null || state.snd.roundNo === 1) {
      shotsRef.current = 0
      streakRef.current = 0
      setStreak(0)
    }
    setHolding(null)
    // A new S&D round (or match) clears every placed sticky bomb on the host.
    stickyKnown.current.clear()
    setPendingStickies([])
  }, [roundKey]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!room) return undefined
    const offs = [
      room.onMessage('hit_ok', (d) => {
        setHitTick(Date.now())
        if (d?.killed) setKillTick(Date.now())
        playSfx('hit')
        buzz(d?.killed ? 'success' : 'medium')
        const head = d?.zone === 'head'
        const gunLine = head ? tr('weapon_headshot', { weapon: gunNameRef.current }) : gunNameRef.current
        if (d?.killed) addPop(100, tr('tagged_out'), HUD.red)
        else addPop((d?.hits || 1) * 10 + (head ? 10 : 0), tr(head ? 'pop_headshot' : d?.zone === 'limb' ? 'pop_limb' : 'pop_body'), head ? HUD.gold : '#fff')
        const victims = []
        if (d?.killed) victims.push({ name: d.name, weapon: gunLine })
        for (const sh of Array.isArray(d?.splash) ? d.splash : []) if (sh?.killed) victims.push({ name: sh.name, weapon: tr('weapon_splash', { weapon: gunNameRef.current }) })
        victims.forEach((v) => battle.addKill({ victim: v.name, weapon: v.weapon, points: 100 }))
        // Hit marker + pop + banner say it all; no extra text mid-fight.
        if (victims.length) onTagOuts(victims.map((v) => v.name))
      }),
      room.onMessage('notice', (d) => flash(String(d?.text || ''), false)),
      room.onMessage('grenade_ok', (d) => {
        const hits = Array.isArray(d?.hits) ? d.hits : []
        const kills = hits.filter((h) => h.killed)
        battle.addExplosion('Grenade')
        if (!hits.length) { flash(tr('grenade_missed'), false); return }
        playSfx('hit')
        buzz('success')
        kills.forEach((k) => battle.addKill({ victim: k.name, weapon: tr('w_grenade'), points: 100 }))
        if (kills.length) onTagOuts(kills.map((k) => k.name))
        if (kills.length) flash(tr('grenade_kills', { names: kills.map((k) => k.name).join(', ') }), true)
        else flash(tr('grenade_hits', { hits: hitList(hits) }), true)
      }),
      room.onMessage('rocket_ok', (d) => {
        // The explosion itself was drawn when the rocket landed on this phone; this is the score.
        const hits = Array.isArray(d?.hits) ? d.hits : []
        if (!hits.length) return
        const kills = hits.filter((h) => h.killed)
        setHitTick(Date.now())
        if (kills.length) setKillTick(Date.now())
        playSfx('hit')
        buzz('success')
        hits.forEach((h) => addPop(10 + (h.killed ? 100 : 0), tr(h.killed ? 'tagged_out' : 'pop_splash'), h.killed ? HUD.red : '#fff'))
        kills.forEach((k) => battle.addKill({ victim: k.name, weapon: tr('weapon_splash', { weapon: gunNameRef.current }), points: 100 }))
        if (kills.length) onTagOuts(kills.map((k) => k.name))
        else flash(tr('rocket_hits', { hits: hitList(hits) }), true)
      }),
      room.onMessage('sticky_place_ok', (d) => {
        try {
          stickyAck.current = true
          const id = typeof d?.id === 'string' ? d.id : null
          if (!id) return
          const lat = Number(d.lat)
          const lng = Number(d.lng)
          if (Number.isFinite(lat) && Number.isFinite(lng)) stickyKnown.current.set(id, { id, lat, lng })
          setPendingStickies((a) => a.filter((x) => x.id !== id))
        } catch {}
      }),
      room.onMessage('sticky_bomb_ok', (d) => {
        const hits = Array.isArray(d?.hits) ? d.hits : []
        const kills = hits.filter((h) => h.killed)
        for (const b of Array.isArray(d?.bombs) ? d.bombs : []) if (b?.id) stickyKnown.current.delete(b.id)
        battle.addExplosion('Sticky bomb')
        battle.shake(14)
        if (!hits.length) { flash(d?.count > 1 ? tr('sticky_none', { n: d.count }) : tr('sticky_missed'), false); return }
        playSfx('explosion')
        buzz('success')
        setBlastKey(Date.now())
        kills.forEach((k) => battle.addKill({ victim: k.name, weapon: tr('w_sticky'), points: 100 }))
        if (kills.length) onTagOuts(kills.map((k) => k.name))
        if (kills.length) flash(tr('sticky_kills', { names: kills.map((k) => k.name).join(', ') }), true)
        else flash(tr('sticky_hits', { hits: hitList(hits) }), true)
      }),
      room.onMessage('land_mine_ok', () => {
        buzz('medium')
        flash(tr('mine_placed'), true)
      }),
      room.onMessage('got_hit', (d, from) => {
        const by = String(d?.by || tr('someone')).slice(0, 24)
        const dmg = d?.damage ? ` −${d.damage}` : ''
        const isExplosive = d?.zone === 'grenade' || d?.zone === 'sticky_bomb' || d?.zone === 'land_mine' || d?.zone === 'rocket'
        if (isExplosive) {
          playSfx('explosion'); buzz('heavy'); setBlastKey(Date.now())
          battle.shake(d?.zone === 'land_mine' ? 18 : 14)
          // Land mines show as an arena-wide mega explosion (see the blasts effect below).
          if (d?.zone !== 'land_mine') battle.addExplosion(d?.zone === 'rocket' ? 'Rocket' : d?.zone === 'grenade' ? 'Grenade' : 'Sticky bomb')
        }
        else { playSfx('hit'); buzz('heavy') }
        // Directional hit indicator (from the shooter's position if available; `from` is the
        // host when the message was relayed, so prefer the id the host put in the message).
        try {
          const shooterId = d?.byId || from
          const shooterPos = shooterId ? positionsRef.current?.[shooterId] : null
          const angle = directionToAngle(myPosRef.current, headingRef.current, shooterPos)
          battle.addHit(angle)
        } catch {}
        const zoneKey = d?.zone === 'grenade' ? 'w_grenade' : d?.zone === 'sticky_bomb' ? 'w_sticky' : d?.zone === 'land_mine' ? 'w_mine' : d?.zone === 'head' ? 'w_headshot' : d?.zone === 'rocket' ? 'w_rocket' : 'w_hit'
        const zoneLabel = tr(zoneKey)
        const outKey = d?.zone === 'grenade' ? 'out_by_grenade' : d?.zone === 'sticky_bomb' ? 'out_by_sticky' : d?.zone === 'land_mine' ? 'out_by_mine' : 'out_by'
        if (d?.killed) {
          flash(tr(outKey, { name: by }), false)
          const kid = typeof d?.byId === 'string' ? d.byId : null
          // Killer card: weapon, where they were, how much HP they had left.
          let weapon = null
          try { weapon = typeof d?.weapon === 'string' ? getWeapon(d.weapon)?.name || null : null } catch { weapon = null }
          if (zoneKey !== 'w_hit') weapon = weapon && zoneKey === 'w_headshot' ? tr('weapon_headshot', { weapon }) : zoneLabel
          const kpos = kid ? positionsRef.current?.[kid] : null
          const kst = kid ? stateRef.current?.players?.[kid] : null
          setKiller({ id: kid, name: by, weapon, where: relativeWhere(myPosRef.current, headingRef.current, kpos), hpLeft: Number.isFinite(kst?.hp) ? kst.hp : null })
          streakRef.current = 0
          setStreak(0)
          recentKills.current = []
        }
        else flash(`${tr('hit_by', { what: zoneLabel, name: by })}${dmg}`, false)
      }),
      room.onMessage('bystander_ok', (d) => {
        try {
          const userId = typeof d?.userId === 'string' ? d.userId : null
          if (!userId) return
          playSfx('hit')
          buzz('success')
          flash(tr('bystander_tagged', { user: String(d.username || 'iyiyi').slice(0, 24), n: d.points || engine.BYSTANDER_POINTS }), true)
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
  }, [room, flash, addPop])

  // Arena blasts (land mines): every player sees a huge explosion in the direction it went off,
  // and the mine's owner gets a kill banner / hit notice.
  const seenBlastsRef = useRef(null)
  const blastsKey = (state?.blasts || []).map((b) => b.id).join(',')
  useEffect(() => {
    const list = state?.blasts || []
    if (!seenBlastsRef.current) { seenBlastsRef.current = new Set(list.map((b) => b.id)); return } // ignore old ones on join
    for (const b of list) {
      if (!b?.id || seenBlastsRef.current.has(b.id)) continue
      seenBlastsRef.current.add(b.id)
      try {
        const hits = Array.isArray(b.hits) ? b.hits : []
        const iWasHit = hits.some((h) => h.id === meId)
        const mine = b.by === meId
        const myPos = myPosRef.current
        const pos = b.lat != null && b.lng != null ? { lat: b.lat, lng: b.lng } : null
        const dist = myPos && pos ? distanceMeters(myPos, pos) : null
        const angle = myPos && pos ? directionToAngle(myPos, headingRef.current, pos) : 0
        battle.addMegaExplosion({ label: 'Land mine', angle: iWasHit ? 0 : angle, dist: iWasHit ? 0 : dist, by: mine ? tr('your_mine') : b.byName ? tr('mine_of', { name: b.byName }) : null })
        if (!iWasHit) { playSfx('explosion'); buzz(mine || (dist != null && dist < 60) ? 'heavy' : 'medium') }
        if (mine) {
          const killed = hits.filter((h) => h.killed)
          killed.forEach((h) => battle.addKill({ victim: h.name, weapon: tr('w_mine'), points: 100 }))
          const wounded = hits.filter((h) => !h.killed)
          if (wounded.length) flash(tr('mine_hits', { hits: hitList(wounded) }), true)
          else if (!killed.length) flash(tr('mine_went_off'), true)
        }
      } catch {}
    }
  }, [blastsKey]) // eslint-disable-line react-hooks/exhaustive-deps

  // Battle effects: flash + tracer for every enemy shot, directional hit indicator when I take damage.
  useEffect(() => {
    if (!room) return undefined
    const off = room.onMessage('lt_shot', (d, from) => {
      try {
        if (from === meId) return
        const shooterPos = (d?.lat != null && d?.lng != null) ? { lat: d.lat, lng: d.lng } : positions?.[from]
        const angle = directionToAngle(myPosRef.current, headingRef.current, shooterPos)
        battle.addFlash(angle)
        battle.addTracer(angle)
        battle.addBullet(angle)
      } catch {}
    })
    return off
  }, [room, meId, positions, battle])

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

  // Tagged out (however it happened): the streak ends.
  useEffect(() => {
    if (!dead) return
    streakRef.current = 0
    recentKills.current = []
    setStreak(0)
  }, [dead])

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
      showAlert({ title: tr('bomb_planted_at', { site: snd.bomb.site }), sub: attacker ? tr('defend_bomb_for', { n: Math.round(engine.BOMB_MS / 1000) }) : tr('get_to_defuse', { site: snd.bomb.site }), color: attacker ? ST.objective : ST.enemy, icon: 'flag' }, 4500)
    } else if (bombState === 'defused') {
      playSfx('defused')
      buzz('success')
      showAlert({ title: tr('bomb_defused'), sub: attacker ? tr('they_stopped') : tr('nice_work'), color: attacker ? ST.enemy : ST.friendly, icon: 'shield-checkmark' })
    } else if (bombState === 'exploded') {
      playSfx('explosion')
      buzz('heavy')
      showAlert({ title: tr('bomb_exploded'), color: attacker ? ST.friendly : ST.enemy, icon: 'flame' })
    } else if (bombState === 'dropped' && attacker) {
      showAlert({ title: tr('bomb_dropped'), sub: tr('walk_pick_up'), color: ST.objective, icon: 'flag-outline' })
    }
  }, [bombEventKey]) // eslint-disable-line react-hooks/exhaustive-deps

  // Announcer: you're the bomb carrier / someone is planting or defusing.
  const carrierIsMe = snd?.bomb?.state === 'carried' && snd.bomb.carrier === meId && state?.phase !== 'roundEnd'
  useEffect(() => {
    if (!carrierIsMe) return
    buzz('warning')
    showAlert({ title: tr('you_have_bomb'), sub: tr('get_to_plant', { sites: snd.sites.map((x) => tr('site_n', { id: x.id })).join(tr('list_or')) }), color: ST.objective, icon: 'flag' }, 4500)
  }, [carrierIsMe, state?.round, snd?.roundNo]) // eslint-disable-line react-hooks/exhaustive-deps
  const actAlertKey = snd?.act && snd.act.by !== meId ? `${snd.act.kind}:${snd.act.startedAt}` : null
  useEffect(() => {
    if (!actAlertKey || !snd?.act) return
    const mine = myTeam && state.players[snd.act.by]?.team === myTeam
    if (snd.act.kind === 'plant' && !mine) { buzz('warning'); showAlert({ title: tr('they_planting', { site: snd.act.site }), sub: tr('stop_them'), color: ST.enemy, icon: 'warning' }, 2500) }
    else if (snd.act.kind === 'defuse' && !mine) { buzz('warning'); showAlert({ title: tr('they_defusing'), sub: tr('get_back_site', { site: snd.bomb?.site || '' }), color: ST.enemy, icon: 'warning' }, 2500) }
  }, [actAlertKey]) // eslint-disable-line react-hooks/exhaustive-deps

  const bombSecs = bombState === 'planted' ? Math.max(0, Math.ceil(((snd?.bomb?.explodesAt || now) - now) / 1000)) : null
  useEffect(() => {
    if (bombSecs == null || bombSecs <= 0) return
    if (bombSecs <= 10 || bombSecs % 5 === 0) playSfx('beep', { volume: bombSecs <= 10 ? 1 : 0.6 })
  }, [bombSecs])

  // The plant/defuse the host is running for me (the hold button watches it).
  const myActKey = snd?.act?.by === meId ? snd.act.startedAt : null

  // ---- host ----
  const posOf = (id) => room.freshPosition(id)
  const hostSinceRef = useRef(0)
  useEffect(() => {
    if (!room) return undefined
    if (room.isHost?.()) hostSinceRef.current = Date.now()
    return room.emitter.on('host', () => { try { if (room.isHost()) hostSinceRef.current = room.now() } catch {} })
  }, [room])
  useHostLoop(room, isHost, {
    onTick: () => {
      let s = room.getState()
      const t = room.now()
      const roundNo = room.info.round || 0
      if (roundNo > 0 && (!s || s.game !== 'lasertag' || s.round !== roundNo)) {
        room.publishState(engine.initialState(room.roster, room.info, t))
        return
      }
      if (!s) return
      // Just took over from another host mid-match: the state's timestamps (round clock,
      // bomb fuse, a plant/defuse in progress) are on their clock, so move them onto mine.
      if (room.lastStateFrom && room.lastStateFrom !== room.me?.id && Math.abs(room.clockOffset || 0) > 750) {
        s = engine.rebaseClock(s, -room.clockOffset)
        room.publishState(s)
      }
      const presentIds = room.presentIds(s.endless ? ENDLESS_PRESENCE_GRACE_MS : undefined)
      const synced = engine.syncEndlessPlayers(s, room.roster, presentIds, t)
      const next = engine.tick(synced, { now: t, presentIds, posOf })
      if (next !== s) {
        room.publishState(next)
        // Tell each land-mine victim whose mine it was (one blast entry per detonation).
        if (next.blasts?.length && next.blasts !== synced.blasts) {
          const old = new Set((synced.blasts || []).map((b) => b.id))
          for (const b of next.blasts) {
            if (old.has(b.id)) continue
            for (const h of b.hits || []) {
              const victimMsg = { by: b.byName || tr('someone'), byId: b.by, zone: 'land_mine', damage: h.damage, killed: h.killed }
              if (h.id === meId) room.emitter.emit('msg:got_hit', victimMsg, b.by)
              else room.queue('got_hit', victimMsg, { to: h.id })
            }
          }
        }
      }
    },
    onAction: (action, from, sentAt) => {
      const s = room.getState()
      if (!s || s.game !== 'lasertag') return
      const t = room.now()
      if (action?.type === 'hit' || action?.type === 'shot' || action?.type === 'rocket') {
        // Generic spam guard by the sender's own trigger time (monotonic per phone; arrival
        // times are bursty). Per-weapon cycles (rocket 3 s, sniper 1 s) are the engine's.
        const key = Number.isFinite(action.firedAt) ? action.firedAt : Number.isFinite(sentAt) ? sentAt : t
        if (key - (lastShotByPlayer.current[from] || 0) < HOST_HIT_MIN_MS) return
        lastShotByPlayer.current[from] = key
      }
      // Re-sent sticky placements are only taken just after this phone became the host.
      if (action?.type === 'sticky_restore' && t - (hostSinceRef.current || 0) > STICKY_RESTORE_WINDOW_MS) return
      const { state: next, reply, notify } = engine.applyAction(s, action, from, { now: t, posOf })
      if (next !== s) room.publishState(next)
      if (__DEV__ && action?.type === 'hit' && next === s && !reply) console.warn('[lasertag] hit dropped', from, action.target, s.phase)
      // Tell everyone who got hit who did it (their phone already rumbles from the HP drop);
      // zone 'rocket' / 'grenade' / 'sticky_bomb' makes their phone show the explosion.
      for (const n of Array.isArray(notify) ? notify : []) {
        if (!n?.to || !n.data) continue
        if (n.to === meId) room.emitter.emit('msg:got_hit', n.data, from)
        else room.queue('got_hit', n.data, { to: n.to })
      }
      if (reply) {
        if (from === meId) room.emitter.emit(`msg:${reply.type}`, reply.data, meId)
        else room.queue(reply.type, reply.data, { to: from })
      }
    },
  }, 300)

  // ---- aiming ----
  const myPos = loc.coords
  const heading = aim.heading
  myPosRef.current = myPos
  headingRef.current = heading?.deg
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
      if (!o.alive || !withinReach(o, myPos, visionAim ? gun.range : Math.min(gun.range, COMPASS_MAX_RANGE_M))) continue
      const tol = compassTolerance(o.d, myPos.acc, o.pos.acc, heading.accuracy)
      const off = Math.abs(angleDiff(o.bearing, heading.deg))
      if (off > tol) continue
      const ratio = off / tol
      if (!best || ratio < best.ratio) best = { ...o, ratio, chance: hitChance(o.d, gun.accuracy, ratio, gpsErr(myPos.acc, o.pos.acc)) }
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
  btCtx.current = { fromName: myState?.name || snap?.me?.username || tr('someone'), code: snap?.code || null }
  const btLast = useRef({}) // userId -> last tag time (local mirror of the host's 60 s cap)
  useTaggablePrompt(!!state)

  const aimRef = useRef({})
  aimRef.current = { pos: myPos, heading }
  const enemiesRef = useRef([])
  enemiesRef.current = enemies
  const inSightsRef = useRef(null)
  inSightsRef.current = inSights

  // Still-frame target lock (no live tracker): detect people in the camera view ~2.5×/s (setting).
  const lockOn = visionAim && prefs.targetLock && playing && !dead && !holding && !bino && !liveRunning
  useEffect(() => {
    if (!lockOn) { if (!liveRunning) setBodies(null); return undefined }
    let cancelled = false
    const t = setInterval(() => {
      if (vision.busy()) return
      vision.capture().then((r) => { if (!cancelled && r) setBodies(viewBodiesFromStill(r.bodies, viewRef.current)) })
    }, 400)
    return () => { cancelled = true; clearInterval(t) }
  }, [lockOn]) // eslint-disable-line react-hooks/exhaustive-deps

  // Live tracker -> `bodies` (enemy markers, lock state) a few times a second; the brackets
  // themselves follow the tracker at its own rate (LiveTargetBrackets).
  useEffect(() => {
    if (!liveRunning || !liveOn) return undefined
    let lastSig = ''
    const t = setInterval(() => {
      try {
        const vb = viewBodiesFromLive(live.get())
        const sig = vb.map((b) => `${b.id}:${Math.round(b.box.x * 80)},${Math.round(b.box.y * 80)},${Math.round(b.box.w * 80)},${b.head ? 1 : 0}`).join('|')
        if (sig === lastSig) return
        lastSig = sig
        setBodies(vb.length ? vb : null)
      } catch {}
    }, 250)
    return () => { clearInterval(t); setBodies(null) }
  }, [liveRunning, liveOn, live])

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
        const by = pickBystander({ body: angularBody(b, view), users: bystandersRef.current, participants: participantsRef.current, myPos: h.pos, headingDeg: h.heading.deg })
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
        body: angularBody(b, view),
        tolerance: visionTolerance,
      })
      const t = picked?.target
      if (!t || seen.has(t.id)) continue
      seen.add(t.id)
      const r = scope.zoomRect(photoRectToScreen(b.head || b.box, b, view), view)
      if (!Number.isFinite(r.left + r.width / 2) || !Number.isFinite(r.top)) continue // NaN in a native-driven spring
      // Role colour (kit): every enemy is red, whatever their team is called.
      out.push({ id: t.id, x: r.left + r.width / 2, y: r.top, color: ST.enemy, label: t.name, d: t.d, hp: t.hp })
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

  // Hits go to the host as one action per trigger pull, except automatic fire, where rounds
  // on the same target within a short window are sent together (fewer messages per second
  // on the room; the host counts `hits`).
  const hitQueue = useRef({ key: null, action: null, timer: null })
  const flushHits = useCallback(() => {
    const q = hitQueue.current
    clearTimeout(q.timer)
    q.timer = null
    if (q.action) {
      try { room.sendAction(q.action) } catch {}
    }
    q.key = null
    q.action = null
  }, [room])
  useEffect(() => () => { try { flushHits() } catch {} }, [flushHits]) // a pending batch still counts when you leave
  // New-style actions carry the heading (+ accuracy) so the host can re-check the bearing and
  // roll compass hits itself. A compass pull this phone's dice call a miss goes as 'shot' (the
  // host still rolls it; an older host ignores the type, so it never counts as a hit there).
  const aimFields = () => {
    const h = aimRef.current?.heading
    return Number.isFinite(h?.deg) ? { heading: Math.round(h.deg * 10) / 10, headingAcc: h.accuracy } : {}
  }
  const sendHit = (targetId, { hits, shots = hits, zone = 'body', method, firedAt = Date.now(), snap = false }) => {
    const action = { type: hits > 0 ? 'hit' : 'shot', target: targetId, hits: Math.max(0, hits), shots: Math.max(1, shots), zone, method, weapon: gun.id, firedAt, ...aimFields(), ...(snap ? { snap: true } : {}) }
    if (!gun.automatic) { room.sendAction(action); return }
    const q = hitQueue.current
    const key = `${targetId}:${zone}:${gun.id}:${method}`
    if (q.action && q.key === key) {
      q.action.hits = Math.min(5, q.action.hits + action.hits)
      q.action.shots = Math.min(5, q.action.shots + action.shots)
      if (q.action.hits > 0) q.action.type = 'hit'
      return
    }
    if (q.action) flushHits()
    q.key = key
    q.action = action
    q.timer = setTimeout(flushHits, HIT_BATCH_MS)
  }

  // Compass / GPS aim: the enemy nearest your heading (cone capped at 35°). The host rolls the
  // hit; this phone's roll only decides the message type (see sendHit).
  // `snap` = camera mode with no person under the crosshair (lower chance).
  const fireCompass = (shots, snap = false, firedAt = Date.now()) => {
    const target = inSightsRef.current
    if (!target) { flash(tr(snap ? 'miss' : 'no_one_sights'), false); return }
    const chance = target.chance * (snap ? 0.6 : 1)
    let hits = 0
    for (let i = 0; i < shots; i++) if (Math.random() < chance) hits += 1
    sendHit(target.id, { hits, shots, zone: 'body', method: 'compass', firedAt, snap })
  }

  // Where the hip-fire radar is on screen (its centre = you, top = the top edge of the phone).
  const radarGeoRef = useRef(null)
  const [radarAt, setRadarAt] = useState(null) // the radar's offset inside the hip-fire column
  const lastPullRef = useRef({}) // gun id -> last trigger pull (client copy of the host's cycle)

  // One trigger pull. Unlimited ammo; slow weapons keep their cycle (rocket 1 per 3 s).
  const fireShot = () => {
    if (dead || !playing) return
    if (tooFastRef.current) { flash(speedLockText(), false); return }
    const gap = gun.id === 'rocket' ? Math.max(ROCKET_GAP_MS, minShotGapMs(gun)) : minShotGapMs(gun)
    const t0 = Date.now()
    if (gap > 0 && t0 - (lastPullRef.current[gun.id] || 0) < gap) {
      if (gun.id === 'rocket') flash(tr('reloading', { n: Math.ceil((gap - (t0 - lastPullRef.current[gun.id])) / 1000) }), false)
      return
    }
    lastPullRef.current[gun.id] = t0
    if (gun.id === 'rocket') { fireRocket(t0); return }
    const shots = gun.shotsPerClick
    shotsRef.current += shots
    setShotTick((n) => n + 1)
    try {
      if (aim.mode === 'top') {
        // Hip fire: the radar is a top-down map, so the bolt flies flat from the centre (you)
        // to the locked enemy's diamond, or straight up to the radar's top edge.
        const g = radarGeoRef.current
        if (g) battle.addOutgoing(leftHanded, hipTargetPoint(g, inSightsRef.current), { x: g.cx, y: g.cy }, gun.id, { flat: true })
      } else {
        // The bolt leaves the gun's barrel (trigger mode, no gun drawn: bottom centre) and
        // flies into the scene toward the enemy you're aiming at (or down the crosshair).
        const from = aim.mode === 'camera'
          ? muzzlePoint({ gun, width: view.width || 0, height: view.height || 0, bottom: dockH || 0, leftHanded })
          : { x: (view.width || 0) / 2, y: (view.height || 0) * 0.94 }
        // Cover: the surface scanner sees a wall clearly nearer than the target in your sights
        // (and no person under the crosshair): the bolt stops on the wall with a COVER spark.
        // Visual only; the shot still goes to the host, which decides the hit.
        const cover = coverForShot()
        battle.addOutgoing(leftHanded, cover ? { x: (view.width || 0) / 2, y: (view.height || 0) / 2 } : aimPointRef.current, from, gun.id)
        if (cover) {
          const t0s = Date.now()
          if (t0s - lastSparkAt.current >= 250) {
            lastSparkAt.current = t0s
            setTimeout(() => addCoverMark({ kind: 'spark', bearing: cover.bearing, elev: cover.elev, range: cover.range }), 300)
          }
        }
      }
    } catch {}
    playShot(gun)
    buzz(gun.automatic ? 'light' : 'medium') // recoil rumble (respects the Vibration setting)
    const h = aimRef.current
    broadcastShot(h.pos)
    if (!h.pos || !h.heading) { flash(tr('no_fix'), false); return }
    const firedAt = t0 // the host rate-limits on this, not on when the camera frame resolved
    if (visionAim) { fireVision(shots, firedAt, tapAimRef.current).catch(() => fireCompass(shots, true, firedAt)); return }
    fireCompass(shots, false, firedAt)
  }

  // Laser shot into cover (visual only): { bearing, elev, range } or null.
  const coverForShot = () => {
    try {
      const target = inSightsRef.current
      if (!target || !(target.d > 0)) return null
      const camAim = camAimRef.current || {}
      const surface = depth.surface(camAim)
      if (!surface) return null
      let seen = false
      try {
        const vb = live.running() ? viewBodiesFromLive(live.get()) : (bodiesRef.current || [])
        seen = !!pickShot(vb, tapAimRef.current)
      } catch { seen = false }
      const c = laserCover({ targetDist: target.d, surface, lineOfSight: seen })
      if (!c) return null
      return { bearing: camAim.heading, elev: Number.isFinite(camAim.pitch) ? camAim.pitch : 0, range: c.range }
    } catch {
      return null
    }
  }

  // Rocket: a visible projectile that ALWAYS explodes where it lands — at the target on a
  // hit, otherwise at the impact distance: the locked target's distance, else where the
  // camera's centre ray meets the ground when pitched down, else a 25 m "wall". With the
  // surface scanner, a wall / building / cover under the crosshair that is nearer than the
  // target (or any wall when there's no target) stops it there: it explodes on the wall
  // (+ a scorch mark) and goes to the host as a plain 'rocket' at that distance, so the
  // splash is worked out at the wall. A person the camera sees is in line of sight (no cover).
  // Every rocket goes to the host so misses splash too.
  const fireRocket = (firedAt) => {
    shotsRef.current += 1
    setShotTick((n) => n + 1)
    const h = aimRef.current
    const hipFire = aim.mode === 'top'
    // Who it's going at: a tracked person under the crosshair (live tracker), else the compass lock.
    let lock = null
    let screen = null
    try {
      if (!hipFire && visionAim && live.running()) {
        const hit = pickShot(viewBodiesFromLive(live.get()), tapAimRef.current)
        if (hit) {
          const picked = pickVisionTarget({
            opponents: enemiesRef.current.map((e) => ({ ...e, alive: e.alive && !((e.protectedUntil || 0) > room.now()) })),
            myPos: h.pos, headingDeg: h.heading?.deg, headingAcc: h.heading?.accuracy, body: angularBody(hit.body, viewRef.current), tolerance: visionTolerance,
          })
          if (picked?.target) lock = { id: picked.target.id, d: picked.distance, method: 'vision', zone: hit.zone }
          const r = scope.zoomRect(photoRectToScreen(hit.body.box, hit.body, viewRef.current), viewRef.current)
          if (Number.isFinite(r?.left) && Number.isFinite(r?.top)) screen = { x: r.left + r.width / 2, y: r.top + r.height * 0.45 }
        }
      }
    } catch { lock = null }
    const compass = inSightsRef.current
    if (!lock && compass) lock = { id: compass.id, d: compass.d, method: 'compass', zone: 'body', chance: compass.chance }
    const camAim = camAimRef.current || {}
    let surface = null
    try { surface = hipFire ? null : depth.surface(camAim) } catch { surface = null }
    const impact = rocketImpactWithCover({ targetDist: lock?.d, pitchDeg: aim.pitch, hipFire, range: gun.range, surface, lineOfSight: lock?.method === 'vision' })
    const covered = impact.why === 'cover' && !hipFire
    // The projectile.
    try {
      const onImpact = () => {
        playSfx('explosion'); buzz('heavy'); setTimeout(() => buzz('heavy'), 140)
        if (covered) {
          addCoverMark({ kind: 'scorch', bearing: camAim.heading, elev: Number.isFinite(camAim.pitch) ? camAim.pitch : 0, range: surface?.range ?? impact.dist })
          flash(tr('rocket_cover', { n: Math.round(impact.dist) }), false)
        }
      }
      if (hipFire) {
        const g = radarGeoRef.current
        if (g) {
          const to = lock ? hipTargetPoint(g, { ...compass, d: lock.d }) : { x: g.cx, y: g.cy - g.r * Math.min(1, impact.dist / Math.max(1, g.rangeM)) }
          battle.addRocket({ from: { x: g.cx, y: g.cy }, to, dist: impact.dist, flat: true, onImpact })
        }
      } else {
        const from = aim.mode === 'camera'
          ? muzzlePoint({ gun, width: view.width || 0, height: view.height || 0, bottom: dockH || 0, leftHanded })
          : { x: (view.width || 0) / 2, y: (view.height || 0) * 0.94 }
        const ap = aimPointRef.current
        const centre = { x: (view.width || 0) / 2, y: (view.height || 0) / 2 }
        // Into cover: it explodes on the wall under the crosshair.
        const to = covered ? centre : screen || (lock && ap ? ap : centre)
        battle.addRocket({ from, to, dist: impact.dist, onImpact })
      }
    } catch {}
    playShot(gun)
    buzz('heavy')
    broadcastShot(h.pos)
    if (!h.pos || !h.heading) { flash(tr('rocket_wasted'), false); return }
    try {
      if (lock && !covered) {
        let hits = 1
        if (lock.method === 'compass') hits = Math.random() < (lock.chance ?? 0.5) ? 1 : 0
        room.sendAction({ type: hits ? 'hit' : 'shot', target: lock.id, hits, shots: 1, zone: lock.zone || 'body', method: lock.method, weapon: 'rocket', dist: Math.round(impact.dist * 10) / 10, firedAt, ...aimFields() })
      } else {
        room.sendAction({ type: 'rocket', weapon: 'rocket', dist: Math.round(impact.dist * 10) / 10, firedAt, ...aimFields() })
      }
    } catch {}
  }
  // Which tracked person a shot goes to: the tapped one (followed by id while the tap holds),
  // else aim assist around the crosshair (laser/aimAssist.js).
  const pickShot = (vb, tap) => {
    const v = viewRef.current || {}
    const opts = { aspect: v.width > 0 && v.height > 0 ? v.width / v.height : 0.5, zoom: Math.max(1, zoomRef.current || 1) }
    if (tap) {
      const same = tap.id != null ? vb.find((b) => b.id === tap.id) : null
      if (same) return { body: same, zone: zoneAtRelative(same, tap.rx, tap.ry), tap: true }
      const again = pickTapTarget(vb, tap.x, tap.y, opts)
      if (again) return { ...again, tap: true }
    }
    return pickAimTarget(vb, opts)
  }

  // A tap on the camera view: the tracked person under it (screen point -> preview space,
  // undoing the scope zoom around the centre), or null.
  const tapTargetAt = (e) => {
    try {
      const v = viewRef.current
      if (!(v?.width > 0) || !(v?.height > 0)) return null
      const lx = Number(e?.nativeEvent?.locationX)
      const ly = Number(e?.nativeEvent?.locationY)
      if (!Number.isFinite(lx) || !Number.isFinite(ly)) return null
      const z = Math.max(1, zoomRef.current || 1)
      const x = 0.5 + (lx / v.width - 0.5) / z
      const y = 0.5 + (ly / v.height - 0.5) / z
      const vb = live.running() ? viewBodiesFromLive(live.get()) : (bodiesRef.current || [])
      const p = pickTapTarget(vb, x, y, { aspect: v.width / v.height, zoom: z })
      if (!p) return null
      return { id: p.body.id ?? null, rx: p.rx, ry: p.ry, x, y }
    } catch {
      return null
    }
  }

  // Camera aim: the person the shot lands on decides the hit. Live tracking answers at once;
  // otherwise (or when it sees nobody near the crosshair) one camera frame is checked, and
  // rapid shots share the in-flight frame instead of queueing more captures. When the camera
  // sees no person the shot falls back to compass aim at a lower chance, so a player right
  // next to you (inside GPS error) can still be hit. GPS + compass pick WHICH player it is;
  // the host validates every hit.
  const fireVision = async (shots, firedAt, tap = null) => {
    let hit = null
    try { if (live.running()) hit = pickShot(viewBodiesFromLive(live.get()), tap) } catch { hit = null }
    if (!hit) {
      const frame = await vision.capture()
      if (!frame) { fireCompass(shots, true, firedAt); return }
      const vb = viewBodiesFromStill(frame.bodies, viewRef.current)
      if (!live.running()) setBodies(vb.length ? vb : null)
      hit = pickShot(vb, tap)
    }
    if (!hit) { fireCompass(shots, true, firedAt); return }
    const body = angularBody(hit.body, viewRef.current)
    const h = aimRef.current
    let by = null
    try {
      by = pickBystander({ body, users: bystandersRef.current, participants: participantsRef.current, myPos: h.pos, headingDeg: h.heading?.deg })
    } catch {
      by = null
    }
    if (by) { tagBystander(by.user); return }
    const picked = pickVisionTarget({
      opponents: enemiesRef.current.map((e) => ({ ...e, alive: e.alive && !((e.protectedUntil || 0) > room.now()) })),
      myPos: h.pos,
      headingDeg: h.heading?.deg,
      headingAcc: h.heading?.accuracy,
      body,
      tolerance: visionTolerance,
    })
    if (!picked) {
      // A person, but nobody in the match matches that direction: if one enemy is in your
      // sights by compass, count it as them; otherwise it was a bystander.
      if (inSightsRef.current) { sendHit(inSightsRef.current.id, { hits: shots, shots, zone: hit.zone, method: 'vision', firedAt }); return }
      flash(tr('not_player'), false)
      return
    }
    sendHit(picked.target.id, { hits: shots, shots, zone: hit.zone, method: 'vision', firedAt })
  }

  // Throw along the compass heading; it goes off after the fuse, where it landed.
  const throwGrenade = async (distance, how) => {
    try {
    if (dead || !playing) return
    if (tooFastRef.current) { flash(speedLockText(), false); return }
    const h = aimRef.current
    if (!h.pos || !h.heading) { flash(tr('no_fix'), false); return }
    if (!grenadeInv.owner && !(grenadeInv.balance > 0)) { flash(tr('no_grenades_left'), false); return }
    const capKey = `${snap?.code}:${snap?.info?.round}`
    const cap = matchCheck('grenade', capKey)
    if (!cap.ok) { flash(cap.text, false); return }
    const ok = await spendGrenade({ matchKey: capKey })
    if (!ok) { flash(tr('no_grenades_left'), false); return }
    const land = destinationPoint(h.pos, h.heading.deg, distance)
    buzz('medium')
    flash(tr(how === 'swing' ? 'grenade_thrown' : 'grenade_out', { n: distance }), true)
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
    } catch { /* IAP/room error during match */ }
  }

  // Sticky bombs: every tap places one more where you stand (the host records the spot); one
  // DETONATE ALL blows every one of yours at once (the host works out the damage per bomb).
  const stickyBusy = useRef(false) // one placement at a time (spending is async)
  const placeStickyBomb = async () => {
    if (stickyBusy.current) return
    stickyBusy.current = true
    try {
      if (dead || !playing) return
      if (tooFastRef.current) { flash(speedLockText(), false); return }
      const h = aimRef.current
      if (!h.pos) { flash(tr('no_gps'), false); return }
      if (!stickyBombInv.owner && !(stickyBombInv.balance > 0)) { flash(tr('no_sticky_left'), false); return }
      const capKey = `${snap?.code}:${snap?.info?.round}`
      const cap = matchCheck('stickyBomb', capKey)
      if (!cap.ok) { flash(cap.text, false); return }
      const ok = await spendStickyBomb({ matchKey: capKey })
      if (!ok) { flash(tr('no_sticky_left'), false); return }
      const id = `${meId || 'me'}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
      const item = { id, lat: round6(h.pos.lat), lng: round6(h.pos.lng), at: Date.now() }
      setPendingStickies((a) => [...a, item])
      room.sendAction({ type: 'sticky_place', id })
      buzz('medium')
      const n = myStickiesRef.current.length + 1
      flash(n > 1 ? tr('sticky_placed_n', { n }) : tr('sticky_placed'), true)
    } catch { /* IAP / room error */ } finally { stickyBusy.current = false }
  }

  // Detonate every placed sticky bomb.
  const detonateStickyBombs = () => {
    try {
      if (dead || !playing) return
      if (tooFastRef.current) { flash(speedLockText(), false); return }
      const mine = myStickiesRef.current
      if (!mine.length) return
      const hostKnows = stickyAck.current || (stateRef.current?.stickies || []).some((b) => b.by === meId)
      if (hostKnows) room.sendAction({ type: 'sticky_detonate' })
      else room.sendAction({ type: 'sticky_bomb', lat: mine[0].lat, lng: mine[0].lng }) // an older host: one bomb
      stickyKnown.current.clear()
      setPendingStickies([])
      setGoneStickies(new Set(mine.map((b) => b.id)))
      playSfx('explosion')
      buzz('heavy')
      setBlastKey(Date.now())
    } catch {}
  }

  // Drop a land mine at the player's current location.
  const dropLandMine = async () => {
    try {
    if (dead || !playing) return
    if (tooFastRef.current) { flash(speedLockText(), false); return }
    const h = aimRef.current
    if (!h.pos) { flash(tr('no_gps'), false); return }
    if (!landMineInv.owner && !(landMineInv.balance > 0)) { flash(tr('no_mines_left'), false); return }
    const capKey = `${snap?.code}:${snap?.info?.round}`
    const cap = matchCheck('landMine', capKey)
    if (!cap.ok) { flash(cap.text, false); return }
    const ok = await spendLandMine({ matchKey: capKey })
    if (!ok) { flash(tr('no_mines_left'), false); return }
    buzz('medium')
    flash(tr('mine_down'), true)
    room.sendAction({ type: 'land_mine' })
    } catch { /* IAP error */ }
  }

  const tagBystander = (user) => {
    const t = Date.now()
    if (t - (btLast.current[user.id] || 0) < BYSTANDER_COOLDOWN_MS) {
      flash(tr('already_tagged', { user: user.username }), false)
      return
    }
    btLast.current[user.id] = t
    room.sendAction({ type: 'bystander', userId: user.id, username: user.username })
  }

  const trigger = useTrigger(gun, fireShot, { enabled: playing && !dead && !overlayOpen && !bino && !tooFast })
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

  // Android back: close whatever overlay is open first; with nothing open GamePlayScreen's
  // beforeRemove opens the game menu (never exits the match by accident).
  useEffect(() => {
    if (Platform.OS !== 'android') return undefined
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (uav.sheetOpen) { uav.setSheetOpen(false); return true }
      if (mapOpen) { setMapOpen(false); return true }
      if (scoresOpen) { setScoresOpen(false); return true }
      if (wheelOpen) { setWheelOpen(false); return true }
      if (bino) { setBino(false); return true }
      return false
    })
    return () => sub.remove()
  }, [uav.sheetOpen, mapOpen, scoresOpen, wheelOpen, bino]) // eslint-disable-line react-hooks/exhaustive-deps

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
        color: !pl.alive ? '#7a8099' : ST.friendly,
        ring: !!sndS && sndS.bomb?.carrier === id,
      })
    }
    // Your own land mines (only the placer sees them).
    for (const [i, m] of (state.landMines || []).entries()) {
      if (m?.by !== meId || m.lat == null) continue
      pts.push({ id: `mine-${m.placedAt || i}`, pos: { lat: m.lat, lng: m.lng }, kind: 'mine' })
    }
    // Your sticky bombs, waiting to be detonated.
    for (const b of myStickies) pts.push({ id: `sticky-${b.id}`, pos: { lat: b.lat, lng: b.lng }, kind: 'c4' })
    const areas = sndS ? sndS.sites.map((x) => ({ id: x.id, pos: x, r: x.r, color: ST.objective, label: x.id })) : []
    const b = sndS?.bomb
    // A planted bomb is shown to everyone; a dropped one to attackers.
    if (b && (b.state === 'planted' || (b.state === 'dropped' && myTeam === engine.attackingTeam(state))) && b.lat != null) {
      pts.push({ id: 'bomb', pos: b, color: b.state === 'planted' ? ST.enemy : ST.objective, label: '!' })
    }
    return { mapPoints: pts, mapAreas: areas }
  }, [state, positions, meId, myTeam, myStickies])
  const area = snap?.info?.settings?.area
  const mapBoundary = useMemo(
    () => (area && Number.isFinite(area.lat) && Number.isFinite(area.lng) && area.r > 0 ? { lat: area.lat, lng: area.lng, r: area.r } : null),
    [area?.lat, area?.lng, area?.r], // eslint-disable-line react-hooks/exhaustive-deps
  )
  const mapHeading = Math.round((heading?.deg ?? 0) / 4) * 4 // coarse: fewer minimap re-renders

  const topMode = aim.mode === 'top'
  const triggerMode = aim.mode === 'trigger'
  const intelPoints = useEnemyIntel({ room, state, positions, meId, myTeam, uavActive, color: ST.enemy })
  // Enemies the map is currently revealing (UAV sweep or a recent shot ping) also get a
  // target tag over their head in the camera view, placed from GPS + compass.
  const revealedMarkers = useMemo(() => {
    try {
      if (!myPos || heading?.deg == null || !(view.width > 0)) return []
      const seenByVision = new Set(enemyMarkers.map((m) => m.id))
      const out = []
      const done = new Set()
      for (const pt of intelPoints) {
        const pid = pt.kind === 'uav' ? pt.pid : typeof pt.id === 'string' && pt.id.startsWith('ping-') ? pt.id.slice(5) : null
        if (!pid || done.has(pid) || seenByVision.has(pid)) continue
        done.add(pid)
        const live = enemies.find((e) => e.id === pid)
        const pos = live?.pos || pt.pos
        if (!pos) continue
        const pl = state?.players?.[pid]
        out.push({
          id: `rev-${pid}`,
          name: pl?.name || tr('enemy'),
          d: distanceMeters(myPos, pos),
          bearing: bearingDeg(myPos, pos),
          color: ST.enemy,
        })
      }
      return binocularMarkers({ players: out, headingDeg: heading.deg, zoom: scope.zoom, view })
    } catch { return [] }
  }, [intelPoints, enemies, enemyMarkers, myPos, heading?.deg, scope.zoom, view, state])
  // Nameplates: every enemy close enough to matter (inside the gun's reach, or inside GPS
  // error = same room) plus anyone the map has revealed, placed from GPS + compass. An
  // enemy the camera has locked on gets the camera marker instead. Point blank, the
  // bearing is noise, so the plate sits on the crosshair instead of jumping around.
  const plateMarkers = useMemo(() => {
    try {
      if (!myPos || heading?.deg == null || !(view.width > 0) || topMode) return []
      const seenByVision = new Set(enemyMarkers.map((m) => m.id))
      const revealed = new Set(revealedMarkers.map((m) => m.id.replace(/^rev-/, '')))
      const list = []
      for (const e of enemies) {
        if (!e.alive || seenByVision.has(e.id)) continue
        const err = gpsErr(myPos.acc, e.pos?.acc)
        const close = e.d <= err
        if (!close && e.d > PLATE_RANGE_M && !revealed.has(e.id)) continue
        list.push({ id: `plate-${e.id}`, name: e.name, d: e.d, bearing: e.bearing, hp: e.hp, close, color: ST.enemy })
      }
      const placed = binocularMarkers({ players: list, headingDeg: heading.deg, zoom: scope.zoom, view })
      return placed.map((m) => (m.close ? { ...m, x: view.width / 2, y: view.height * 0.42, inView: true, side: null } : m))
    } catch { return [] }
  }, [enemies, enemyMarkers, revealedMarkers, myPos, heading?.deg, scope.zoom, view, topMode])
  plateMarkersRef.current = plateMarkers
  // Compass tape pips: the same enemies, by bearing.
  const enemyPips = useMemo(() => plateMarkers.filter((m) => !m.close).map((m) => ({ id: m.id, bearing: m.bearing, color: m.color })), [plateMarkers])
  // S&D objectives on the compass: both bomb sites, and the bomb once it's planted (or
  // dropped, for attackers). Skipped when you're standing on it (the bearing is noise).
  const sndForPips = state?.mode === 'snd' ? state.snd : null
  const compassPips = useMemo(() => {
    if (!sndForPips || !myPos) return enemyPips
    const out = []
    for (const x of sndForPips.sites || []) {
      if (distanceMeters(myPos, x) > (x.r || engine.SITE_RADIUS_M)) out.push({ id: `site-${x.id}`, bearing: bearingDeg(myPos, x), color: ST.objective, label: x.id })
    }
    const b = sndForPips.bomb
    if (b?.lat != null && (b.state === 'planted' || (b.state === 'dropped' && myTeam === engine.attackingTeam(state))) && distanceMeters(myPos, b) > 6) {
      out.push({ id: 'bomb', bearing: bearingDeg(myPos, b), color: b.state === 'planted' ? ST.enemy : ST.objective, label: '!' })
    }
    return [...out, ...enemyPips]
  }, [sndForPips, myPos, myTeam, enemyPips]) // eslint-disable-line react-hooks/exhaustive-deps

  // What you're aiming at: the tagged enemy (camera lock or nameplate) nearest the
  // crosshair, if it's reasonably close. The gun swings toward it and shots fly to it.
  const aimPoint = useMemo(() => {
    const cx = (view.width || 0) / 2
    const cy = (view.height || 0) / 2
    let best = null
    for (const m of [...enemyMarkers, ...plateMarkers.filter((r) => r.inView)]) {
      const y = m.y + 40 // tags sit above the head; aim at the body
      const d = Math.hypot(m.x - cx, y - cy)
      if (d < Math.max(140, (view.width || 0) * 0.42) && (!best || d < best.d)) best = { x: m.x, y, d, id: m.id, dist: m.d }
    }
    return best
  }, [enemyMarkers, plateMarkers, view])
  const aimPointRef = useRef(null)
  aimPointRef.current = aimPoint
  const enemyMarkersRef = useRef([])
  enemyMarkersRef.current = enemyMarkers
  const revealedRef = useRef([])
  revealedRef.current = revealedMarkers
  const allMapPoints = useMemo(() => (intelPoints.length ? [...mapPoints, ...intelPoints] : mapPoints), [mapPoints, intelPoints])
  // Placed explosives to draw on the ground (camera AR + hip-fire radar): all of mine, and my
  // teammates' in the team colour. Enemy explosives stay hidden.
  const groundItems = useMemo(() => {
    const out = []
    try {
      const mateOf = (by) => state && state.mode !== 'ffa' && by !== meId && state.players?.[by]?.team && state.players[by].team === myTeam
      for (const b of myStickies) out.push({ id: `c4-${b.id}`, kind: 'c4', lat: b.lat, lng: b.lng, label: tr('your_c4') })
      for (const b of state?.stickies || []) if (mateOf(b?.by)) out.push({ id: `c4-${b.id}`, kind: 'c4', lat: b.lat, lng: b.lng, label: tr('team_c4', { name: String(state.players[b.by].name || tr('team_word')).toUpperCase() }), color: ST.friendly })
      for (const [i, m] of (state?.landMines || []).entries()) {
        if (m?.lat == null) continue
        if (m.by === meId) out.push({ id: `mine-${m.placedAt || i}-${i}`, kind: 'mine', lat: m.lat, lng: m.lng, label: tr('your_mine') })
        else if (mateOf(m.by)) out.push({ id: `mine-${m.placedAt || i}-${i}`, kind: 'mine', lat: m.lat, lng: m.lng, label: tr('team_mine'), color: ST.friendly })
      }
    } catch {}
    return out
  }, [myStickies, state?.stickies, state?.landMines, state?.mode, meId, myTeam]) // eslint-disable-line react-hooks/exhaustive-deps

  // ---- render ----
  if (!room || !snap) return null
  if (loc.status !== 'granted') return <LocationGate status={loc.status} onExit={onExit} what="Laser Tag" />
  if (!state) return <Spectating text={t('starting')} />
  if (!myState) return <Spectating text={state.endless ? t('arena_drop') : undefined} />

  if (state.phase === 'ended') {
    return (
      <View style={{ flex: 1, paddingTop: insets.top + 44, backgroundColor: ST.ground }}>
        <MatchSummary
          state={state}
          meId={meId}
          roster={snap.roster}
          shotsBy={shotsBy}
          isHost={isHost}
          onPlayAgain={() => room.setInfo({ round: (snap.info.round || 0) + 1 })}
          onExit={onExit}
          bottomInset={insets.bottom}
        />
      </View>
    )
  }

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
  // iOS reports heading accuracy 0–3; Android's SensorManager sits at 1 on most phones.
  const compassLow = !!heading && heading.accuracy < (Platform.OS === 'android' ? 1 : 2)


  // ---- layout (studio "Main" board; see laser/hudLayout.js for the edges) ----
  const tight = hud.compact
  const rootW = view.width || hud.width
  const rootH = view.height || hud.height
  const mapSize = Math.round(Math.max(88, Math.min(116, hud.width * 0.27)))
  const leftColW = tight ? 160 : 172
  const rightColW = tight ? 156 : 170
  const tileSize = tight ? 36 : 38
  const topEdge = hud.top + (topH || 150)
  const dockTop = rootH - hud.bottom - (dockH || 150)
  // Landscape: the dock's two columns sit in the bottom corners, so the middle column
  // (between them) holds the objective / warnings and the hip-fire radar.
  const land = hud.landscape
  const midLeft = land ? hud.side + leftColW + 16 : hud.side
  const midRight = land ? hud.side + rightColW + 16 : hud.side
  const aboveBottom = land ? hud.bottom : hud.bottom + (dockH || 150) + 8
  const aboveTop = rootH - aboveBottom - (aboveH ? aboveH + 4 : 0)
  // The crosshair sits on the true screen centre: camera hits are judged at the frame centre.
  const cx = rootW / 2
  const cy = rootH / 2
  const infoTop = cy + 38
  const infoRoom = aboveTop - infoTop
  const bannerUp = Date.now() - killTick < 2500
  const bombPlanted = bombState === 'planted' && !!snd?.bomb
  const scorePanelW = tight ? 128 : 138
  const viewAspect = view.width > 0 && view.height > 0 ? view.width / view.height : 0.5
  const stillPick = bodies?.length ? pickAimTarget(bodies, { aspect: viewAspect, zoom: scope.zoom || 1 }) : null
  const liveBrackets = liveRunning && prefs.targetLock !== false
  const targetLocked = liveBrackets ? liveLocked : !!stillPick
  const hint = !playing || dead
    ? null
    : topMode
      ? null
      : triggerMode
        ? t(gun.automatic ? 'hint_trig_auto' : 'hint_trig')
        : t(visionAim ? 'hint_vision' : 'hint_compass')
  // Hip fire: what the radar shows (the same enemies the camera view would tag).
  const hipRange = Math.min(gun.range, COMPASS_MAX_RANGE_M)
  const hip = topMode ? (() => {
    try {
      const revealed = new Set(revealedMarkers.map((m) => m.id.replace(/^rev-/, '')))
      const shown = enemies.filter((e) => e.alive && (e.d <= PLATE_RANGE_M || revealed.has(e.id) || e.d <= gpsErr(myPos?.acc, e.pos?.acc)))
      const mates = state.mode === 'ffa' ? [] : Object.keys(state.players)
        .filter((id) => id !== meId && state.players[id].team === myTeam && state.players[id].alive)
        .map((id) => ({ id, p: positions?.[id] }))
        .filter((m) => m.p && Date.now() - m.p.at <= 15000 && myPos)
        .map((m) => ({ id: m.id, d: distanceMeters(myPos, m.p), bearing: bearingDeg(myPos, m.p) }))
      const objectives = snd && myPos ? (snd.sites || []).map((x) => ({ id: `s-${x.id}`, label: x.id, d: distanceMeters(myPos, x), bearing: bearingDeg(myPos, x) })) : []
      const cone = Math.max(6, Math.min(40, compassTolerance(20, myPos?.acc, 10, heading?.accuracy)))
      const top = land ? hud.top + 46 : topEdge + 4
      const avail = aboveTop - top - 8
      const zone = !land && avail - 44 - 60 - 30 - 92 >= 180
      const size = Math.round(Math.max(110, Math.min(rootW - midLeft - midRight - 8, 320, avail - 44 - 60 - 30 - (zone ? 92 : 0))))
      const explosives = myPos ? groundItems.map((g) => ({ id: g.id, kind: g.kind, color: g.color, d: distanceMeters(myPos, g), bearing: bearingDeg(myPos, g) })) : []
      return { shown, mates, objectives, explosives, cone, size, zone, top, height: Math.max(0, avail) }
    } catch { return null }
  })() : null
  // Radar on screen (for hip-fire bolts and rockets): the hip column's corner + the radar's
  // offset inside it (measured).
  if (hip && radarAt) {
    const left = (land ? midLeft : 12) + radarAt.x
    const top = hip.top + radarAt.y
    radarGeoRef.current = { left, top, size: hip.size, cx: left + hip.size / 2, cy: top + hip.size / 2, r: hip.size / 2 - 2, heading: heading?.deg, rangeM: hipRange }
  } else if (!hip) radarGeoRef.current = null

  return (
    <Animated.View style={[styles.fill, battle.shakeStyle]} {...scope.panHandlers}>
      {camPerm?.granted ? (
        <View style={[StyleSheet.absoluteFill, { overflow: 'hidden' }]} onLayout={(e) => setView(e.nativeEvent.layout)}>
          <Animated.View style={[StyleSheet.absoluteFill, { transform: [{ scale: scope.scaleAnim }] }]}>
            {dualOk && selfieOn ? (
              <DualCameraView
                ref={cameraRef}
                style={StyleSheet.absoluteFill}
                selfieEnabled
                selfieFrame={(() => {
                  // The preview is scaled by the zoom around its centre; place the bubble so it
                  // lands on the same spot (and size) on screen at any zoom. It sits on the
                  // left, under the minimap.
                  const z = Math.max(1, scope.zoom || 1)
                  const W = view.width || 390
                  const H = view.height || 844
                  const r = { x: 12, y: Math.max(H * 0.3, Math.min(H * 0.5, topEdge + 8)), w: 104, h: 140 }
                  return [W / 2 + (r.x - W / 2) / z, H / 2 + (r.y - H / 2) / z, r.w / z, r.h / z]
                })()}
                onCameraError={() => { setSelfieOn(false); flash(tr('selfie_unavailable'), false) }}
              />
            ) : (
              <CameraView ref={cameraRef} style={StyleSheet.absoluteFill} facing="back" animateShutter={false} />
            )}
          </Animated.View>
        </View>
      ) : (
        <View style={[StyleSheet.absoluteFill, styles.noCam]} onLayout={(e) => setView(e.nativeEvent.layout)}>
          {camPerm && !camPerm.granted && camPerm.status === 'denied' ? <CameraOff what={t('cam_what')} compact /> : null}
        </View>
      )}

      {/* Hip fire: a radar over a light scrim, so the live camera (the ground, your mines)
          stays visible behind it; without a camera it's the dark radar. */}
      {topMode ? <View style={[StyleSheet.absoluteFill, camPerm?.granted ? styles.hipScrimCam : styles.hipScrim]} pointerEvents="none" /> : null}

      {/* Top-edge and trigger modes: the whole screen is the trigger. */}
      {fullScreenTrigger && !bino && (
        <Pressable
          style={StyleSheet.absoluteFill}
          onPressIn={(e) => {
            // Trigger mode: a tap on a tracked person fires at them; anywhere else fires at
            // the crosshair (with aim assist).
            tapAimRef.current = triggerMode && visionAim ? tapTargetAt(e) : null
            trigger.onPressIn()
          }}
          onPressOut={() => { trigger.onPressOut(); tapAimRef.current = null }}
          disabled={dead || !playing || tooFast}
          accessibilityRole="button"
          accessibilityLabel={t(gun.automatic ? 'fire_a11y_auto' : 'fire_a11y')}
        />
      )}
      {/* Classic camera aim (FIRE button): tapping a target bracket also fires at that person
          (same trigger, so the same fire rate / auto-semi rules). A tap elsewhere does nothing. */}
      {aim.mode === 'camera' && visionAim && !bino && playing && !dead ? (
        <Pressable
          style={StyleSheet.absoluteFill}
          onPressIn={(e) => {
            const t = tapTargetAt(e)
            if (!t) return
            tapAimRef.current = t
            tapHeldRef.current = true
            trigger.onPressIn()
          }}
          onPressOut={() => {
            if (!tapHeldRef.current) return
            tapHeldRef.current = false
            trigger.onPressOut()
            tapAimRef.current = null
          }}
          accessibilityLabel={t('tap_target_a11y')}
        />
      ) : null}

      {/* Target-lock corner brackets around people the camera sees */}
      {visionAim && liveBrackets && view.width > 0 && !topMode && !bino ? (
        <LiveTargetBrackets store={live} view={view} zoom={scope.zoom || 1} zoomRect={scope.zoomRect} onLock={onLiveLock} />
      ) : visionAim && bodies && view.width > 0 && !topMode ? (
        <TargetBrackets
          rects={bodies.map((b, i) => {
            try {
              if (!b?.box) return null
              const r = scope.zoomRect(photoRectToScreen(b.box, b, view), view)
              if (!Number.isFinite(r?.left) || !Number.isFinite(r?.top)) return null
              const locked = stillPick?.body === b
              let head = null
              if (locked && b.head) {
                const h = scope.zoomRect(photoRectToScreen(b.head, b, view), view)
                if (Number.isFinite(h?.left) && Number.isFinite(h?.top)) head = h
              }
              return { key: String(i), left: r.left, top: r.top, width: Math.max(0, r.width), height: Math.max(0, r.height), locked, head }
            } catch { return null }
          }).filter(Boolean)}
        />
      ) : null}
      {bino ? <BinocularFrame zoom={scope.zoom} view={view} /> : null}
      {bino ? (
        <BinocularMarkers
          markers={(() => { try { return binocularMarkers({
            players: enemies.filter((e) => e.alive).map((e) => ({ id: e.id, name: e.name, d: e.d, bearing: e.bearing, color: ST.enemy })),
            headingDeg: heading?.deg,
            zoom: scope.zoom,
            view,
          }) } catch { return [] } })()}
        />
      ) : !topMode ? (
        <>
          <EnemyMarkers markers={enemyMarkers} />
          {camPerm?.granted ? <Nameplates markers={plateMarkers} /> : null}
        </>
      ) : null}
      <BystanderMarkers markers={bystanderMarkers} />
      {camPerm?.granted && !bino && groundItems.length ? (
        <GroundExplosives
          view={view}
          markers={(() => { try { return groundMarkers({
            items: groundItems,
            myPos,
            headingDeg: aim.cameraHeading ?? heading?.deg,
            pitchDeg: aim.pitch ?? (topMode ? -75 : 0),
            zoom: scope.zoom,
            view,
          }) } catch { return [] } })()}
        />
      ) : null}
      {tagOuts.map((m) => <TagOutMark key={m.id} x={m.x} y={m.y} />)}
      {camPerm?.granted && !topMode && coverMarks.length ? (
        <CoverEffects
          marks={coverMarks}
          headingDeg={aim.cameraHeading ?? heading?.deg}
          pitchDeg={aim.pitch ?? 0}
          view={view}
          zoom={scope.zoom}
          onDone={removeCoverMark}
        />
      ) : null}

      {camPerm?.granted && !topMode && !bino && aim.mode === 'camera' ? (
        <GunViewModel gun={gun} shotTick={shotTick} bottom={dockH || 0} hidden={dead} leftHanded={leftHanded} aim={aimPoint} />
      ) : null}
      <GrenadeBlast key={blastKey} visible={!!blastKey} />
      {battle.overlay}
      <ScorePops pops={pops} onDone={removePop} top={cy - 14} />
      <Animated.View pointerEvents="none" style={[styles.vignette, { opacity: vignette }]} />

      {/* Crosshair, on the screen centre (AIM). */}
      {!topMode && !bino ? (
        <View style={[styles.crosshair, { left: cx - 32, top: cy - 32 }]} pointerEvents="none">
          <FpsCrosshair onTarget={!!inSights || enemyMarkers.length > 0 || targetLocked} shotTick={shotTick} hitTick={hitTick} killTick={killTick} size={64} />
        </View>
      ) : null}

      {/* HUD top: score panel + clock, compass tape, minimap + kill feed (see laser/hudLayout.js).
          The top-right corner stays clear for GamePlayScreen's floating buttons. */}
      <View style={[styles.topCol, { top: hud.top, left: hud.side, right: hud.side }]} pointerEvents="box-none" onLayout={onTopLayout}>
        <View style={styles.row1} pointerEvents="box-none" onLayout={onRow1Layout}>
          <ScorePanel
            mode={state.mode}
            teamScore={state.teamScore}
            snd={snd}
            myTeam={myTeam}
            meId={meId}
            players={state.players}
            live={!!state.endless}
            rank={arenaRank?.rank}
            of={arenaRank?.of}
            width={scorePanelW}
            onPress={() => { trigger.stop(); buzz('select'); setScoresOpen(true) }}
          />
          <View style={styles.clockAbs} pointerEvents="none">
            {bombPlanted ? (
              <BombCountdown msLeft={(snd.bomb.explodesAt || now) - now} inline />
            ) : (
              <MatchClock clock={formatClock(timerMs)} live={!!state.endless} kicker={topMode ? t('hip_fire') : null} compact={tight} />
            )}
          </View>
        </View>

        {!topMode ? (
          <View style={styles.rowCenter} pointerEvents="none">
            <CompassTape heading={heading?.deg} pips={compassPips} width={Math.min(240, hud.width - hud.side * 2 - 40)} compact={tight} />
          </View>
        ) : null}

        <View style={styles.row3} pointerEvents="box-none">
          {prefs.minimap && !topMode ? (
            <MapMinimap
              available={mapsAvailable}
              size={mapSize}
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
          {state.feed.length > 0 ? <KillFeed feed={state.feed} max={tight ? 2 : 3} state={state} meId={meId} /> : null}
        </View>
      </View>

      {/* AIM: what's under the crosshair, coaching, notices — just below the crosshair. */}
      {!topMode && infoRoom > 24 ? (
        <View style={[styles.info, { top: infoTop, height: infoRoom }]} pointerEvents="none">
          {!bannerUp && !triggerMode ? (
            <Text style={[styles.sightText, (targetLocked || inSights) && { color: ST.enemy }]} numberOfLines={2}>
              {visionAim
                ? (targetLocked ? t('target_locked') : inSights ? `${inSights.name.toUpperCase()} · ${formatDistance(inSights.d).toUpperCase()}` : enemies.some((e) => e.alive) ? t('camera_aim', { d: formatDistance(VISION_RANGE_M).toUpperCase() }) : t('waiting_gps'))
                : inSights
                  ? `${inSights.name.toUpperCase()} · ${formatDistance(inSights.d).toUpperCase()} · ${Math.round(inSights.chance * 100)}%`
                  : enemies.some((e) => e.alive) ? t('no_target') : t('waiting_gps')}
            </Text>
          ) : null}
          {!bannerUp && triggerMode && targetLocked ? <Text style={[styles.sightText, { color: ST.enemy }]}>{t('target_locked')}</Text> : null}
          {!visionAim && !triggerMode && !bannerUp ? <Text style={styles.aimMode}>{t('compass_aim', { d: formatDistance(Math.min(gun.range, COMPASS_MAX_RANGE_M)).toUpperCase() })}</Text> : null}
          {!!marker && !bannerUp ? <Text style={[styles.marker, { color: marker.good ? ST.health : '#fff' }]} numberOfLines={2}>{stripSymbols(marker.text)}</Text> : null}
          {showTip && !marker && !bannerUp ? (
            <View style={styles.tip}>
              <Ionicons name="information-circle-outline" size={14} color={ST.friendly} />
              <Text style={styles.tipText} numberOfLines={3}>{AIM_MODE_TIPS[aim.mode] || AIM_MODE_TIPS.trigger}</Text>
            </View>
          ) : null}
        </View>
      ) : null}

      {/* HIP FIRE (studio board): top-edge cue, radar with the firing cone, lock + hit chance, fire zone. */}
      {topMode && hip ? (
        <View style={[styles.hip, { top: hip.top, height: hip.height, left: land ? midLeft : 12, right: land ? midRight : 12 }]} pointerEvents="none">
          <View style={{ alignItems: 'center', gap: 4 }}>
            <Svg width={36} height={20} viewBox="0 0 40 22" fill="none"><Path d="M2 20L20 3l18 17" stroke={inSights ? ST.enemy : '#fff'} strokeWidth={2.6} strokeLinejoin="round" /></Svg>
            <Text style={styles.hipCue}>{t('point_top')}</Text>
          </View>
          <View onLayout={(e) => { const l = e.nativeEvent.layout; setRadarAt((p) => (p && Math.abs(p.x - l.x) < 1 && Math.abs(p.y - l.y) < 1 ? p : { x: l.x, y: l.y })) }}>
            <HipFireRadar size={hip.size} heading={heading?.deg} rangeM={hipRange} coneDeg={hip.cone} enemies={hip.shown} mates={hip.mates} objectives={hip.objectives} explosives={hip.explosives} lockedId={inSights?.id} />
          </View>
          <HipFireStatus target={inSights} waiting={!enemies.some((e) => e.alive)} />
          {!!marker ? <Text style={[styles.marker, { marginTop: 0, color: marker.good ? ST.health : '#fff' }]} numberOfLines={1}>{stripSymbols(marker.text)}</Text> : null}
          {hip.zone && playing && !dead ? <HipFireZone auto={gun.automatic} height={84} /> : null}
        </View>
      ) : null}

      {/* Above the dock: S&D objective, warnings, enemy UAV, the fire hint. */}
      <View style={[styles.aboveDock, { bottom: aboveBottom, left: midLeft, right: midRight }]} pointerEvents="box-none" onLayout={onAboveLayout}>
        {tooFast ? (
          <View style={[styles.pillWarn, styles.speedPill]} pointerEvents="none" accessibilityLiveRegion="polite">
            <Ionicons name="speedometer-outline" size={16} color="#fff" />
            <Text style={styles.pillWarnText} numberOfLines={2}>{speedLockText().toUpperCase()}{speedLock.kmh ? ` · ${speedLock.kmh} KM/H` : ''}</Text>
          </View>
        ) : null}
        {objective && (
          <View style={styles.objective} pointerEvents="box-none">
            <Text style={styles.objectiveText} pointerEvents="none" numberOfLines={2}>{stripSymbols(objective.text)}</Text>
            {objective.action && !dead && playing && (
              objective.action.kind === 'pickup' ? (
                <HudCta title={t('pick_up_bomb')} tone="gold" icon="flag" onPress={() => { buzz('medium'); room.sendAction({ type: 'pickup' }) }} style={{ minWidth: 220 }} />
              ) : (
                <HoldActionButton
                  key={`${state.round}:${snd.roundNo}:${objective.action.kind}-${objective.action.site || ''}`}
                  kind={objective.action.kind}
                  site={objective.action.site}
                  holdMs={objective.action.kind === 'plant' ? engine.PLANT_MS : engine.DEFUSE_MS}
                  activeKey={myActKey}
                  color={objective.action.kind === 'plant' ? ST.objective : ST.friendly}
                  onStart={() => {
                    trigger.stop()
                    setHolding(objective.action.kind)
                    room.sendAction(objective.action.kind === 'plant' ? { type: 'plant_start', site: objective.action.site } : { type: 'defuse_start' })
                  }}
                  onDone={() => { setHolding(null); room.sendAction({ type: objective.action.kind === 'plant' ? 'plant_done' : 'defuse_done' }) }}
                  onCancel={() => { setHolding(null); room.sendAction({ type: 'act_cancel' }) }}
                />
              )
            )}
          </View>
        )}
        {uav.enemyMs > 0 ? (
          <View style={styles.pillWarn} pointerEvents="none">
            <Ionicons name="radio-outline" size={14} color={ST.enemy} />
            <Text style={styles.pillWarnText} numberOfLines={1}>{t('enemy_uav', { n: Math.ceil(uav.enemyMs / 1000) })}</Text>
          </View>
        ) : null}
        {outsideArea ? (
          <View style={[styles.pillWarn, { backgroundColor: 'rgba(255,61,82,0.85)' }]} pointerEvents="none">
            <Ionicons name="warning" size={14} color="#fff" />
            <Text style={styles.pillWarnText} numberOfLines={2}>{t('outside_area')}</Text>
          </View>
        ) : null}
        {(myPos?.acc > 20 || compassLow) && (
          <Text style={[styles.warn, { alignSelf: leftHanded ? 'flex-end' : 'flex-start' }]} pointerEvents="none" numberOfLines={2}>
            {myPos?.acc > 20 ? t('weak_gps', { n: Math.round(myPos.acc) }) : t('compass_cal')}
          </Text>
        )}
        {hint && !objective?.action ? <Text style={styles.hint} pointerEvents="none" numberOfLines={1}>{hint}</Text> : null}
      </View>

      {/* Bottom dock: health + equipment on one side, optics / FIRE / weapon on the other. */}
      <View
        style={[styles.dock, { bottom: hud.bottom, left: hud.side, right: hud.side, flexDirection: leftHanded ? 'row-reverse' : 'row' }]}
        pointerEvents="box-none"
        onLayout={onDockLayout}
      >
        <View style={[styles.leftCol, { width: leftColW }]} pointerEvents="box-none">
          {streak > 0 && !dead ? (
            <View style={styles.streak} pointerEvents="none">
              <Text style={stType.label}>{t('streak')}</Text>
              <View style={styles.streakRow}>
                {Array.from({ length: Math.max(3, Math.min(5, streak)) }, (_, i) => (
                  <View key={i} style={[styles.streakPip, { backgroundColor: i < streak ? ST.objective : 'rgba(255,255,255,0.18)' }]} />
                ))}
                {streak > 5 ? <Text style={styles.streakMore}>{streak}</Text> : null}
              </View>
            </View>
          ) : null}
          {!dead ? <DetonateAllButton count={myStickies.length} disabled={!playing || tooFast} onDetonate={detonateStickyBombs} /> : null}
          <View style={[styles.equipRow, { gap: tight ? 5 : 6 }]} pointerEvents="box-none">
            <GrenadeButton
              count={grenadeInv.owner ? Infinity : grenadeInv.balance}
              disabled={!playing || dead || bino || tooFast}
              size={tileSize}
              onThrow={throwGrenade}
              onEmpty={() => flash(t('no_grenades_shop'), false)}
            />
            <StickyBombButton
              count={stickyBombInv.owner ? Infinity : stickyBombInv.balance}
              placedCount={myStickies.length}
              disabled={!playing || dead || bino || tooFast}
              size={tileSize}
              onPlace={placeStickyBomb}
              onEmpty={() => flash(t('no_sticky_shop'), false)}
            />
            <LandMineButton
              count={landMineInv.owner ? Infinity : landMineInv.balance}
              disabled={!playing || dead || bino || tooFast}
              size={tileSize}
              onDrop={dropLandMine}
              onEmpty={() => flash(t('no_mines_shop'), false)}
            />
            <UavButton tile count={uav.count} activeMsLeft={uav.myMs} cooldownMsLeft={uav.cooldownMs} disabled={!playing && !uav.empty} onPress={uav.callUav} size={tileSize} />
          </View>
          <StatusPanel
            hp={myState.hp}
            score={myState.score}
            kills={myState.kills || 0}
            deaths={myState.deaths || 0}
            protectedNow={isProtected}
            compact={tight}
            width={leftColW}
          />
        </View>
        <View style={[styles.rightCol, { alignItems: leftHanded ? 'flex-start' : 'flex-end', maxWidth: Math.max(rightColW, hud.width - hud.side * 2 - leftColW - 8) }]} pointerEvents="box-none">
          {camPerm?.granted && !topMode ? (
            <View style={[styles.opticsRow, { justifyContent: leftHanded ? 'flex-start' : 'flex-end' }]} pointerEvents="box-none">
              <HudButton onPress={toggleBino} on={bino} icon="telescope-outline" accessibilityLabel={t(bino ? 'bino_lower' : 'bino_a11y')} />
              {recOk ? (
                <HudButton onPress={toggleRecording} on={!!recAt} onColor={ST.enemy} accessibilityLabel={t(recAt ? 'rec_stop' : 'rec_start')}
                  text={recAt ? (() => { const sec = Math.max(0, Math.floor((recNow - recAt) / 1000)); return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}` })() : null}>
                  <View style={[styles.recDot, recAt && { borderRadius: 1 }]} />
                </HudButton>
              ) : null}
              {dualOk ? (
                <HudButton onPress={() => { buzz('select'); setSelfieOn((v) => !v) }} on={selfieOn} onColor={ST.friendly} icon="camera-reverse-outline" accessibilityLabel={t(selfieOn ? 'selfie_hide' : 'selfie_show')} />
              ) : null}
              <HudButton onPress={scope.cycle} on={scope.zoom > 1} onColor={ST.friendly} text={formatZoom(scope.zoom)} accessibilityLabel={t('scope_a11y', { z: formatZoom(scope.zoom) })} />
            </View>
          ) : null}
          {aim.mode === 'camera' && (
            <FireButton
              onPressIn={trigger.onPressIn}
              onPressOut={trigger.onPressOut}
              disabled={dead || !playing || tooFast}
              compact={tight}
              locked={!!inSights || enemyMarkers.length > 0 || targetLocked}
              auto={gun.automatic}
            />
          )}
          <WeaponCard weapon={gun} count={loadout.length} onWheel={openWheel} width={rightColW} compact={tight} />
        </View>
      </View>

      {dead && state.phase === 'playing' && (
        <DeathOverlay
          respawnSecs={snd ? null : Math.max(0, Math.ceil(((myState.respawnAt || now) - now) / 1000))}
          snd={snd}
          killer={killer}
          onChangeWeapon={loadout.length > 1 ? openWheel : null}
        />
      )}
      <AlertBanner alert={alert} top={hud.top + (row1H || 90) + 6} />
      {state.phase === 'countdown' && <CountdownOverlay state={state} now={now} meTeam={myTeam} />}
      {state.phase === 'roundEnd' && snd && <RoundBreak state={state} now={now} meTeam={myTeam} />}

      <WeaponWheel visible={wheelOpen} loadout={loadout} currentId={weaponId} onPick={pickWeapon} onClose={() => setWheelOpen(false)} insets={insets} />
      <ScoreboardOverlay visible={scoresOpen} state={state} meId={meId} insets={insets} clock={state.endless ? t('live') : formatClock(timerMs)} onClose={() => setScoresOpen(false)} />
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
    </Animated.View>
  )
}

// Hip fire: the screen point of `target` on the radar (geometry g from the radar's layout), or
// the radar's top edge (straight ahead) when nothing is locked.
function hipTargetPoint(g, target) {
  if (target && Number.isFinite(target.d) && Number.isFinite(target.bearing)) {
    const p = radarPoint({ size: g.size, heading: g.heading, rangeM: g.rangeM, d: target.d, bearing: target.bearing })
    return { x: g.left + p.x, y: g.top + p.y }
  }
  return { x: g.cx, y: g.cy - g.r }
}

const roundKeyForTip = (state) => `${state?.round}:${state?.snd?.roundNo ?? 0}`

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
  if (!me.alive) return { text: tr('obj_spectating') }
  if (bomb.state === 'planted') {
    if (attacker) return { text: act?.kind === 'defuse' ? tr('obj_they_defusing_at', { site: bomb.site }) : tr('obj_bomb_active', { site: bomb.site }) }
    const inside = engine.atBomb(snd, myPos)
    return {
      text: inside ? tr(act?.kind === 'defuse' && !myAct ? 'obj_mate_defusing' : 'obj_at_bomb') : tr('obj_defuse_at', { site: bomb.site, where: where(bomb) }),
      action: inside && (!act || myAct) ? { kind: 'defuse' } : null,
    }
  }
  if (attacker) {
    if (bomb.state === 'carried' && bomb.carrier === meId) {
      const site = myPos ? snd.sites.find((x) => engine.insideRadius(myPos, x, x.r || engine.SITE_RADIUS_M)) : null
      if (site) return { text: tr('obj_inside_site', { site: site.id }), action: !act || myAct ? { kind: 'plant', site: site.id } : null }
      return { text: myPos ? tr('obj_have_bomb_site', { site: nearest?.id, where: where(nearest) }) : tr('obj_have_bomb_wait') }
    }
    if (act?.kind === 'plant') return { text: tr('obj_mate_planting', { name: state.players[act.by]?.name || tr('a_teammate'), site: act.site }) }
    if (bomb.state === 'dropped') {
      const close = myPos && bomb.lat != null && distanceMeters(myPos, bomb) <= engine.PICKUP_RANGE_M + engine.gpsSlack(myPos.acc)
      return { text: close ? tr('obj_bomb_here') : tr('obj_bomb_dropped', { where: where(bomb) }), action: close ? { kind: 'pickup' } : null }
    }
    const carrier = state.players[bomb.carrier]
    return { text: carrier ? tr('obj_carrier', { name: carrier.name }) : tr('obj_eliminate') }
  }
  if (act?.kind === 'plant') return { text: tr('obj_they_planting', { site: act.site }) }
  return { text: tr('obj_defend', { sites: snd.sites.map((x) => x.id).join(tr('list_and')), where: where(nearest) }) }
}

const styles = StyleSheet.create({
  // tagged out
  deadDim: { backgroundColor: 'rgba(60,6,14,0.62)' },
  deadEdge: { borderWidth: 10, borderColor: 'rgba(255,61,82,0.45)' },
  deadBody: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16, gap: 30 },
  deadLabel: { fontFamily: FONT.ui, fontSize: 11, letterSpacing: 2.6, color: 'rgba(242,244,247,0.8)', ...stShadow },
  killerCard: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 10, backgroundColor: 'rgba(8,10,14,0.8)', borderRadius: ST.radius, borderLeftWidth: 3, borderLeftColor: ST.enemy, maxWidth: 340 },
  killerAvatar: { width: 44, height: 44, backgroundColor: '#3c434c', alignItems: 'center', justifyContent: 'center', borderRadius: 2 },
  killerInitial: { fontFamily: FONT.display, fontSize: 18, color: '#fff' },
  killerName: { fontFamily: FONT.display, fontSize: 22, color: ST.enemy },
  killerHow: { fontFamily: FONT.uiSemi, fontSize: 12, color: 'rgba(242,244,247,0.8)' },
  deadCount: { fontFamily: FONT.display, fontSize: 72, lineHeight: 76, color: '#fff', fontVariant: ['tabular-nums'], includeFontPadding: false, ...stShadow },
  deadTrack: { width: 160, height: 4, backgroundColor: 'rgba(255,255,255,0.2)' },
  deadFill: { height: 4, backgroundColor: '#ffffff' },
  deadButtons: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 10 },
  deadBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, height: 44, paddingHorizontal: 16, borderRadius: ST.radius, backgroundColor: 'rgba(8,10,14,0.8)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.22)' },
  deadBtnText: { fontFamily: FONT.ui, fontSize: 13, letterSpacing: 1.2, color: '#fff' },
  deadFollow: { height: 44, paddingHorizontal: 16, minWidth: 120 },
  tagOut: { position: 'absolute', width: 100, alignItems: 'center', gap: 4 },
  tagOutText: { fontFamily: FONT.display, fontSize: 11, letterSpacing: 1, color: ST.enemy, ...stShadow },
  // frame
  fill: { flex: 1, backgroundColor: '#000', overflow: 'hidden' },
  noCam: { alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: ST.ground2 },
  hipScrim: { backgroundColor: 'rgba(11,13,17,0.86)' },
  hipScrimCam: { backgroundColor: 'rgba(11,13,17,0.36)' },
  crosshair: { position: 'absolute', width: 64, height: 64 },
  // top
  topCol: { position: 'absolute', gap: 8 },
  row1: { flexDirection: 'row', alignItems: 'flex-start' },
  clockAbs: { position: 'absolute', left: 0, right: 0, top: 2, alignItems: 'center' },
  rowCenter: { alignItems: 'center' },
  row3: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 },
  // centre
  info: { position: 'absolute', left: 24, right: 24, alignItems: 'center', overflow: 'hidden' },
  sightText: { fontFamily: FONT.ui, fontSize: 11, letterSpacing: 1.4, color: '#fff', textAlign: 'center', ...stShadow },
  aimMode: { fontFamily: FONT.ui, fontSize: 10, letterSpacing: 1.4, color: ST.objective, marginTop: 4, textAlign: 'center', ...stShadow },
  marker: { fontFamily: FONT.display, fontSize: 15, letterSpacing: 0.6, marginTop: 8, textAlign: 'center', ...stShadow },
  tip: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10, maxWidth: 330, paddingHorizontal: 10, paddingVertical: 6, borderRadius: ST.radius, backgroundColor: HUD.panel, borderLeftWidth: 2, borderLeftColor: ST.friendly },
  tipText: { flexShrink: 1, fontFamily: FONT.uiSemi, fontSize: 12, color: '#fff', lineHeight: 16 },
  hip: { position: 'absolute', left: 12, right: 12, alignItems: 'center', justifyContent: 'center', gap: 10, overflow: 'hidden' },
  hipCue: { fontFamily: FONT.ui, fontSize: 11, letterSpacing: 1.8, color: 'rgba(242,244,247,0.75)' },
  // above the dock
  aboveDock: { position: 'absolute', gap: 8, alignItems: 'center' },
  objective: { alignItems: 'center', gap: 10, alignSelf: 'stretch' },
  objectiveText: { ...stType.body, fontFamily: FONT.ui, color: '#fff', textAlign: 'center', ...stShadow },
  warn: { fontFamily: FONT.ui, fontSize: 10.5, letterSpacing: 1, color: ST.objective, ...stShadow, maxWidth: 240 },
  hint: { fontFamily: FONT.uiSemi, fontSize: 11, letterSpacing: 1.4, color: 'rgba(242,244,247,0.75)', ...stShadow },
  pillWarn: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 12, paddingVertical: 6, borderRadius: ST.radius, backgroundColor: 'rgba(8,10,14,0.8)', borderLeftWidth: 3, borderLeftColor: ST.enemy, maxWidth: '100%' },
  speedPill: { backgroundColor: 'rgba(255,61,82,0.9)', borderLeftColor: '#fff', paddingVertical: 8 },
  pillWarnText: { flexShrink: 1, fontFamily: FONT.ui, fontSize: 11, letterSpacing: 1.3, color: '#fff' },
  scanPill: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 4, borderRadius: ST.radius, backgroundColor: 'rgba(8,10,14,0.66)', borderLeftWidth: 3, borderLeftColor: ST.friendly, maxWidth: '100%' },
  scanPillText: { flexShrink: 1, fontFamily: FONT.ui, fontSize: 10, letterSpacing: 1.2, color: 'rgba(242,244,247,0.9)' },
  // dock
  dock: { position: 'absolute', alignItems: 'flex-end', justifyContent: 'space-between' },
  leftCol: { gap: 8 },
  rightCol: { gap: DOCK_GAP, flexShrink: 1 },
  equipRow: { flexDirection: 'row' },
  opticsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  recDot: { width: 11, height: 11, borderRadius: 6, backgroundColor: ST.enemy, borderWidth: 1.5, borderColor: '#fff' },
  streak: { gap: 4 },
  streakRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  streakPip: { width: 13, height: 13, transform: [{ rotate: '45deg' }], margin: 2 },
  streakMore: { fontFamily: FONT.display, fontSize: 13, color: ST.objective, marginLeft: 2, ...stShadow },
  vignette: { ...StyleSheet.absoluteFill, borderWidth: 40, borderColor: 'rgba(255,61,82,0.6)', backgroundColor: 'rgba(255,61,82,0.16)' },
})
