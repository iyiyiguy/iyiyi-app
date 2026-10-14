// Melee reach rules (pure, shared by the shooter's phone and the host).
//
// Everyone starts with only their fists. A strike needs the target right there:
//   camera  — the tracked person's box is at least as tall as a ~1.7 m person standing
//             MELEE_CAM_M away fills (from the camera's vertical field of view), or
//   GPS     — without the camera, a GPS distance under MELEE_GPS_M with both fixes better than
//             MELEE_GPS_ACC_M (GPS can't resolve a few metres otherwise).
// The host can't see the camera, so it checks the GPS distance with the usual error allowance
// (meleeHostReach): close enough that the camera claim is plausible.
import { MELEE_CAM_M, MELEE_GPS_ACC_M, MELEE_GPS_M, MELEE_HOST_MAX_M, PERSON_H_M } from './constants'

// tan(half vertical FOV) of a phone held upright with the wide (1×) camera, aspect-filled.
export const DEFAULT_TAN_V = 0.69

/**
 * Minimum box height (fraction of the view height) of a person within MELEE_CAM_M.
 * @param tanV tan of half the view's vertical field of view (arGround.cameraTanHalf().tanV)
 */
export function meleeBoxMinH(tanV = DEFAULT_TAN_V) {
  const t = Number.isFinite(tanV) && tanV > 0.05 ? tanV : DEFAULT_TAN_V
  const frac = PERSON_H_M / (2 * MELEE_CAM_M * t)
  return Math.max(0.25, Math.min(0.85, frac))
}

/** A tracked body (view space, box.h = fraction of the view height) close enough to punch. */
export function meleeBoxOk(body, tanV) {
  const h = Number(body?.box?.h)
  return Number.isFinite(h) && h >= meleeBoxMinH(tanV)
}

/** GPS-only melee (no camera): very close, and only with good fixes on both phones. */
export function meleeGpsOk(d, myAcc, theirAcc) {
  const a = Number.isFinite(myAcc) ? myAcc : 99
  const b = Number.isFinite(theirAcc) ? theirAcc : 99
  return Number.isFinite(d) && d < MELEE_GPS_M && a <= MELEE_GPS_ACC_M && b <= MELEE_GPS_ACC_M
}

/**
 * The furthest GPS distance (m) the host accepts for a melee hit. Camera strikes allow both
 * phones' GPS error (the camera confirmed the person is within ~3 m), capped; GPS strikes
 * only a little slack on top of MELEE_GPS_M.
 */
export function meleeHostReach(method, myAcc, theirAcc) {
  const slack = (acc) => Math.min(8, Math.max(2, (Number.isFinite(acc) ? acc : 10) / 2))
  if (method === 'vision') return Math.min(MELEE_HOST_MAX_M, MELEE_CAM_M + slack(myAcc) + slack(theirAcc))
  return MELEE_GPS_M + Math.min(4, slack(myAcc))
}
