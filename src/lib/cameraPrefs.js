import AsyncStorage from '@react-native-async-storage/async-storage'
import { normalizeFilter } from './cameraFilters'

// Camera options that stick between sessions (timer, burst, video cut-off) and the
// "explain this the first time" flags for the camera's tooltips.

const OPTIONS_KEY = 'iyiyi_camera_options_v1'
const TIP_PREFIX = 'iyiyi_camera_tip_seen_'

export const TIMER_CHOICES = [0, 3, 5, 10] // quick presets, seconds, 0 = off
export const BURST_CHOICES = [0, 5, 10, 20] // shots, 0 = off
export const CUTOFF_CHOICES = [0, 5, 10, 15, 30, 60] // quick presets, seconds, 0 = unlimited (no cut-off)
export const DEFAULT_BURST_SHOTS = 10

// Besides the presets, the countdown and the cut-off take any custom length in these ranges.
export const TIMER_RANGE = { min: 1, max: 60, step: 1 }
export const CUTOFF_RANGE = { min: 5, max: 300, step: 5 }
export const DEFAULT_TIMER_CUSTOM = 15
export const DEFAULT_CUTOFF_CUSTOM = 90

// Whole seconds inside the range (0 stays 0 = off). Anything unusable comes back as `fallback`.
export function clampSeconds(v, range, fallback = 0) {
  const n = Math.round(Number(v))
  if (!Number.isFinite(n) || n < 0) return fallback
  if (n === 0) return 0
  return Math.min(range.max, Math.max(range.min, n))
}
export const timerSeconds = (o) => clampSeconds(o?.timer, TIMER_RANGE, 0)
export const cutoffSeconds = (o) => clampSeconds(o?.cutoff, CUTOFF_RANGE, 0)

export const DEFAULT_CAMERA_OPTIONS = {
  timer: 0,
  burst: 0, // burst on every shutter press (photo mode)
  burstAfterCountdown: false, // countdown is followed by a burst instead of a single shot
  burstShots: DEFAULT_BURST_SHOTS, // shots used by "burst after countdown" when burst itself is off
  cutoff: 0,
  timerCustom: DEFAULT_TIMER_CUSTOM, // last custom countdown length, remembered for the Custom chip
  cutoffCustom: DEFAULT_CUTOFF_CUSTOM, // last custom cut-off length
  mode: 'picture',
  filter: 'none', // AR filter: none | logo | nametag | love (see lib/cameraFilters)
}

const pick = (v, choices, fallback) => (choices.includes(v) ? v : fallback)

export async function loadCameraOptions() {
  try {
    const raw = await AsyncStorage.getItem(OPTIONS_KEY)
    if (!raw) return { ...DEFAULT_CAMERA_OPTIONS }
    const o = JSON.parse(raw) || {}
    return {
      timer: clampSeconds(o.timer, TIMER_RANGE, 0),
      burst: pick(o.burst, BURST_CHOICES, 0),
      burstAfterCountdown: !!o.burstAfterCountdown,
      burstShots: pick(o.burstShots, BURST_CHOICES.filter(Boolean), DEFAULT_BURST_SHOTS),
      cutoff: clampSeconds(o.cutoff, CUTOFF_RANGE, 0),
      timerCustom: clampSeconds(o.timerCustom, TIMER_RANGE, DEFAULT_TIMER_CUSTOM) || DEFAULT_TIMER_CUSTOM,
      cutoffCustom: clampSeconds(o.cutoffCustom, CUTOFF_RANGE, DEFAULT_CUTOFF_CUSTOM) || DEFAULT_CUTOFF_CUSTOM,
      mode: o.mode === 'video' ? 'video' : 'picture',
      filter: normalizeFilter(o.filter),
    }
  } catch {
    return { ...DEFAULT_CAMERA_OPTIONS }
  }
}

export async function saveCameraOptions(options) {
  try {
    await AsyncStorage.setItem(OPTIONS_KEY, JSON.stringify(options))
  } catch {
    // Options just won't persist this time.
  }
}

// Resolves true when the tip has NOT been shown yet, and marks it shown.
export async function claimFirstUseTip(id) {
  try {
    const key = TIP_PREFIX + id
    if (await AsyncStorage.getItem(key)) return false
    await AsyncStorage.setItem(key, '1')
    return true
  } catch {
    return false
  }
}

export const FIRST_USE_TIPS = {
  mode: {
    icon: 'swap-horizontal-outline',
    title: 'Photo or video',
    body: 'Tap VIDEO or PHOTO under the options (or swipe left/right across the camera) to switch. In video mode, tap the shutter to start and tap it again to stop.',
  },
  timer: {
    icon: 'timer-outline',
    title: 'Countdown',
    body: 'Tap the shutter and you get a few seconds to get in the shot before the camera fires. Pick a preset or tap Custom to set any length from 1 to 60 seconds. Tap the shutter again to cancel.',
  },
  cutoff: {
    icon: 'stopwatch-outline',
    title: 'Video cut-off',
    body: 'Unlimited (∞) records until you tap stop. Pick 5s, 10s, 15s, 30s or 60s (or Custom, 5 seconds to 5 minutes) and the video stops on its own, so you can set the phone down.',
  },
  burst: {
    icon: 'albums-outline',
    title: 'Burst',
    body: 'One tap fires a quick run of photos back to back (×5, ×10 or ×20), so you catch the exact moment. They post together as one stack, and you can cancel the whole burst before it goes out.',
  },
  burstAfterCountdown: {
    icon: 'albums-outline',
    title: 'Burst after countdown',
    body: 'Turn on "Burst" inside the countdown options and, when the countdown hits zero, the camera fires a burst instead of one photo. In video mode it takes the burst, then starts recording.',
  },
  filters: {
    icon: 'sparkles-outline',
    title: 'Filters',
    body: 'Pick a filter from the round buttons on the right (or the Filter option). It finds people with iYiYi nearby and follows them (using where they are and which way your phone points), with their name on the Name Tag; otherwise it follows the closest face. It shrinks and grows as people move away or come closer. It’s added to your photos; in video it shows live while you record, but isn’t saved into the video file.',
  },
  flip: {
    icon: 'camera-reverse-outline',
    title: 'Front / back camera',
    body: 'The button to the right of the shutter flips between the back camera and the front (selfie) camera.',
  },
  previews: {
    icon: 'hourglass-outline',
    title: '5-second previews',
    body: 'Everything you shoot pops up as a small card at the top for 5 seconds before it posts. Tap its X to cancel it; otherwise it posts and tags everyone nearby.',
  },
}

// Order of the "?" help sheet: each row opens the full tip above.
export const HELP_TOPICS = [
  { id: 'mode', short: 'Tap VIDEO / PHOTO or swipe across the camera.' },
  { id: 'timer', short: 'Seconds before the camera fires.' },
  { id: 'cutoff', short: 'Video stops itself after this long. ∞ = until you stop.' },
  { id: 'burst', short: 'Many photos with one tap.' },
  { id: 'burstAfterCountdown', short: 'Countdown, then a burst.' },
  { id: 'filters', short: 'Overlays that follow people (saved on photos).' },
  { id: 'flip', short: 'Switch front / back camera.' },
  { id: 'previews', short: 'Tap X within 5s to cancel a post.' },
]
