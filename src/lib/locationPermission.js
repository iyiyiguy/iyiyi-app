// Location permission for screens that load location on focus (Nearby, Discover, Map, Feed,
// Camera). Shows the phone's prompt only while the choice is still undecided, so switching
// tabs never re-asks someone who said no (Android lets apps ask twice, then blocks for good).
// Buttons the user taps on purpose ("Refresh", "Turn on location") can still call
// Location.requestForegroundPermissionsAsync() directly.
import * as Location from 'expo-location'

let pending = null

/** Resolves to { status } like requestForegroundPermissionsAsync. */
export async function ensureLocationPermission() {
  try {
    const cur = await Location.getForegroundPermissionsAsync()
    if (cur?.status !== 'undetermined') return { status: cur?.status ?? 'denied' }
    // Several tabs can mount at once: share one prompt.
    if (!pending) pending = Location.requestForegroundPermissionsAsync().finally(() => { pending = null })
    const res = await pending
    return { status: res?.status ?? 'denied' }
  } catch {
    return { status: 'denied' }
  }
}
