// Camera-first combat layer for Battle Royale — the same raise-and-shoot aiming as Laser
// Tag (laser/useAim + laser/vision), isolated in its own component so the ~10 Hz compass
// updates only re-render the crosshair, not the map/HUD around it.
//
// Live people tracking (laser/liveBodies.js) drives the target brackets, aim assist around the
// crosshair and tap-to-shoot (tap a bracket); without it the still-frame path is used.
// The shooter's phone decides who is under the crosshair and sends
// { type: 'hit', t: targetId, z: zone, n: beams, w: weaponId, m: 'vision'|'compass' };
// the host validates range, weapon, transit and damage.
//
// Melee (fists, everyone's starting weapon): a camera strike only goes out when the tracked
// person's box is tall enough to be within ~3 m (melee.js meleeBoxOk); without the camera only
// when GPS puts them under ~6 m with good fixes on both phones (meleeGpsOk).
// Weapons on the ground within ~50 m are drawn on the camera view (LootAR).
import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { CameraView, useCameraPermissions } from 'expo-camera'
import { useAim } from '../laser/useAim'
import { angularBody, photoRectToScreen, pickVisionTarget, useVisionCapture, viewBodiesFromLive, viewBodiesFromStill, visionAvailable } from '../laser/vision'
import { pickAimTarget, pickTapTarget, zoneAtRelative } from '../laser/aimAssist'
import { useLiveBodies } from '../laser/liveBodies'
import { LiveTargetBrackets, TargetBrackets } from '../laser/HudExtras'
import { angleDiff, bearingDeg, distanceMeters, formatDistance } from '../../lib/multiplayer'
import { buzz, useGamePrefs } from '../../lib/gamePrefs'
import { FONT, ST, stShadow, stType, withAlpha } from '../studio'
import { minShotGapMs, playShot, useWeaponTrigger } from './weaponsAdapter'
import { cameraTanHalf } from '../laser/arGround'
import { meleeBoxOk, meleeGpsOk } from './melee'
import { LootAR, lootMarkers } from './LootAR'

const COMPASS_SLACK = { 3: 4, 2: 8, 1: 12, 0: 15 }

export function aimTolerance(d, myAcc, theirAcc, headingAcc) {
  const err = Math.min(30, Math.max(3, Math.hypot(myAcc ?? 10, theirAcc ?? 10)))
  const deg = (Math.atan2(err * 0.6 + 0.5, Math.max(d, 1)) * 180) / Math.PI
  return Math.min(35, Math.max(3, deg) + (COMPASS_SLACK[headingAcc] ?? 10))
}

function hitChance(d, gun, offCenter) {
  const base = d <= 10 ? 0.9 : d <= 25 ? 0.75 : d <= 45 ? 0.6 : d <= 70 ? 0.45 : 0.3
  const p = (base + gun.accuracy / 100) * (1 - 0.35 * Math.min(1, offCenter))
  return Math.max(0.05, Math.min(0.95, p))
}

// Studio reticle (Kit board): four ticks + a centre dot when idle; red ticks + ring on target.
function Reticle({ on }) {
  const c = on ? ST.enemy : '#ffffff'
  return (
    <View style={s.reticle}>
      <View style={[s.tickV, { top: 0, backgroundColor: c }]} />
      <View style={[s.tickV, { bottom: 0, backgroundColor: c }]} />
      <View style={[s.tickH, { left: 0, backgroundColor: c }]} />
      <View style={[s.tickH, { right: 0, backgroundColor: c }]} />
      {on ? <View style={s.ring} /> : <View style={s.dotC} />}
    </View>
  )
}

/**
 * props:
 *   room, weapon (normalised, from weaponsAdapter.getWeapon), myPos
 *   opponents  [{ id, name, pos: { lat, lng, acc } }]  alive, hittable players only
 *   canFire    false in transit / dead / overlays / not playing — never fires when false
 *   cameraOn   mount the camera (off while spectating/in transit to save battery)
 *   onFlash(text, good), onShot()
 *   fireButtonStyle  where the FIRE button sits in classic camera mode
 *   centerTop / centerBottom  the free band for the aim indicator (between the HUD rows)
 *   loot       [{ id, lat, lng, label, color, s? }] weapons on the ground (AR markers ≤ 50 m)
 */
