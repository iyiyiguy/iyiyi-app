// Share a post (photo or video) to other apps: Instagram, TikTok, Snapchat, Messages,
// WhatsApp, X, Save to Photos... The file is downloaded to the cache first so the iOS share
// sheet gets the real image/video (apps like Instagram only accept files, not links). If the
// download fails we fall back to sharing the link.
import { Alert, Share } from 'react-native'
import * as Haptics from 'expo-haptics'

function extFor(item) {
  const m = String(item?.media_url ?? '').split('?')[0].match(/\.([a-z0-9]{2,5})$/i)
  if (m) return m[1].toLowerCase()
  return item?.media_type === 'video' ? 'mp4' : 'jpg'
}

export async function shareMedia(item) {
  if (!item?.media_url) return
  Haptics.selectionAsync().catch(() => {})
  const isVideo = item.media_type === 'video'
  const message = item.owner_username ? `@${item.owner_username} on iYiYi · iyiyi.xyz` : 'On iYiYi · iyiyi.xyz'
  try {
    const FileSystem = await import('expo-file-system/legacy')
    const Sharing = await import('expo-sharing')
    if (!(await Sharing.isAvailableAsync())) throw new Error('sharing unavailable')
    const ext = extFor(item)
    const local = `${FileSystem.cacheDirectory}iyiyi-share-${item.id ?? Date.now()}.${ext}`
    const info = await FileSystem.getInfoAsync(local)
    if (!info.exists) await FileSystem.downloadAsync(item.media_url, local)
    await Sharing.shareAsync(local, {
      mimeType: isVideo ? 'video/mp4' : ext === 'png' ? 'image/png' : 'image/jpeg',
      UTI: isVideo ? 'public.mpeg-4' : ext === 'png' ? 'public.png' : 'public.jpeg',
      dialogTitle: 'Share post',
    })
  } catch {
    try {
      await Share.share({ url: item.media_url, message })
    } catch {
      Alert.alert('Could not share', 'Please try again.')
    }
  }
}
