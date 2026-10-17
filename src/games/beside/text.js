// Beside Them text in the viewer's language (i18n/strings/besideThem.js).
// The host (beside/engine.js) writes notices, covert notes and feed lines in English and sends
// them to every phone; known lines are matched here and shown translated, anything else as sent.
// Auto / QR station names from STATION_OBJECTS are translated too (custom names stay as typed).
import { translate } from '../../i18n'
import B from '../../i18n/strings/besideThem'

export const bt = (k, v) => translate(B, k, v)

// English object name -> key (keep in sync with STATION_OBJECTS in engine.js).
const OBJECT_KEYS = {
  'Pineapple crate': 'obj_pineapple',
  'Satellite dish': 'obj_satellite',
  'Vending machine': 'obj_vending',
  'Rubber duck pond': 'obj_duck',
  'Cactus greenhouse': 'obj_cactus',
  'Cat tower': 'obj_cat',
  'Pizza oven': 'obj_pizza',
  'UFO landing pad': 'obj_ufo',
  'Donut reactor': 'obj_donut',
  'Robot charger': 'obj_robot',
  'Rocket fuel pump': 'obj_rocket',
  'Treasure chest': 'obj_treasure',
  Jukebox: 'obj_jukebox',
  'Arcade cabinet': 'obj_arcade',
  'Lava lamp': 'obj_lava',
  'Taco truck': 'obj_taco',
}

/** A station's display name: built-in object names translated, custom names as typed. */
export function stationName(st) {
  const name = typeof st === 'string' ? st : st?.name
  const k = OBJECT_KEYS[name]
  return k ? bt(k) : (name || '')
}

/** 'Floor 1' (start floor), 'Basement', 'Basement 2'… from a floor index (engine.floorIndex). */
export function floorName(i) {
  if (i === null || i === undefined) return null
  if (i >= 0) return bt('floor_n', { n: i + 1 })
  return i === -1 ? bt('basement') : bt('basement_n', { n: -i })
}

const FLOOR_RE = /^(?:Floor (\d+)|Basement(?: (\d+))?)$/
const floorFromEnglish = (s) => {
  const m = FLOOR_RE.exec(String(s || '').trim())
  if (!m) return s
  return m[1] ? floorName(Number(m[1]) - 1) : floorName(m[2] ? -Number(m[2]) : -1)
}

const EXACT = {
  'Waiting for locations — try again.': 'kb_noloc',
  'Signal too weak to eliminate. Try somewhere with a clearer sky.': 'kb_weak',
  'Too far away — get within arm’s reach.': 'kb_far',
  'They’re on another floor.': 'kb_floor',
  'Comms came back online': 'feed_comms_back',
  'They moved out of reach.': 'n_moved_away',
  'Not yet.': 'n_not_yet',
  'Scan this station’s code to finish the task.': 'n_scan_to_finish',
  'You need to be at the station to finish this task.': 'n_be_at_station',
  'They can’t be eliminated.': 'n_cant_eliminate',
  'Hold interrupted — hold again.': 'n_hold_interrupted',
  'That didn’t count — hold until the ring fills.': 'n_hold_full',
  'Get closer to report.': 'n_closer_report',
  'You’ve used your emergency meeting.': 'n_meeting_used',
  'Comms are down — fix them first.': 'n_comms_down_fix',
  'You can call a meeting again shortly.': 'n_meeting_soon',
  'Comms sabotaged!': 'feed_sabotaged',
  'Go to any station to fix comms.': 'n_go_fix',
  'No one was voted out': 'feed_no_one_out',
  'No one was voted out (tie)': 'feed_no_one_out_tie',
}

// [pattern, key, names of the captured values]
const PATTERNS = [
  [/^(.+) reported (.+)’s body$/, 'feed_reported', ['name', 'body']],
  [/^(.+) called an emergency meeting$/, 'feed_called', ['name']],
  [/^(.+) was voted out$/, 'feed_voted_out', ['name']],
  [/^Comms fixed by (.+)$/, 'feed_fixed_by', ['name']],
  [/^(.+) is on (.+)\. Go there to finish the task\.$/, 'n_station_on_floor', ['name', 'floor']],
  [/^Update the app to eliminate \(hold on the player for (.+) s\)\.$/, 'n_update_app', ['s']],
  [/^Not yet — (\d+) s\.$/, 'n_not_yet_s', ['s']],
  [/^Sabotage ready in (\d+)s\.$/, 'n_sabotage_ready', ['s']],
]

/** A host line in the viewer's language. */
export function localizeBesideText(text) {
  const raw = String(text ?? '')
  const t = raw.trim()
  if (!t) return raw
  const key = EXACT[t]
  if (key) return bt(key)
  for (const [re, k, names] of PATTERNS) {
    const m = re.exec(t)
    if (m) {
      const vars = {}
      names.forEach((n, i) => { vars[n] = m[i + 1] })
      if (vars.name) vars.name = stationName(vars.name)
      if (vars.floor) vars.floor = floorFromEnglish(vars.floor)
      return bt(k, vars)
    }
  }
  return raw
}
