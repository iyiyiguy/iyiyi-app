import FontAwesome6 from '@expo/vector-icons/FontAwesome6'

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

export default function SocialIcon({ platform, size = 20, color = '#fff' }) {
  const name = BRAND_NAMES[platform]
  if (!name) return null
  return <FontAwesome6 name={name} size={size} color={color} iconStyle="brand" />
}
