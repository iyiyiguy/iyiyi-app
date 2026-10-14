import FontAwesome6 from '@expo/vector-icons/FontAwesome6'
import { PLATFORM_LABELS } from '../lib/socialLinks'
import { useT } from '../i18n'
import strings from '../i18n/strings/social'

// Official brand glyphs (FontAwesome6 Free, "brands" style) instead of emoji.
const BRAND_NAMES = {
  facebook: 'facebook',
  instagram: 'instagram',
  twitter: 'x-twitter',
  tiktok: 'tiktok',
  snapchat: 'snapchat',
  linkedin: 'linkedin',
  whatsapp: 'whatsapp',
  spotify: 'spotify',
  soundcloud: 'soundcloud',
  youtube: 'youtube',
  google: 'google',
  discord: 'discord',
  twitch: 'twitch',
  telegram: 'telegram',
}

// Screen readers hear the platform name ("Instagram") instead of the glyph, or
// "{platform}: @{handle}" when handle is passed. accessibilityLabel overrides both.
export function socialA11yLabel(t, platform, handle) {
  const label = PLATFORM_LABELS[platform] ?? platform
  const h = typeof handle === 'string' ? handle.trim().replace(/^@/, '') : ''
  return h ? t('platformHandleA11y', { platform: label, handle: h }) : label
}

export default function SocialIcon({ platform, size = 20, color = '#fff', handle, accessibilityLabel }) {
  const t = useT(strings)
  const name = BRAND_NAMES[platform]
  if (!name) return null
  return (
    <FontAwesome6
      name={name}
      size={size}
      color={color}
      iconStyle="brand"
      accessibilityRole="image"
      accessibilityLabel={accessibilityLabel ?? socialA11yLabel(t, platform, handle)}
    />
  )
}
