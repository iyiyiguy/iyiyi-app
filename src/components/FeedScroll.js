import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { View, Text, Image, Pressable, StyleSheet, FlatList, Platform } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { useIsFocused } from '@react-navigation/native'
import EditedVideo from './EditedVideo'
import { colors, type } from '../theme'
import { post, del } from '../lib/api'
import Bounce from './Bounce'
import FollowEverywhereButton from './FollowEverywhereButton'
import { useFollowEverywhere, isActiveStatus } from './FollowEverywhereSheet'
import { useFollowStatuses } from '../lib/useFollowStatuses'
import { useOpenProfile, useMyUserId } from '../lib/profileNav'
import { avatarSource } from '../lib/avatarSource'
import { useT } from '../i18n'
import strings from '../i18n/strings/social'

// One-post-per-row scrolling feed (as opposed to MasonryGrid's thumbnail grid) - each
// item shows the owner (with Follow ×N when you don't follow them yet), the full media, and
// an inline like/comment action row so you don't have to open the fullscreen viewer just to
// like something or see the count. Tapping the media or the comment count opens the
// fullscreen viewer; tapping the heart toggles the like right here.
//
// It's a windowed FlatList: only rows near the screen are mounted, and only the most visible
// video plays (the rest are paused; off-window ones aren't mounted at all).
// Edits (trim / crop / captions) and the post's sound play here too (EditedVideo). Muted in the
// feed like before; the viewer plays sound.
function FeedVideo({ uri, active, mediaId, edit, sound }) {
  return <EditedVideo uri={uri} mediaId={mediaId} edit={edit} sound={sound} active={active} muted style={styles.media} contentFit="cover" />
}

const FeedCard = memo(function FeedCard({ item, index, active, onOpen, onLike, openOwner, followStatus, onStatus, onFollowEverywhere, myId }) {
  const owner = item.owner_id
    ? { id: item.owner_id, username: item.owner_username, avatar_url: item.owner_avatar_url, social_links: item.owner_social_links }
    : null
  const t = useT(strings)
  const showFollow = !!owner && !item.is_mine && owner.id !== myId && !isActiveStatus(followStatus)
  return (
    <View style={styles.card}>
      <View style={styles.ownerRow}>
        <Pressable
          style={styles.ownerMain}
          onPress={() => (item.owner_id ? openOwner(item.owner_id, item.owner_avatar_url) : onOpen(index))}
          accessibilityRole="button"
          accessibilityLabel={item.owner_username ? t('openProfileA11y', { name: item.owner_username }) : t('openPost')}
        >
          <Image source={avatarSource(item?.owner_avatar_url)} style={styles.avatar} />
          <Text style={[type.body, { fontWeight: '600', flexShrink: 1 }]} numberOfLines={1}>{item.owner_username ?? (item.is_mine ? t('you') : '')}</Text>
          {item.is_mine ? <View style={styles.mineBadge}><Text style={styles.mineBadgeText}>{t('you')}</Text></View> : null}
        </Pressable>
        {showFollow ? (
          <FollowEverywhereButton user={owner} status={followStatus} onStatus={onStatus} onOpen={onFollowEverywhere} />
        ) : null}
      </View>

      <Pressable onPress={() => onOpen(index)} accessibilityRole="imagebutton" accessibilityLabel={item.media_type === 'video' ? t('openVideo') : t('openPhoto')}>
        {item.media_type === 'video'
          ? <FeedVideo uri={item.media_url} active={active} mediaId={item.kind === 'youtube' ? null : item.id} edit={item.edit} sound={item.sound} />
          : <Image source={{ uri: item.media_url }} style={styles.media} resizeMode="cover" />}
      </Pressable>

      <View style={styles.actionRow}>
        <Bounce
          onPress={() => onLike(item, index)}
          style={styles.action}
          hitSlop={4}
          scaleTo={0.75}
          accessibilityRole="button"
          accessibilityState={{ selected: !!item.liked_by_me }}
          accessibilityLabel={t(item.liked_by_me ? 'unlikeA11y' : 'likeA11y', { n: item.like_count ?? 0 })}
        >
          <Ionicons name={item.liked_by_me ? 'heart' : 'heart-outline'} size={24} color={item.liked_by_me ? colors.magenta : colors.text} />
          <Text style={type.caption}>{item.like_count ?? 0}</Text>
        </Bounce>
        <Pressable onPress={() => onOpen(index)} style={styles.action} hitSlop={4} accessibilityRole="button" accessibilityLabel={t('commentsA11y', { n: item.comment_count ?? 0 })}>
          <Ionicons name="chatbubble-outline" size={22} color={colors.text} />
          <Text style={type.caption}>{item.comment_count ?? 0}</Text>
        </Pressable>
      </View>
    </View>
  )
})

