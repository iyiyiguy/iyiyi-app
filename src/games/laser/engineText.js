// The Laser Tag host (laser/engine.js) writes its notices and kill-feed lines in English and
// sends them to every phone. Each phone shows them in its own language: known lines are
// matched here and translated (i18n/strings/laserHud.js); anything else is shown as sent.
import { translate } from '../../i18n'
import H from '../../i18n/strings/laserHud'

const tr = (k, v) => translate(H, k, v)

const EXACT = {
  'The bomb exploded': 'feed_exploded',
  'Half time — sides swapped': 'feed_half',
  'Someone else is already at the bomb.': 'n_someone_at_bomb',
  'You don’t have the bomb.': 'n_no_bomb',
  'Waiting for your GPS — hold still a moment.': 'n_wait_gps_still',
  'Get inside a bomb site to plant.': 'n_get_inside_site',
  'A teammate is already defusing.': 'n_mate_defusing',
  'Get closer to the bomb to defuse.': 'n_closer_defuse',
  'Plant interrupted — hold again.': 'n_plant_interrupted',
  'Defuse interrupted — hold again.': 'n_defuse_interrupted',
  'That didn’t count — hold until the bar fills.': 'n_didnt_count',
  'Stay inside the site to plant.': 'n_stay_site',
  'Stay at the bomb to defuse.': 'n_stay_bomb',
  'Get closer to the bomb to pick it up.': 'n_closer_pickup',
  'Grenade lost — waiting for GPS.': 'n_grenade_lost',
  'Nobody can throw that far.': 'n_too_far_throw',
  'Rocket reloading…': 'n_rocket_reloading',
  'Rocket lost — waiting for your GPS.': 'n_rocket_lost',
  'Slow down — one sticky bomb at a time.': 'n_sticky_slow',
  'Waiting for your GPS to place the sticky bomb.': 'n_wait_gps_sticky',
  'No sticky bombs placed.': 'n_no_sticky_placed',
  'Sticky bomb lost — waiting for your GPS.': 'n_sticky_lost',
  'That sticky bomb is too far away to detonate.': 'n_sticky_far',
  'Waiting for GPS to place mine.': 'n_wait_gps_mine',
  'That player isn’t in this match.': 'n_not_in_match',
  'Friendly fire is off.': 'n_friendly_fire',
  'Shot not counted — waiting for your GPS.': 'n_shot_wait_gps',
  'Out of range.': 'n_out_of_range',
  'Shot not counted — you weren’t facing them.': 'n_not_facing',
  Miss: 'n_miss',
}

// [pattern, key, names of the captured values]
const PATTERNS = [
  [/^(.+) joined the arena$/, 'feed_joined', ['name']],
  [/^(.+) dropped the bomb$/, 'feed_dropped', ['name']],
  [/^(.+) picked up the bomb$/, 'feed_picked', ['name']],
  [/^Bomb planted at site (\S+) by (.+)$/, 'feed_planted', ['site', 'name']],
  [/^(.+) defused the bomb$/, 'feed_defused', ['name']],
  [/^(.+) tagged iYiYi user @(.+)$/, 'feed_bystander', ['name', 'user']],
  [/^That’s (\d+) sticky bombs — detonate some first\.$/, 'n_sticky_max', ['n']],
  [/^You already have (\d+) mines out\.$/, 'n_mines_max', ['n']],
  [/^(.+) is already tagged out\.$/, 'n_already_out', ['name']],
  [/^(.+) just respawned — protected for a moment\.$/, 'n_just_respawned', ['name']],
  [/^Shot not counted — (.+) has no GPS fix\.$/, 'n_shot_no_fix', ['name']],
]

/** A host line (emoji already stripped or not) in the viewer's language. */
export function localizeLaserText(text) {
  const raw = String(text ?? '')
  const t = raw.trim()
  if (!t) return raw
  const key = EXACT[t]
  if (key) return tr(key)
  for (const [re, k, names] of PATTERNS) {
    const m = re.exec(t)
    if (m) {
      const vars = {}
      names.forEach((n, i) => { vars[n] = m[i + 1] })
      return tr(k, vars)
    }
  }
  return raw
}
