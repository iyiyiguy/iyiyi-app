// UAV rules line (lib/uav.js UAV_RULES_TEXT) in the viewer's language.
import { translate } from '../../i18n'
import H from '../../i18n/strings/laserHud'
import { UAV_COOLDOWN_MS, UAV_STREAK_TAGS, UAVS_BOUGHT_PER_MATCH } from '../../lib/uav'

export const uavRulesText = () => translate(H, 'uav_rules', { n: UAV_STREAK_TAGS, max: UAVS_BOUGHT_PER_MATCH, s: Math.round(UAV_COOLDOWN_MS / 1000) })

// lib/uav.js raises its alerts ({ title, sub }) in English; known ones are shown translated.
const UAV_EXACT = {
  'UAV earned': 'ua_earned',
  'Enemy UAV overhead': 'ua_enemy',
  'They can see you on their map — keep moving': 'ua_enemy_sub',
  'UAV recharging': 'ua_recharging',
  'UAV limit': 'ua_limit',
  'Enemies are on your map': 'ua_enemies_on_map',
  'Your UAV is already up': 'ua_already_up',
}
const UAV_PATTERNS = [
  [/^(\d+)-tag streak — call it in from the UAV button$/, 'ua_streak_sub', ['n']],
  [/^UAV online — (\d+)s$/, 'ua_online_s', ['n']],
  [/^(.+) called in a UAV$/, 'ua_called', ['name']],
  [/^UAV recharging — (\d+) s$/, 'ua_recharging_s', ['n']],
  [/^Match limit: (\d+) bought UAVs per match\. Earn more with a (\d+)-tag streak\.$/, 'ua_cap', ['max', 'n']],
]
function uavLine(text) {
  const t = String(text ?? '')
  if (UAV_EXACT[t]) return translate(H, UAV_EXACT[t])
  for (const [re, k, names] of UAV_PATTERNS) {
    const m = re.exec(t)
    if (m) {
      const vars = {}
      names.forEach((n, i) => { vars[n] = m[i + 1] })
      if (vars.name === 'A teammate') vars.name = translate(H, 'ua_teammate')
      return translate(H, k, vars)
    }
  }
  return text
}
/** A UAV alert from lib/uav.js with its title and sub in the viewer's language. */
export const localizeUavAlert = (a) => (a ? { ...a, title: uavLine(a.title), sub: a.sub == null ? a.sub : uavLine(a.sub) } : a)
