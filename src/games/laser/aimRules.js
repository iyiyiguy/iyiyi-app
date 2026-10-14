// Aim + fire-rate rules shared by the shooter's phone and the host (laser/engine.js), so both
// sides agree on what counts as "in your sights". Pure, no React / native imports.
//
// Compass ("hip fire") aim: the enemy nearest your heading inside a cone. GPS error makes the
// bearing between two close phones noisy, so the cone widens as distance shrinks, but it is
// CAPPED at COMPASS_CONE_MAX_DEG: there is no point-blank "any direction counts" window any
// more (that let tap-spamming beat aiming). Inside GPS error the hit CHANCE drops instead.
// Camera confirmation (a person seen in the frame) is the only way to get point-blank
// certainty, so camera matching keeps the old wide window (visionTolerance).

// Compass aim can't see walls or cover, so it only reaches this far (camera aim uses the gun's range).
export const COMPASS_MAX_RANGE_M = 40
export const COMPASS_CONE_MAX_DEG = 35
// Compass calibration level (0-3) → extra degrees of slack.
export const COMPASS_SLACK = { 3: 4, 2: 8, 1: 12, 0: 15 }
// Host re-check: extra degrees for latency (the target walked, the shooter turned) and for
// the host seeing slightly different GPS fixes than the shooter.
export const HOST_AIM_SLACK_DEG = 8
// Camera hits: the person can be anywhere across the frame (half FOV ≈ 28°) plus GPS error.
export const HOST_VISION_MIN_DEG = 70

/** Combined GPS error of two phones (m). Closer than this, the bearing between them is noise. */
export const gpsErr = (myAcc, theirAcc) => Math.min(30, Math.max(3, Math.hypot(myAcc ?? 10, theirAcc ?? 10)))

/** Half-angle (deg) of the compass cone for a target `d` metres away. Never above 35°. */
export function compassTolerance(d, myAcc, theirAcc, headingAcc) {
  const err = gpsErr(myAcc, theirAcc)
  const deg = (Math.atan2(err * 0.6 + 0.5, Math.max(Number(d) || 0, 1)) * 180) / Math.PI
  return Math.min(COMPASS_CONE_MAX_DEG, Math.max(3, deg) + (COMPASS_SLACK[headingAcc] ?? 10))
}

/** The old wide window, for matching a person the CAMERA saw to a player (vision.pickVisionTarget). */
export function visionTolerance(d, myAcc, theirAcc, headingAcc) {
  const err = gpsErr(myAcc, theirAcc)
  if (d <= err) return 180
  const deg = (Math.atan2(err * 0.6 + 0.5, Math.max(d, 1)) * 180) / Math.PI
  const normal = Math.min(35, Math.max(3, deg) + (COMPASS_SLACK[headingAcc] ?? 10))
  if (d <= err * 2) return Math.max(normal, 90 - (45 * (d - err)) / err)
  return normal
}

/**
 * Chance one compass round connects. accuracy: the gun's bonus in % (-30..40). offRatio: 0
 * on the bearing, 1 at the cone's edge. err: combined GPS error (m): inside it the bearing is
 * noise, so the chance drops (to half at 0 m, rising to 80 % of normal at the error radius).
 */
export function hitChance(d, accuracy = 0, offRatio = 0, err = 10) {
  const base = d <= 10 ? 0.9 : d <= 25 ? 0.75 : d <= 45 ? 0.6 : d <= 70 ? 0.45 : 0.3
  const close = d <= err ? 0.5 + 0.3 * Math.max(0, d) / Math.max(1, err) : 1
  const p = (base + (Number(accuracy) || 0) / 100) * (1 - 0.35 * Math.min(1, Math.max(0, offRatio))) * close
  return Math.max(0.05, Math.min(0.9, p))
}

/**
 * Minimum gap between two trigger pulls of `gun` that the host accepts (0 = only the generic
 * spam guard). Explosive launchers (blastRadius) use their full cycle (rocket: 1 / 3 s); other
 * slow semi-autos (fireRate < 1/s: sniper, scatter) half of it; everything else is limited by
 * how fast a person can tap (and autos are batched per HIT_BATCH_MS).
 */
export function minShotGapMs(gun) {
  if (!gun || gun.fireMode === 'automatic') return 0
  const rate = Number(gun.fireRate)
  if (!(rate > 0) || rate >= 1) return 0
  const full = Math.round(1000 / rate)
  return gun.blastRadius > 0 ? full : Math.round(full * 0.5)
}

/** Host-clock slack for bursty arrival: a pull may arrive up to this much "early". */
export const hostGapSlackMs = (gapMs) => Math.min(1000, Math.round(gapMs * 0.4))