const VIEWABILITY = { itemVisiblePercentThreshold: 60, minimumViewTime: 150 }

export default function FeedScroll({
  items, onOpen, onChange, onOpenProfile, refreshControl, contentContainerStyle, ListHeaderComponent, ListEmptyComponent,
}) {
  const navOpenProfile = useOpenProfile()
  const openOwner = onOpenProfile ?? navOpenProfile
  const myId = useMyUserId()
  const focused = useIsFocused()
  const [activeId, setActiveId] = useState(null)
  const owners = items.filter((it) => it?.owner_id && !it.is_mine)
  const { statuses, setStatus } = useFollowStatuses(owners, 'owner_id')
  const fe = useFollowEverywhere({ onStatus: setStatus })

  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  const toggleLike = useCallback(async (item, index) => {
    const liked = !item.liked_by_me
    onChangeRef.current(index, {
      liked_by_me: liked,
      like_count: Math.max(0, (item.like_count ?? 0) + (liked ? 1 : -1)),
    })
    try {
      if (liked) await post(`/api/profiles/media/${item.id}/like`)
      else await del(`/api/profiles/media/${item.id}/like`)
    } catch {
      onChangeRef.current(index, { liked_by_me: !liked, like_count: item.like_count ?? 0 })
    }
  }, [])

  // The first (top-most) sufficiently visible video is the one that plays.
  const onViewableItemsChanged = useRef(({ viewableItems }) => {
    const v = viewableItems.find((x) => x.isViewable && x.item?.media_type === 'video')
    setActiveId(v ? `${v.item.kind ?? 'm'}-${v.item.id ?? v.index}` : null)
  }).current

  const keyOf = (item, i) => `${item.kind ?? 'm'}-${item.id ?? i}`

  return (
    <View style={{ flex: 1 }}>
      <FlatList
        data={items}
        keyExtractor={keyOf}
        renderItem={({ item, index }) => (
          <FeedCard
            item={item}
            index={index}
            active={focused && activeId === keyOf(item, index)}
            onOpen={onOpen}
            onLike={toggleLike}
            openOwner={openOwner}
            followStatus={item.owner_id ? statuses[item.owner_id] : undefined}
            onStatus={setStatus}
            onFollowEverywhere={fe.open}
            myId={myId}
          />
        )}
        extraData={[activeId, focused, statuses, myId]}
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={VIEWABILITY}
        initialNumToRender={3}
        maxToRenderPerBatch={3}
        windowSize={5}
        removeClippedSubviews={Platform.OS === 'android'}
        refreshControl={refreshControl}
        contentContainerStyle={contentContainerStyle}
        ListHeaderComponent={ListHeaderComponent}
        ListEmptyComponent={ListEmptyComponent}
      />
      {fe.element}
    </View>
  )
}

const styles = StyleSheet.create({
  // Capped width so a post isn't a screen-sized 4:5 video on desktop web / tablets.
  card: { marginBottom: 20, width: '100%', maxWidth: 560, alignSelf: 'center' },
  ownerRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingBottom: 10 },
  ownerMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 40 },
  avatar: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.inkSurfaceRaised },
  media: { width: '100%', aspectRatio: 4 / 5, backgroundColor: colors.inkSurfaceRaised },
  mineBadge: { backgroundColor: colors.magenta, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
  mineBadgeText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  actionRow: { flexDirection: 'row', gap: 22, paddingHorizontal: 16, paddingTop: 10 },
  action: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 36 },
})
