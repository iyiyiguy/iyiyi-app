// One place for the links people share. Profile links always use app.iyiyi.xyz/u/<username>:
// that's the path the app's deep linking handles (App.js LINKING -> PublicProfile), and the
// web app serves the same page to people who don't have the app yet.
import { Share } from 'react-native'

export const PROFILE_LINK_BASE = 'https://app.iyiyi.xyz/u/'

export function profileShareUrl(username) {
  const name = String(username ?? '').trim().replace(/^@+/, '')
  if (!name) return null
  return `${PROFILE_LINK_BASE}${encodeURIComponent(name)}`
}

// Opens the system share sheet with a profile link. `message` may contain {url}; without one
// the link is appended. Resolves false when there's nothing to share or sharing failed.
export async function shareProfileLink(username, message) {
  const url = profileShareUrl(username)
  if (!url) return false
  const text = message ? (message.includes('{url}') ? message.split('{url}').join(url) : `${message} ${url}`) : url
  try {
    await Share.share({ message: text })
    return true
  } catch {
    return false
  }
}
