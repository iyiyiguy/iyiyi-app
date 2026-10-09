import { View, Text, Image, Pressable, StyleSheet } from 'react-native'
import { VideoView, useVideoPlayer } from 'expo-video'
import { colors, radii, type } from '../theme'
import { post, del } from '../lib/api'
import Bounce from './Bounce'
import { useOpenProfile } from '../lib/profileNav'
import { avatarSource } from '../lib/avatarSource'

// One-post-per-row scrolling feed (as opposed to MasonryGrid's thumbnail grid) - each
// item shows the owner, the full media, and an inline like/comment action row so you
// don't have to open the fullscreen viewer just to like something or see the count.
// Tapping the media or the comment count opens the fullscreen viewer (for comments and
// the rest of the detail); tapping the heart toggles the like right here.
function FeedVideo({ uri }) {
  const player = useVideoPlayer(uri, (p) => { p.loop = true; p.muted = true; p.play() })
  return <VideoView player={player} style={styles.media} contentFit="cover" nativeControls={false} />
}

export default function FeedScroll({ items, onOpen, onChange, onOpenProfile }) {
  const navOpenProfile = useOpenProfile()
  const openOwner = onOpenProfile ?? navOpenProfile
  const toggleLike = async (item, index) => {
    const liked = !item.liked_by_me
    onChange(index, {
      liked_by_me: liked,
      like_count: Math.max(0, (item.like_count ?? 0) + (liked ? 1 : -1)),
    })
    try {
      if (liked) await post(`/api/profiles/media/${item.id}/like`)
      else await del(`/api/profiles/media/${item.id}/like`)
    } catch {
      onChange(index, { liked_by_me: !liked, like_count: item.like_count ?? 0 })
    }
  }

  return (
    <View>
      {items.map((item, i) => (
        <View key={`${item.kind ?? 'm'}-${item.id ?? i}`} style={styles.card}>
          <Pressable style={styles.ownerRow} onPress={() => (item.owner_id ? openOwner(item.owner_id) : onOpen(i))} accessibilityRole="button">
            {<Image source={avatarSource(item?.owner_avatar_url)} style={styles.avatar} />}
            <Text style={[type.body, { fontWeight: '600', flexShrink: 1 }]} numberOfLines={1}>{item.owner_username ?? (item.is_mine ? 'You' : '')}</Text>
            {item.is_mine ? <View style={styles.mineBadge}><Text style={styles.mineBadgeText}>You</Text></View> : null}
          </Pressable>

          <Pressable onPress={() => onOpen(i)}>
            {item.media_type === 'video'
              ? <FeedVideo uri={item.media_url} />
              : <Image source={{ uri: item.media_url }} style={styles.media} resizeMode="cover" />}
          </Pressable>

          <View style={styles.actionRow}>
            <Bounce onPress={() => toggleLike(item, i)} style={styles.action} scaleTo={0.75}>
              <Text style={[styles.actionIcon, item.liked_by_me && { color: colors.magenta }]}>
                {item.liked_by_me ? '♥' : '♡'}
              </Text>
              <Text style={type.caption}>{item.like_count ?? 0}</Text>
            </Bounce>
            <Pressable onPress={() => onOpen(i)} style={styles.action}>
              <Text style={styles.actionIcon}>💬</Text>
              <Text style={type.caption}>{item.comment_count ?? 0}</Text>
            </Pressable>
          </View>
        </View>
      ))}
    </View>
  )
}

const styles = StyleSheet.create({
  card: { marginBottom: 20 },
  ownerRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingBottom: 10 },
  avatar: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.inkSurfaceRaised },
  media: { width: '100%', aspectRatio: 4 / 5, backgroundColor: colors.inkSurfaceRaised },
  mineBadge: { backgroundColor: colors.magenta, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
  mineBadgeText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  actionRow: { flexDirection: 'row', gap: 22, paddingHorizontal: 16, paddingTop: 10 },
  action: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  actionIcon: { fontSize: 22, color: colors.text },
})
