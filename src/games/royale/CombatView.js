// Camera-first combat layer for Battle Royale — the same raise-and-shoot aiming as Laser
// Tag (laser/useAim + laser/vision), isolated in its own component so the ~10 Hz compass
// updates only re-render the crosshair, not the map/HUD around it.
//
// The shooter's phone decides who is under the crosshair and sends
// { type: 'hit', t: targetId, z: zone, n: beams, w: weaponId, m: 'vision'|'compass' };
// the host validates range, weapon, transit and damage.
import React, { memo, useEffect, useMemo, useRef, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { CameraView, useCameraPermissions } from 'expo-camera'
import { useAim } from '../laser/useAim'
import { classifyHit, photoRectToScreen, pickVisionTarget, useVisionCapture, visionAvailable } from '../laser/vision'
import { angleDiff, bearingDeg, distanceMeters, formatDistance } from '../../lib/multiplayer'
import { buzz, useGamePrefs } from '../../lib/gamePrefs'
import { playShot, useWeaponTrigger } from './weaponsAdapter'

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

const hudShadow = { textShadowColor: 'rgba(0,0,0,0.85)', textShadowRadius: 4, textShadowOffset: { width: 0, height: 1 } }

/**
 * props:
 *   room, weapon (normalised, from weaponsAdapter.getWeapon), myPos
 *   opponents  [{ id, name, pos: { lat, lng, acc } }]  alive, hittable players only
 *   canFire    false in transit / dead / overlays / not playing — never fires when false
 *   cameraOn   mount the camera (off while spectating/in transit to save battery)
 *   onFlash(text, good), onShot()
 *   fireButtonStyle  where the FIRE button sits in classic camera mode
 *   centerTop / centerBottom  the free band for the aim indicator (between the HUD rows)
 */
export const CombatView = memo(function CombatView({ room, weapon, myPos, opponents, canFire, cameraOn, onFlash, onShot, fireButtonStyle, centerTop, centerBottom }) {
  const prefs = useGamePrefs()
  const aim = useAim({ enabled: !!cameraOn, override: prefs.aimMode })
  const [camPerm, requestCamPerm] = useCameraPermissions()
  const cameraRef = useRef(null)
  const vision = useVisionCapture(cameraRef)
  const [bodies, setBodies] = useState(null)
  const [view, setView] = useState({ width: 0, height: 0 })

  useEffect(() => {
    if (camPerm && !camPerm.granted && camPerm.canAskAgain) requestCamPerm().catch(() => {})
  }, [camPerm, requestCamPerm])

  const heading = aim.heading
  const visionAim = visionAvailable && !!camPerm?.granted && !!cameraOn && (aim.mode === 'camera' || aim.mode === 'trigger')

  // Opponents with distance/bearing from me (only those in weapon reach matter).
  const inSights = useMemo(() => {
    if (!heading || !myPos || !Array.isArray(opponents)) return null
    let best = null
    for (const o of opponents) {
      if (!o?.pos) continue
      const d = distanceMeters(myPos, o.pos)
      if (!Number.isFinite(d) || d > weapon.range) continue
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

  // Live target-lock brackets (setting), ~2.5×/s.
  const lockOn = visionAim && prefs.targetLock && canFire
  useEffect(() => {
    if (!lockOn) { setBodies(null); return undefined }
    let cancelled = false
    const t = setInterval(() => {
      if (vision.busy()) return
      vision.capture().then((r) => { if (!cancelled && r) setBodies(r.bodies) }).catch(() => {})
    }, 400)
    return () => { cancelled = true; clearInterval(t) }
  }, [lockOn]) // eslint-disable-line react-hooks/exhaustive-deps

  const send = (target, zone, beams, method) => {
    try {
      room.sendAction({ type: 'hit', t: target, z: zone, n: beams, w: ref.current.weapon.id, m: method })
    } catch { /* offline */ }
  }

  const fireVision = async (beams) => {
    let frame = null
    try { frame = await vision.capture() } catch { frame = null }
    if (!frame || !ref.current.canFire) return
    setBodies(frame.bodies)
    const hit = classifyHit(frame.bodies)
    if (!hit) return
    const h = ref.current
    const picked = pickVisionTarget({
      opponents: (h.opponents || []).map((o) => ({ ...o, alive: true })),
      myPos: h.myPos,
      headingDeg: h.heading?.deg,
      headingAcc: h.heading?.accuracy,
      body: hit.body,
      tolerance: aimTolerance,
    })
    if (!picked) { onFlash?.('That’s not a player in this match', false); return }
    send(picked.target.id, hit.zone, beams, 'vision')
  }

  // One trigger pull. Never fires when canFire is false (transit, dead, menus).
  const fireShot = () => {
    const h = ref.current
    if (!h.canFire) return
    const w = h.weapon
    const beams = w.automatic ? 1 : w.shotsPerClick
    playShot(w)
    buzz(w.automatic ? 'light' : 'medium')
    onShot?.(beams)
    if (!h.myPos || !h.heading) { onFlash?.('No GPS/compass fix yet', false); return }
    if (h.visionAim) { fireVision(beams); return }
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
  const locked = !!bodies?.some((b) => classifyHit([b]))
  const red = !!inSights || locked

  return (
    <View style={StyleSheet.absoluteFill}>
      {cameraOn && camPerm?.granted ? (
        <CameraView ref={cameraRef} style={StyleSheet.absoluteFill} facing="back" animateShutter={false} onLayout={(e) => setView(e.nativeEvent.layout)} />
      ) : (
        <View style={[StyleSheet.absoluteFill, s.noCam]}>
          {cameraOn && (
            <Pressable onPress={() => requestCamPerm().catch(() => {})} style={s.allow} accessibilityRole="button">
              <Text style={s.allowText}>Allow the camera to aim</Text>
            </Pressable>
          )}
        </View>
      )}

      {fullScreenTrigger && cameraOn && (
        <Pressable
          style={StyleSheet.absoluteFill}
          onPressIn={trigger.onPressIn}
          onPressOut={trigger.onPressOut}
          disabled={!canFire}
          accessibilityRole="button"
          accessibilityLabel={weapon.automatic ? 'Fire. Hold for continuous fire' : 'Fire. Every tap fires'}
        />
      )}

      {visionAim && bodies && view.width > 0 && bodies.slice(0, 6).map((b, i) => {
        let r = null
        try { r = photoRectToScreen(b.box, b, view) } catch { r = null }
        if (!r || !Number.isFinite(r.left) || !Number.isFinite(r.top)) return null
        const on = !!classifyHit([b])
        return <View key={i} pointerEvents="none" style={[s.bracket, { left: r.left, top: r.top, width: Math.max(0, r.width), height: Math.max(0, r.height), borderColor: on ? '#ff5d6c' : 'rgba(255,255,255,0.4)' }]} />
      })}

      {cameraOn && (
        <View style={[s.center, Number.isFinite(centerTop) && { top: centerTop }, Number.isFinite(centerBottom) && { bottom: centerBottom }]} pointerEvents="none">
          {topMode ? (
            <Text style={[s.arrow, red && { color: '#ff5d6c' }]}>▲</Text>
          ) : (
            <View style={[s.cross, red && { borderColor: '#ff5d6c' }]}>
              <View style={[s.crossH, red && { backgroundColor: '#ff5d6c' }]} />
              <View style={[s.crossV, red && { backgroundColor: '#ff5d6c' }]} />
            </View>
          )}
          <Text style={s.sight}>
            {!canFire
              ? ''
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
          style={({ pressed }) => [s.fire, fireButtonStyle, { opacity: !canFire ? 0.4 : pressed ? 0.75 : 1 }]}
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
  noCam: { backgroundColor: '#0b0d18', alignItems: 'center', justifyContent: 'center' },
  allow: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.12)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.25)' },
  allowText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  center: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 30 },
  cross: { width: 64, height: 64, borderRadius: 32, borderWidth: 2, borderColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  crossH: { position: 'absolute', width: 28, height: 2, backgroundColor: '#fff' },
  crossV: { position: 'absolute', width: 2, height: 28, backgroundColor: '#fff' },
  arrow: { fontSize: 60, color: '#fff', ...hudShadow },
  sight: { fontSize: 13, color: '#fff', marginTop: 10, textAlign: 'center', ...hudShadow },
  bracket: { position: 'absolute', borderWidth: 1.5, borderRadius: 6 },
  fire: { position: 'absolute', width: 96, height: 96, borderRadius: 48, backgroundColor: '#d4202f', alignItems: 'center', justifyContent: 'center', borderWidth: 3, borderColor: '#fff' },
  fireText: { fontSize: 18, fontWeight: '800', color: '#fff', letterSpacing: 2 },
})

export default CombatView
