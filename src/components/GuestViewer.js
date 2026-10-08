import { useCallback, useEffect, useRef, useState } from 'react'
import { View, Text, Image, Pressable, StyleSheet, Modal, FlatList, useWindowDimensions, Platform } from 'react-native'
import { LinearGradient } from 'expo-linear-gradient'
import { Ionicons } from '@expo/vector-icons'
import { VideoView, useVideoPlayer } from 'expo-video'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { font } from '../theme'
import { useGuestPrompt } from './GuestPrompt'
import { avatarSource } from '../lib/avatarSource'

// Read-only full-screen viewer for logged-out visitors (the member ContentViewer talks to the
// authed API for likes/saves/comments). Swipe up/down between posts; like, comment and save
// open the sign-up prompt; tapping the owner opens their public profile.
//   items: [{ id, media_url, media_type, owner_username, owner_avatar_url, like_count, comment_count }]
function ActiveVideo({ uri }) {
  const player = useVideoPlayer(uri, (p) => {
    p.loop = true
    p.muted = Platform.OS === 'web' // browsers block autoplay with sound
    p.play()
  })
  return <VideoView player={player} style={StyleSheet.absoluteFill} contentFit="contain" nativeControls={false} />
}

const fmt = (n) => {
  const v = Number(n) || 0
  if (v >= 1e6) return `${(v / 1e6).toFixed(1).replace(/\.0$/, '')}M`
  if (v >= 1e3) return `${(v / 1e3).toFixed(1).replace(/\.0$/, '')}K`
  return String(v)
}

export default function GuestViewer({ visible, items, startIndex = 0, onClose, onOpenProfile }) {
  const { width, height } = useWindowDimensions()
  const insets = useSafeAreaInsets()
  const [active, setActive] = useState(startIndex)
  const [sheet, prompt] = useGuestPrompt(onClose)
  const listRef = useRef(null)

  useEffect(() => { if (visible) setActive(startIndex) }, [visible, startIndex])

  const onViewable = useRef(({ viewableItems }) => {
    const first = viewableItems?.find((v) => v.isViewable)
    if (first?.index != null) setActive(first.index)
  }).current

  const renderItem = useCallback(({ item, index }) => {
    const isVideo = item.media_type === 'video'
    return (
      <View style={{ width, height, backgroundColor: '#000' }}>
        {isVideo ? (
          index === active ? <ActiveVideo uri={item.media_url} /> : <View style={StyleSheet.absoluteFill} />
        ) : (
          <Image source={{ uri: item.media_url }} style={StyleSheet.absoluteFill} resizeMode="contain" />
        )}
        <LinearGradient colors={['transparent', 'rgba(0,0,0,0.75)']} style={styles.shade} pointerEvents="none" />
        <View style={[styles.actions, { bottom: insets.bottom + 40 }]}>
          <Action icon="heart-outline" label={fmt(item.like_count)} onPress={() => prompt('like')} a11y="Like" />
          <Action icon="chatbubble-outline" label={fmt(item.comment_count)} onPress={() => prompt('comment')} a11y="Comments" />
          <Action icon="bookmark-outline" onPress={() => prompt('save')} a11y="Save" />
        </View>
        <Pressable
          onPress={() => item.owner_username && onOpenProfile?.(item)}
          style={[styles.owner, { bottom: insets.bottom + 40 }]}
          accessibilityRole="button"
          accessibilityLabel={`Open ${item.owner_username ?? 'owner'}'s profile`}
        >
          {<Image source={avatarSource(item.owner_avatar_url)} style={styles.avatar} />}
          <Text style={styles.ownerName} numberOfLines={1}>@{item.owner_username ?? 'someone'}</Text>
          <Pressable onPress={() => prompt('follow')} hitSlop={6} style={styles.follow} accessibilityRole="button">
            <Text style={styles.followText}>Follow</Text>
          </Pressable>
        </Pressable>
      </View>
    )
  }, [width, height, active, insets.bottom, prompt, onOpenProfile])

  return (
    <Modal visible={visible} animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.screen}>
        {visible ? (
          <FlatList
            ref={listRef}
            data={items}
            keyExtractor={(m, i) => String(m.id ?? i)}
            renderItem={renderItem}
            pagingEnabled
            showsVerticalScrollIndicator={false}
            initialScrollIndex={Math.min(startIndex, Math.max(0, items.length - 1))}
            getItemLayout={(_, i) => ({ length: height, offset: height * i, index: i })}
            onViewableItemsChanged={onViewable}
            viewabilityConfig={{ itemVisiblePercentThreshold: 60 }}
            extraData={active}
            windowSize={3}
            decelerationRate="fast"
          />
        ) : null}
        <Pressable onPress={onClose} hitSlop={10} style={[styles.close, { top: insets.top + 12 }]} accessibilityRole="button" accessibilityLabel="Close">
          <Ionicons name="close" size={24} color="#fff" />
        </Pressable>
        {sheet}
      </View>
    </Modal>
  )
}

function Action({ icon, label, onPress, a11y }) {
  return (
    <Pressable onPress={onPress} hitSlop={6} accessibilityRole="button" accessibilityLabel={a11y} style={({ pressed }) => [styles.action, pressed && { transform: [{ scale: 0.9 }] }]}>
      <View style={styles.actionCircle}><Ionicons name={icon} size={26} color="#fff" /></View>
      {label != null ? <Text style={styles.actionText}>{label}</Text> : null}
    </Pressable>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#000' },
  shade: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 220 },
  close: {
    position: 'absolute', left: 14, width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.45)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)',
  },
  actions: { position: 'absolute', right: 12, alignItems: 'center', gap: 16 },
  action: { alignItems: 'center' },
  actionCircle: {
    width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.12)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.22)',
  },
  actionText: { color: '#fff', fontSize: 12, ...font.semibold, marginTop: 4 },
  owner: { position: 'absolute', left: 16, right: 84, flexDirection: 'row', alignItems: 'center', gap: 10 },
  avatar: { width: 40, height: 40, borderRadius: 20, borderWidth: 1.5, borderColor: '#fff', backgroundColor: '#222' },
  ownerName: { color: '#fff', fontSize: 16, ...font.bold, flexShrink: 1 },
  follow: { paddingHorizontal: 14, height: 30, borderRadius: 15, justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.7)' },
  followText: { color: '#fff', fontSize: 13, ...font.bold },
})
