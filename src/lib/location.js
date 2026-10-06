import * as Location from 'expo-location'

// Position without the wait. A fresh GPS fix can take several seconds; the phone almost always
// already knows roughly where it is. Return the last known position straight away (when it's
// recent enough) and let callers refine with onFresh() once a new fix lands.
const FRESH_MS = 3 * 60 * 1000
let lastGood = null

export async function getPositionFast({ accuracy = Location.Accuracy.Balanced, onFresh, maxAge = FRESH_MS } = {}) {
  const now = Date.now()
  let quick = lastGood && now - lastGood.timestamp < maxAge ? lastGood : null
  if (!quick) {
    const known = await Location.getLastKnownPositionAsync({ maxAge }).catch(() => null)
    if (known?.coords) quick = known
  }
  const fresh = Location.getCurrentPositionAsync({ accuracy })
    .then((pos) => {
      lastGood = pos
      if (onFresh && (!quick || moved(quick.coords, pos.coords))) onFresh(pos)
      return pos
    })
    .catch(() => null)
  if (quick) return quick
  const pos = await fresh
  if (!pos) throw new Error('Could not read your location')
  return pos
}

export const rememberPosition = (pos) => { if (pos?.coords) lastGood = pos }

function moved(a, b, meters = 25) {
  const dLat = (b.latitude - a.latitude) * 111320
  const dLng = (b.longitude - a.longitude) * 111320 * Math.cos((a.latitude * Math.PI) / 180)
  return Math.sqrt(dLat * dLat + dLng * dLng) > meters
}