export const CombatView = memo(function CombatView({ room, weapon, myPos, opponents, canFire, cameraOn, onFlash, onShot, fireButtonStyle, centerTop, centerBottom, loot }) {
  const prefs = useGamePrefs()
  const aim = useAim({ enabled: !!cameraOn, override: prefs.aimMode })
  const [camPerm, requestCamPerm] = useCameraPermissions()
  const cameraRef = useRef(null)
  const vision = useVisionCapture(cameraRef)
  const [bodies, setBodies] = useState(null) // still-frame detections, preview space
  const bodiesRef = useRef(null)
  bodiesRef.current = bodies
  const [view, setView] = useState({ width: 0, height: 0 })
  const viewRef = useRef(view)
  viewRef.current = view
  const tapAimRef = useRef(null) // { id, rx, ry, x, y } while a tap on a target holds the trigger
  const tapHeldRef = useRef(false)

  useEffect(() => {
    if (camPerm && !camPerm.granted && camPerm.canAskAgain) requestCamPerm().catch(() => {})
  }, [camPerm, requestCamPerm])

  const heading = aim.heading
  const visionAim = visionAvailable && !!camPerm?.granted && !!cameraOn && (aim.mode === 'camera' || aim.mode === 'trigger')

  // Real-time people tracking; liveRunning stays false on binaries without it.
  const live = useLiveBodies({ enabled: visionAim && !!canFire })
  const [liveRunning, setLiveRunning] = useState(false)
  useEffect(() => live.subscribe(() => setLiveRunning(live.running())), [live])
  const [liveLocked, setLiveLocked] = useState(false)
  const onLiveLock = useCallback((id) => setLiveLocked(id != null), [])
  useEffect(() => { if (!liveRunning) setLiveLocked(false) }, [liveRunning])

  // Opponents with distance/bearing from me (only those in weapon reach matter).
  const inSights = useMemo(() => {
    if (!heading || !myPos || !Array.isArray(opponents)) return null
    let best = null
    for (const o of opponents) {
      if (!o?.pos) continue
      const d = distanceMeters(myPos, o.pos)
      if (!Number.isFinite(d)) continue
      if (weapon.melee ? !meleeGpsOk(d, myPos.acc, o.pos.acc) : d > weapon.range) continue
      const tol = aimTolerance(d, myPos.acc, o.pos.acc, heading.accuracy)
      const off = Math.abs(angleDiff(bearingDeg(myPos, o.pos), heading.deg))
      if (off > tol) continue
      const ratio = off / tol
      if (!best || ratio < best.ratio) best = { ...o, d, ratio, chance: hitChance(d, weapon, ratio) }
    }
    return best
  }, [opponents, heading, myPos, weapon])

  const ref = useRef({})
  ref.current = { myPos, heading, opponents, inSights, weapon, canFire, visionAim }

  // Still-frame target-lock brackets (setting, no live tracker), ~2.5×/s.
  const lockOn = visionAim && prefs.targetLock && canFire && !liveRunning
  useEffect(() => {
    if (!lockOn) { setBodies(null); return undefined }
    let cancelled = false
    const t = setInterval(() => {
      if (vision.busy()) return
      vision.capture().then((r) => { if (!cancelled && r) setBodies(viewBodiesFromStill(r.bodies, viewRef.current)) }).catch(() => {})
    }, 400)
    return () => { cancelled = true; clearInterval(t) }
  }, [lockOn]) // eslint-disable-line react-hooks/exhaustive-deps

  const send = (target, zone, beams, method) => {
    try {
      room.sendAction({ type: 'hit', t: target, z: zone, n: beams, w: ref.current.weapon.id, m: method })
    } catch { /* offline */ }
  }

  // The tapped person (followed by id while the tap holds), else aim assist at the crosshair.
  const pickShot = (vb, tap) => {
    const v = viewRef.current || {}
    const opts = { aspect: v.width > 0 && v.height > 0 ? v.width / v.height : 0.5, zoom: 1 }
    if (tap) {
      const same = tap.id != null ? vb.find((b) => b.id === tap.id) : null
      if (same) return { body: same, zone: zoneAtRelative(same, tap.rx, tap.ry), tap: true }
      const again = pickTapTarget(vb, tap.x, tap.y, opts)
      if (again) return { ...again, tap: true }
    }
    return pickAimTarget(vb, opts)
  }

  const tapTargetAt = (e) => {
    try {
      const v = viewRef.current
      if (!(v?.width > 0) || !(v?.height > 0)) return null
      const lx = Number(e?.nativeEvent?.locationX)
      const ly = Number(e?.nativeEvent?.locationY)
      if (!Number.isFinite(lx) || !Number.isFinite(ly)) return null
      const x = lx / v.width
      const y = ly / v.height
      const vb = live.running() ? viewBodiesFromLive(live.get()) : (bodiesRef.current || [])
      const p = pickTapTarget(vb, x, y, { aspect: v.width / v.height, zoom: 1 })
      if (!p) return null
      return { id: p.body.id ?? null, rx: p.rx, ry: p.ry, x, y }
    } catch {
      return null
    }
  }

  const fireVision = async (beams, tap = null) => {
    let hit = null
    try { if (live.running()) hit = pickShot(viewBodiesFromLive(live.get()), tap) } catch { hit = null }
    if (!hit) {
      let frame = null
      try { frame = await vision.capture() } catch { frame = null }
      if (!frame || !ref.current.canFire) return
      const vb = viewBodiesFromStill(frame.bodies, viewRef.current)
      if (!live.running()) setBodies(vb.length ? vb : null)
      hit = pickShot(vb, tap)
    }
    if (!hit || !ref.current.canFire) return
    const h = ref.current
    // Fists: only someone right in front of you (box as tall as a person within ~3 m).
    if (h.weapon?.melee) {
      let tanV
      try { tanV = cameraTanHalf(viewRef.current).tanV } catch { tanV = undefined }
      if (!meleeBoxOk(hit.body, tanV)) { onFlash?.('Too far to punch — get within arm’s reach', false); return }
    }
    const picked = pickVisionTarget({
      opponents: (h.opponents || []).map((o) => ({ ...o, alive: true })),
      myPos: h.myPos,
      headingDeg: h.heading?.deg,
      headingAcc: h.heading?.accuracy,
      body: angularBody(hit.body, viewRef.current),
      tolerance: aimTolerance,
    })
    if (!picked) { onFlash?.('That’s not a player in this match', false); return }
    send(picked.target.id, hit.zone, beams, 'vision')
  }

  // One trigger pull. Never fires when canFire is false (transit, dead, menus).
  const lastPullRef = useRef({ id: null, at: 0 })
  const fireShot = () => {
    const h = ref.current
    if (!h.canFire) return
    const w = h.weapon
    // Same cycle the host enforces (rocket 1 per 3 s, sniper 2 s, ...): a pull inside it
    // doesn't fire, so the shot isn't silently dropped by the host.
    if (!w.automatic) {
      const t = Date.now()
      const last = lastPullRef.current
      if (last.id === w.id && t - last.at < minShotGapMs(w)) { onFlash?.(w.blastRadius > 0 ? 'Rocket reloading…' : 'Cycling…', false); return }
      lastPullRef.current = { id: w.id, at: t }
    }
    const beams = w.automatic ? 1 : w.shotsPerClick
    playShot(w)
    buzz(w.automatic ? 'light' : 'medium')
    onShot?.(beams)
    if (!h.myPos || !h.heading) { onFlash?.('No GPS/compass fix yet', false); return }
    if (h.visionAim) { fireVision(beams, tapAimRef.current).catch(() => {}); return }
    const target = h.inSights
    if (!target) return
    let hits = 0
    for (let i = 0; i < beams; i++) if (Math.random() < target.chance) hits += 1
    if (hits) send(target.id, 'body', hits, 'compass')
  }

  const trigger = useWeaponTrigger(weapon, fireShot, { enabled: !!canFire })
  useEffect(() => { if (!canFire) trigger.stop() }, [canFire, trigger])

  const topMode = aim.mode === 'top'
  const triggerMode = aim.mode === 'trigger'
  const fullScreenTrigger = topMode || triggerMode
  const viewAspect = view.width > 0 && view.height > 0 ? view.width / view.height : 0.5
  const stillPick = bodies?.length ? pickAimTarget(bodies, { aspect: viewAspect, zoom: 1 }) : null
  const liveBrackets = liveRunning && prefs.targetLock !== false
  const locked = liveBrackets ? liveLocked : !!stillPick
  const red = !!inSights || locked
  const markers = cameraOn && view.width > 0 && loot?.length
    ? lootMarkers({ items: loot, myPos, headingDeg: aim.cameraHeading, pitchDeg: aim.pitch, view })
    : null

  return (
    <View style={StyleSheet.absoluteFill}>
      {cameraOn && camPerm?.granted ? (
        <CameraView ref={cameraRef} style={StyleSheet.absoluteFill} facing="back" animateShutter={false} onLayout={(e) => setView(e.nativeEvent.layout)} />
      ) : (
        <View style={[StyleSheet.absoluteFill, s.noCam]}>
          {cameraOn && (
            <Pressable onPress={() => requestCamPerm().catch(() => {})} style={({ pressed }) => [s.allow, pressed && { opacity: 0.8 }]} accessibilityRole="button">
              <Text style={s.allowText}>ALLOW THE CAMERA TO AIM</Text>
            </Pressable>
          )}
        </View>
      )}

      {fullScreenTrigger && cameraOn && (
        <Pressable
          style={StyleSheet.absoluteFill}
          onPressIn={(e) => {
            // Trigger mode: a tap on a tracked person fires at them; anywhere else at the crosshair.
            tapAimRef.current = triggerMode && visionAim ? tapTargetAt(e) : null
            trigger.onPressIn()
          }}
          onPressOut={() => { trigger.onPressOut(); tapAimRef.current = null }}
          disabled={!canFire}
          accessibilityRole="button"
          accessibilityLabel={weapon.automatic ? 'Fire. Hold for continuous fire' : 'Fire. Every tap fires'}
        />
      )}
      {/* Classic camera aim: tapping a target bracket fires at that person (same trigger rules
          as FIRE). A tap elsewhere does nothing. */}
      {cameraOn && aim.mode === 'camera' && visionAim && canFire ? (
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
          accessibilityLabel="Tap a target to fire at it"
        />
      ) : null}

      {visionAim && liveBrackets && view.width > 0 && !topMode ? (
        <LiveTargetBrackets store={live} view={view} onLock={onLiveLock} />
      ) : visionAim && bodies && view.width > 0 ? (
        <TargetBrackets
          rects={bodies.slice(0, 6).map((b, i) => {
            let r = null
            try { r = photoRectToScreen(b.box, b, view) } catch { r = null }
            if (!r || !Number.isFinite(r.left) || !Number.isFinite(r.top)) return null
            return { key: String(i), left: r.left, top: r.top, width: Math.max(0, r.width), height: Math.max(0, r.height), locked: stillPick?.body === b, head: null }
          }).filter(Boolean)}
        />
      ) : null}

      {markers?.length ? <LootAR markers={markers} view={view} /> : null}

      {cameraOn && (
        <View style={[s.center, Number.isFinite(centerTop) && { top: centerTop }, Number.isFinite(centerBottom) && { bottom: centerBottom }]} pointerEvents="none">
          {topMode ? (
            <View style={[s.arrow, { borderBottomColor: red ? ST.enemy : '#ffffff' }]} />
          ) : (
            <Reticle on={red} />
          )}
          <Text style={s.sight}>
            {!canFire
              ? ''
              : weapon.melee && !inSights && !locked
                ? 'Fists · get within arm’s reach (~3 m)'
                : visionAim
                ? (locked ? 'Target locked' : opponents?.length ? 'Camera aim' : 'No players nearby')
                : inSights
                  ? `${inSights.name} · ${formatDistance(inSights.d)} · ~${Math.round(inSights.chance * 100)}%`
                  : topMode ? 'Point the top edge at a player · tap to fire' : 'No one in your sights'}
          </Text>
        </View>
      )}

      {cameraOn && aim.mode === 'camera' && (
        <Pressable
          onPressIn={trigger.onPressIn}
          onPressOut={trigger.onPressOut}
          disabled={!canFire}
          style={({ pressed }) => [s.fire, fireButtonStyle, { opacity: !canFire ? 0.4 : pressed ? 0.75 : 1 }, pressed && { transform: [{ scale: 0.96 }] }]}
          accessibilityRole="button"
          accessibilityLabel="Fire"
        >
          <Text style={s.fireText}>FIRE</Text>
        </Pressable>
      )}
    </View>
  )
})

