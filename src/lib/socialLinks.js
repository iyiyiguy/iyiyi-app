import { Linking, Alert } from 'react-native'

export const PLATFORM_LABELS = {
  instagram: 'Instagram', tiktok: 'TikTok', facebook: 'Facebook', twitter: 'X / Twitter', snapchat: 'Snapchat',
  linkedin: 'LinkedIn', whatsapp: 'WhatsApp', spotify: 'Spotify', soundcloud: 'SoundCloud', youtube: 'YouTube',
  discord: 'Discord', twitch: 'Twitch', telegram: 'Telegram',
}

// Linking.openURL rejects when the OS can't resolve the URL at that moment
// (e.g. transient network state) - left uncaught this surfaces to Sentry as
// an unhandled promise rejection on every call site that uses it directly.
export function openLink(url) {
  Linking.openURL(url).catch(() => Alert.alert("Couldn't open link", url))
}

// Turns a stored handle (e.g. "@james26" or "james.cillain2" or a full URL)
// into an openable URL for each platform.
const BASE_URLS = {
  facebook: 'https://facebook.com/',
  instagram: 'https://instagram.com/',
  twitter: 'https://x.com/',
  tiktok: 'https://tiktok.com/@',
  snapchat: 'https://snapchat.com/add/',
  linkedin: 'https://linkedin.com/in/',
  youtube: 'https://youtube.com/@',
  soundcloud: 'https://soundcloud.com/',
  spotify: 'https://open.spotify.com/user/',
  whatsapp: 'https://wa.me/',
  discord: 'https://discord.gg/',
  twitch: 'https://twitch.tv/',
  telegram: 'https://t.me/',
}

export function socialUrl(platform, handle) {
  if (!handle) return null
  if (handle.startsWith('http://') || handle.startsWith('https://')) return handle

  const base = BASE_URLS[platform]
  if (!base) return null

  const cleaned = handle.replace(/^[@/]+/, '')
  return `${base}${cleaned}`
}
