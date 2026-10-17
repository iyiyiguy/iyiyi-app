// Battle Royale host notices (royale/engine.js) arrive in English; each phone shows them in its
// own language (i18n/strings/royale.js). Unknown lines are shown as sent.
import { translate } from '../../i18n'
import S from '../../i18n/strings/royale'

const tr = (k, v) => translate(S, k, v)

const EXACT = {
  'Firing is disabled in transit': 'n_tr_fire',
  'Too far to punch — get closer': 'n_too_far_punch',
  'Can’t pick up loot in transit': 'n_tr_loot',
  'Someone already took that': 'n_taken',
  'Get closer to pick it up': 'n_closer_pick',
}
const PATTERNS = [
  [/^(.+) is in transit and can’t be hit$/, 'n_tr_target'],
  [/^You already carry the (.+)$/, 'n_already_carry'],
]

export function localizeRoyaleNotice(text) {
  const raw = String(text ?? '')
  const t = raw.trim()
  if (EXACT[t]) return tr(EXACT[t])
  for (const [re, k] of PATTERNS) {
    const m = re.exec(t)
    if (m) return tr(k, { name: m[1] })
  }
  return raw
}