const s = StyleSheet.create({
  noCam: { backgroundColor: ST.ground, alignItems: 'center', justifyContent: 'center' },
  allow: { paddingHorizontal: 16, height: 44, justifyContent: 'center', borderRadius: ST.radius, backgroundColor: ST.panel, borderWidth: 1, borderColor: ST.lineStrong },
  allowText: { fontFamily: FONT.ui, fontSize: 13, letterSpacing: 1.2, color: '#fff' },
  center: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 30 },
  reticle: { width: 56, height: 56, alignItems: 'center', justifyContent: 'center' },
  tickV: { position: 'absolute', left: 27, width: 2, height: 14 },
  tickH: { position: 'absolute', top: 27, width: 14, height: 2 },
  dotC: { width: 3, height: 3, borderRadius: 2, backgroundColor: '#ffffff' },
  ring: { width: 24, height: 24, borderRadius: 12, borderWidth: 1.4, borderColor: ST.enemy },
  arrow: { width: 0, height: 0, borderLeftWidth: 18, borderRightWidth: 18, borderBottomWidth: 40, borderLeftColor: 'transparent', borderRightColor: 'transparent' },
  sight: { ...stType.label, fontSize: 12, color: ST.text, marginTop: 10, textAlign: 'center', ...stShadow },
  fire: { position: 'absolute', width: 96, height: 96, borderRadius: 48, backgroundColor: withAlpha(ST.enemy, 0.85), alignItems: 'center', justifyContent: 'center', borderWidth: 3, borderColor: 'rgba(255,255,255,0.8)' },
  fireText: { fontFamily: FONT.display, fontSize: 16, letterSpacing: 1.5, color: '#fff', includeFontPadding: false },
})

export default CombatView
