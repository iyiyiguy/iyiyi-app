import { useCallback, useContext, useEffect, useRef, useState } from 'react'
import {
  View, Text, Image, Modal, FlatList, Pressable, StyleSheet, useWindowDimensions, TextInput,
  KeyboardAvoidingView, Platform, ActivityIndicator, ScrollView, Alert,
} from 'react-native'
import EditedVideo from './EditedVideo'
import PostCaption from './PostCaption'
import { SafeAreaInsetsContext, initialWindowMetrics } from 'react-native-safe-area-context'
import { colors, radii } from '../theme'
import { apiJson, apiFetch, post, del } from '../lib/api'
import TaggedInSheet from './TaggedInSheet'
import Bounce from './Bounce'
import { removeCameraTag } from '../lib/cameraApi'
import { shareMedia } from '../lib/shareMedia'
import { displayCity } from '../lib/photoLocation'
import { useOpenProfile, useMyUserId } from '../lib/profileNav'
import { deleteMyMedia, isMyMedia } from '../lib/myContent'
import { onMediaRemoved, sameMediaId } from '../lib/mediaEvents'
import { avatarSource } from '../lib/avatarSource'
import { useT } from '../i18n'
import contentStrings from '../i18n/strings/content'

// Full-screen viewer for profile photos/videos with like, save, and comments.
// items: [{ id, media_url, media_type, owner_id, owner_username, owner_avatar_url,
//          like_count, comment_count, liked_by_me, saved_by_me }]
// Always dark: it sits over photos/video, so it doesn't follow the light/dark setting.
// onOpenProfile(userId) is optional: without it the viewer closes itself and opens the
// profile (or your own MyProfile tab) directly, so owner + tagged people are always tappable.
// Your own posts (owner_id / user_id === signed-in user, see isMyMedia) get Delete in place of
// Report; a delete is broadcast via mediaEvents.emitMediaRemoved so every list drops it.
// Safe-area insets without throwing when no provider is above us (the viewer is a Modal that
// can be opened from anywhere); falls back to the window's launch insets.
function useViewerInsets() {
  const ctx = useContext(SafeAreaInsetsContext)
  const init = initialWindowMetrics?.insets
  const top = Math.max(ctx?.top ?? 0, init?.top ?? 0)
  const bottom = Math.max(ctx?.bottom ?? 0, init?.bottom ?? 0)
  return {
    top: top || (Platform.OS === 'ios' ? 47 : 24),
    bottom,
  }
}

export default function ContentViewer({ visible, items, startIndex = 0, onClose, onOpenProfile: onOpenProfileProp, onChange }) {
  const { width, height } = useWindowDimensions()
  const insets = useViewerInsets()
  const navOpenProfile = useOpenProfile()
  const t = useT(contentStrings)
  const onOpenProfile = useCallback((id, avatarUrl = null) => {
    if (!id) return
    if (onOpenProfileProp) {
      onOpenProfileProp(id)
    } else {
      onClose?.()
      navOpenProfile(id, avatarUrl)
    }
  }, [onOpenProfileProp, onClose, navOpenProfile])
  const [list, setList] = useState(items ?? [])
  const [index, setIndex] = useState(startIndex)
  const [commentsFor, setCommentsFor] = useState(null)
  const [tagsFor, setTagsFor] = useState(null)
  const [deletingId, setDeletingId] = useState(null)
  const deletingRef = useRef(false)
  const myId = useMyUserId()
  const listRef = useRef(null)

  // The FlatList's scroll position and `index` must always agree, otherwise the photo on
  // screen and the item that like/save/report act on can differ. `index` is the source
  // of truth; scrollTo() moves the list to match it.
  const indexRef = useRef(index)
  indexRef.current = index
  const latest = useRef({ items, startIndex })
  latest.current = { items, startIndex }

  const scrollTo = useCallback((i) => {
    if (!width) return
    listRef.current?.scrollToOffset({ offset: Math.max(0, i) * width, animated: false })
  }, [width])

  // Sync only when the viewer opens. Re-syncing on every new `items` array (e.g. after the
  // parent applies an onChange) would snap back to startIndex while the user is elsewhere.
  useEffect(() => {
    if (!visible) return
    const next = latest.current.items ?? []
    const start = Math.min(Math.max(0, latest.current.startIndex ?? 0), Math.max(0, next.length - 1))
    setList(next)
    setIndex(start)
    indexRef.current = start
    const raf = requestAnimationFrame(() => scrollTo(start))
    return () => cancelAnimationFrame(raf)
  }, [visible]) // eslint-disable-line react-hooks/exhaustive-deps

  // Items can be removed (report / remove tag) which shifts what sits at the current offset.
  useEffect(() => {
    if (!visible) return
    const raf = requestAnimationFrame(() => scrollTo(indexRef.current))
    return () => cancelAnimationFrame(raf)
  }, [list.length, visible, scrollTo])

  // opts.advance: when the removed item is the one on screen, show the next one (the item
  // that slides into its slot) instead of stepping back to the previous one.
  const dropItem = (id, opts = {}) => {
    setList((prev) => {
      const removedAt = prev.findIndex((m) => sameMediaId(m.id, id))
      if (removedAt === -1) return prev
      const next = prev.filter((m) => !sameMediaId(m.id, id))
      if (next.length === 0) {
        onClose?.()
      } else {
        // Only shift the current index back if the removed item was before it (or was it,
        // unless advancing) - removing something further along in the list shouldn't move
        // which photo you're looking at.
        setIndex((i) => {
          const shift = removedAt < i || (removedAt === i && !opts.advance)
          return Math.min(next.length - 1, shift ? Math.max(0, i - 1) : i)
        })
      }
      return next
    })
    if (!opts.silent) onChange?.(id, { removed: true })
  }

  // A post deleted elsewhere (another open screen, or this viewer) leaves this list too.
  useEffect(() => {
    if (!visible) return undefined
    return onMediaRemoved((id) => dropItem(id, { advance: true, silent: true }))
  }, [visible]) // eslint-disable-line react-hooks/exhaustive-deps

  const deletePost = (m) => {
    if (!m || m.id == null || deletingRef.current) return
    Alert.alert(t('deleteTitle'), t('cantUndo'), [
      { text: t('cancel'), style: 'cancel' },
      {
        text: t('delete'),
        style: 'destructive',
        onPress: async () => {
          if (deletingRef.current) return
          deletingRef.current = true
          setDeletingId(m.id)
          try {
            await deleteMyMedia(m)
            // deleteMyMedia broadcast the removal (our listener drops it); drop it here too
            // in case the viewer was closing, and tell the parent.
            dropItem(m.id, { advance: true })
          } catch (e) {
            Alert.alert(t('deleteFailed'), e?.message || t('checkConnection'))
          } finally {
            deletingRef.current = false
            setDeletingId(null)
          }
        },
      },
    ])
  }

  const reportPost = (m) => {
    const send = async (reason) => {
      let ok = false
      let blockedOwner = false
      try {
        await post(`/api/content/${m.id}/report`, { reason })
        ok = true
      } catch (e) {
        // Already reported counts as reported.
        if (/already/i.test(e?.message ?? '')) ok = true
      }
      if (!ok && m.owner_id) {
        // Fallback: report the post's author (this also blocks them for you), with the post id
        // in the reason so the review still points at the post.
        try {
          const res = await apiFetch(`/api/profiles/report/${m.owner_id}`, {
            method: 'POST',
            body: JSON.stringify({ reason: `${reason} (post ${m.id})`, media_id: m.id }),
          })
          ok = res.ok
          blockedOwner = res.ok
        } catch {}
      }
      if (ok) {
        dropItem(m.id)
        Alert.alert(
          t('reportSent'),
          blockedOwner ? t('reportSentBlocked') : t('reportSentHidden'),
        )
      } else {
        Alert.alert(t('reportFailed'), t('checkConnection'))
      }
    }
    // The reason sent to the server stays in English (it is read by the review team).
    Alert.alert(t('reportTitle'), t('reportWhy'), [
      { text: t('reasonNudity'), onPress: () => send('Nudity or sexual content') },
      { text: t('reasonHarassment'), onPress: () => send('Harassment or hate') },
      { text: t('reasonSpam'), onPress: () => send('Spam or fake') },
      { text: t('reasonOther'), onPress: () => send('Other') },
      { text: t('cancel'), style: 'cancel' },
    ])
  }

  const removeMyTag = (m) => {
    Alert.alert(t('removeTagTitle'), t('removeTagMsg'), [
      { text: t('cancel'), style: 'cancel' },
      {
        text: t('remove'),
        style: 'destructive',
        onPress: async () => {
          try {
            await removeCameraTag(m.id)
            dropItem(m.id)
          } catch {
            Alert.alert(t('removeTagFailed'), t('tryAgain'))
          }
        },
      },
    ])
  }

  const update = (id, patch) => {
    setList((prev) => prev.map((m) => (m.id === id ? { ...m, ...patch } : m)))
    onChange?.(id, patch)
  }

  const toggleLike = async (m) => {
    const liked = !m.liked_by_me
    update(m.id, { liked_by_me: liked, like_count: Math.max(0, (m.like_count ?? 0) + (liked ? 1 : -1)) })
    try {
      if (liked) await post(`/api/profiles/media/${m.id}/like`)
      else await del(`/api/profiles/media/${m.id}/like`)
    } catch {
      update(m.id, { liked_by_me: !liked, like_count: m.like_count ?? 0 })
    }
  }

  const toggleSave = async (m) => {
    const saved = !m.saved_by_me
    update(m.id, { saved_by_me: saved })
    try {
      if (saved) await post(`/api/content/${m.id}/save`)
      else await del(`/api/content/${m.id}/save`)
    } catch {
      update(m.id, { saved_by_me: !saved })
    }
  }

  const current = list[index]
  const mine = isMyMedia(current, myId)
  const deleting = !!current && deletingId != null && sameMediaId(deletingId, current.id)

  return (
    <Modal visible={visible} animationType="fade" presentationStyle="fullScreen" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.root}>
        <FlatList
          ref={listRef}
          data={list}
          keyExtractor={(m) => String(m.id)}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          initialScrollIndex={list.length ? Math.min(index, list.length - 1) : undefined}
          getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
          onLayout={() => scrollTo(indexRef.current)}
          onMomentumScrollEnd={(e) => {
            const i = Math.round(e.nativeEvent.contentOffset.x / width)
            setIndex(Math.min(Math.max(0, i), Math.max(0, list.length - 1)))
          }}
          renderItem={({ item, index: i }) => (
            <View style={{ width, height }}>
              {item.media_type === 'video' ? (
                <VideoPage uri={item.media_url} item={item} active={visible && i === index} />
              ) : (
                <Image source={{ uri: item.media_url }} style={styles.media} resizeMode="contain" />
              )}
            </View>
          )}
        />

        <View style={[styles.topBar, { paddingTop: insets.top + 8 }]} pointerEvents="box-none">
          <Pressable onPress={onClose} hitSlop={12} style={styles.closeBtn} accessibilityRole="button" accessibilityLabel={t('close')}>
            <Text style={styles.closeText}>✕</Text>
          </Pressable>
          {list.length > 1 && <Text style={styles.counter}>{index + 1} / {list.length}</Text>}
        </View>

        {current && (
          <View style={[styles.bottom, { paddingBottom: Math.max(insets.bottom, 12) + 8 }]} pointerEvents="box-none">
            {/* Owner on its own line so a long name never runs into the action buttons. */}
            {(current.owner_username || current.owner_avatar_url || current.location_label) ? (
              <Pressable
                style={styles.owner}
                onPress={() => current.owner_id && onOpenProfile(current.owner_id, current.owner_avatar_url ?? null)}
                disabled={!current.owner_id}
                hitSlop={6}
                accessibilityRole="button"
                accessibilityLabel={current.owner_username ? t('openProfileA11y', { name: current.owner_username }) : t('openProfile')}
              >
                {<Image source={avatarSource(current?.owner_avatar_url)} style={styles.ownerAvatar} />}
                <View style={styles.ownerText}>
                  {current.owner_username ? <Text style={styles.ownerName} numberOfLines={1} ellipsizeMode="tail">{current.owner_username}</Text> : null}
                  {displayCity(current.location_label) ? <Text style={styles.locationLabel} numberOfLines={1} ellipsizeMode="tail">📍 {displayCity(current.location_label)}</Text> : null}
                </View>
              </Pressable>
            ) : null}
            <PostCaption item={current} lines={3} style={styles.caption} />

            <View style={styles.actions}>
              <ActionButton icon={current.liked_by_me ? '♥' : '♡'} label={current.like_count ?? 0} active={current.liked_by_me} selected={!!current.liked_by_me} onPress={() => toggleLike(current)} accessibilityLabel={t(current.liked_by_me ? 'unlikeA11y' : 'likeA11y', { n: current.like_count ?? 0 })} />
              <ActionButton icon="💬" label={current.comment_count ?? 0} onPress={() => setCommentsFor(current)} accessibilityLabel={t('commentsA11y', { n: current.comment_count ?? 0 })} />
              <ActionButton icon="🧑‍🤝‍🧑" label={t('tagged')} onPress={() => setTagsFor(current)} accessibilityLabel={t('taggedA11y')} />
              <ActionButton icon="↗" label={t('share')} onPress={() => shareMedia(current)} accessibilityLabel={t('shareA11y')} />
              <ActionButton icon={current.saved_by_me ? '★' : '☆'} label={current.saved_by_me ? t('savedOne') : t('save')} active={current.saved_by_me} selected={!!current.saved_by_me} onPress={() => toggleSave(current)} accessibilityLabel={t('save')} />
              {current.kind ? <ActionButton icon="✕" label={t('removeTag')} onPress={() => removeMyTag(current)} /> : null}
              {mine ? (
                <ActionButton
                  icon={deleting ? '…' : '🗑'}
                  label={deleting ? t('deleting') : t('delete')}
                  onPress={() => deletePost(current)}
                  disabled={deletingId != null}
                  accessibilityLabel={deleting ? t('deletingA11y') : t('deleteA11y')}
                />
              ) : (
                <ActionButton icon="⚑" label={t('report')} onPress={() => reportPost(current)} accessibilityLabel={t('reportTitle')} />
              )}
            </View>
          </View>
        )}

        <CommentsSheet
          media={commentsFor}
          onClose={() => setCommentsFor(null)}
          onOpenProfile={(id) => {
            setCommentsFor(null)
            onOpenProfile(id)
          }}
          onCountChange={(count) => commentsFor && update(commentsFor.id, { comment_count: count })}
        />

        <TaggedInSheet
          mediaId={tagsFor?.id}
          visible={!!tagsFor}
          onClose={() => setTagsFor(null)}
          onOpenProfile={(id) => {
            setTagsFor(null)
            onOpenProfile(id)
          }}
        />
      </View>
    </Modal>
  )
}

function VideoPage({ uri, item, active }) {
  // Plays with the post's edits and sound (EditedVideo); falls back to plain playback controls
  // when the post has no edits.
  return <EditedVideo uri={uri} mediaId={item?.kind === 'youtube' ? null : item?.id} edit={item?.edit} sound={item?.sound} active={active} style={styles.media} contentFit="contain" />
}

// Icon above its label; every button gets an equal share of the row.
function ActionButton({ icon, label, onPress, active, accessibilityLabel, disabled = false, selected }) {
  return (
    <View style={[styles.actionSlot, disabled && { opacity: 0.5 }]}>
      <Bounce onPress={onPress} disabled={disabled} style={styles.action} hitSlop={6} scaleTo={0.75} accessibilityRole="button" accessibilityState={{ disabled, selected }} accessibilityLabel={accessibilityLabel ?? String(label)}>
        <Text style={[styles.actionIcon, active && { color: colors.magenta }]} allowFontScaling={false}>{icon}</Text>
        <Text style={styles.actionLabel} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>{String(label)}</Text>
      </Bounce>
    </View>
  )
}

function CommentsSheet({ media, onClose, onCountChange, onOpenProfile }) {
  const t = useT(contentStrings)
  const [comments, setComments] = useState([])
  const [loading, setLoading] = useState(false)
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)

  useEffect(() => {
    if (!media) return
    setComments([])
    setText('')
    setLoading(true)
    apiJson(`/api/content/${media.id}/comments`)
      .then((d) => setComments(d.comments ?? []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [media?.id])

  const send = async () => {
    const body = text.trim()
    if (!body || sending) return
    setSending(true)
    try {
      await post(`/api/profiles/media/${media.id}/comments`, { body })
      setText('')
      const d = await apiJson(`/api/content/${media.id}/comments`)
      setComments(d.comments ?? [])
      onCountChange?.((d.comments ?? []).length)
    } catch {
      // keep the text so the user can retry
    } finally {
      setSending(false)
    }
  }

  const toggleCommentLike = async (c) => {
    const liked = !c.liked_by_me
    setComments((prev) => prev.map((x) => (x.id === c.id ? { ...x, liked_by_me: liked, like_count: Math.max(0, x.like_count + (liked ? 1 : -1)) } : x)))
    try {
      if (liked) await post(`/api/comments/${c.id}/like`)
      else await del(`/api/comments/${c.id}/like`)
    } catch {
      setComments((prev) => prev.map((x) => (x.id === c.id ? { ...x, liked_by_me: !liked, like_count: c.like_count } : x)))
    }
  }

  return (
    <Modal visible={!!media} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.sheetBackdrop}>
        <Pressable style={{ flex: 1 }} onPress={onClose} accessibilityRole="button" accessibilityLabel={t('close')} />
        <View style={styles.sheet}>
          <Text style={styles.sheetTitle} accessibilityRole="header">{t('comments')}</Text>
          {loading ? (
            <ActivityIndicator color="#fff" style={{ marginVertical: 24 }} />
          ) : (
            <ScrollView style={{ maxHeight: 320 }} keyboardShouldPersistTaps="handled">
              {comments.length === 0 ? <Text style={styles.empty}>{t('noComments')}</Text> : null}
              {comments.map((c) => {
                // Only tappable when the row actually says who wrote it.
                const authorId = c.user_id ?? c.author_id ?? c.profiles?.id ?? null
                return (
                <View key={c.id} style={styles.comment}>
                  <Pressable disabled={!authorId} onPress={() => onOpenProfile?.(authorId)} hitSlop={6} accessibilityRole="button" accessibilityLabel={t('openProfileA11y', { name: c.profiles?.username ?? t('someoneLower') })}>
                    {c.profiles?.avatar_url ? <Image source={avatarSource(c?.profiles?.avatar_url)} style={styles.commentAvatar} /> : <View style={styles.commentAvatar} />}
                  </Pressable>
                  <View style={{ flex: 1 }}>
                    <Pressable disabled={!authorId} onPress={() => onOpenProfile?.(authorId)} hitSlop={6} style={{ alignSelf: 'flex-start' }} accessibilityRole="button">
                      <Text style={styles.commentUser}>{c.profiles?.username ?? t('someoneLower')}</Text>
                    </Pressable>
                    <Text style={styles.commentBody}>{c.body}</Text>
                  </View>
                  <Bounce onPress={() => toggleCommentLike(c)} hitSlop={12} style={styles.commentLike} scaleTo={0.7} accessibilityRole="button" accessibilityState={{ selected: !!c.liked_by_me }} accessibilityLabel={t(c.liked_by_me ? 'unlikeCommentA11y' : 'likeCommentA11y', { n: c.like_count ?? 0 })}>
                    <Text style={[styles.commentHeart, c.liked_by_me && { color: colors.magenta }]}>{c.liked_by_me ? '♥' : '♡'}</Text>
                    {c.like_count > 0 ? <Text style={styles.commentLikeCount}>{c.like_count}</Text> : null}
                  </Bounce>
                </View>
                )
              })}
            </ScrollView>
          )}
          <View style={styles.inputRow}>
            <TextInput
              style={styles.input}
              value={text}
              onChangeText={setText}
              placeholder={t('addComment')}
              accessibilityLabel={t('addComment')}
              placeholderTextColor="#8f8298"
              maxLength={500}
              returnKeyType="send"
              onSubmitEditing={send}
            />
            <Pressable onPress={send} disabled={!text.trim() || sending} style={[styles.sendBtn, (!text.trim() || sending) && { opacity: 0.4 }]} accessibilityRole="button" accessibilityState={{ disabled: !text.trim() || sending }}>
              <Text style={styles.sendText}>{t('postComment')}</Text>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  )
}

const styles = StyleSheet.create({
  caption: { marginTop: 6, marginBottom: 2, paddingRight: 8, textShadowColor: 'rgba(0,0,0,0.6)', textShadowRadius: 4 },
  root: { flex: 1, backgroundColor: '#000' },
  media: { width: '100%', height: '100%' },
  topBar: {
    position: 'absolute', top: 0, left: 0, right: 0, paddingTop: 54, paddingHorizontal: 16,
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
  },
  closeBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center' },
  closeText: { color: '#fff', fontSize: 18 },
  counter: { color: '#fff', fontWeight: '600', backgroundColor: 'rgba(0,0,0,0.55)', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, overflow: 'hidden' },
  bottom: {
    position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 12, paddingBottom: 36, paddingTop: 14,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  owner: { flexDirection: 'row', alignItems: 'center', gap: 10, alignSelf: 'stretch', paddingHorizontal: 4, marginBottom: 12 },
  ownerAvatar: { width: 36, height: 36, borderRadius: 18, borderWidth: 1, borderColor: '#fff' },
  ownerText: { flex: 1, minWidth: 0 },
  ownerName: { color: '#fff', fontWeight: '700', fontSize: 15 },
  locationLabel: { color: 'rgba(255,255,255,0.85)', fontWeight: '600', fontSize: 11, marginTop: 2 },
  actions: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  actionSlot: { flex: 1, alignItems: 'center' },
  action: { alignItems: 'center', minWidth: 44, paddingHorizontal: 2 },
  actionIcon: { color: '#fff', fontSize: 24, lineHeight: 30, textAlign: 'center' },
  actionLabel: { color: '#fff', fontSize: 11, fontWeight: '600', marginTop: 2, textAlign: 'center' },
  sheetBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: '#171019', borderTopLeftRadius: radii.lg, borderTopRightRadius: radii.lg, padding: 16, paddingBottom: 30 },
  sheetTitle: { color: '#fff', fontWeight: '700', fontSize: 16, textAlign: 'center', marginBottom: 12 },
  empty: { color: '#8f8298', textAlign: 'center', paddingVertical: 20 },
  comment: { flexDirection: 'row', gap: 10, paddingVertical: 8, alignItems: 'flex-start' },
  commentAvatar: { width: 32, height: 32, borderRadius: 16, backgroundColor: '#2c2130' },
  commentUser: { color: '#c9bccf', fontWeight: '700', fontSize: 12 },
  commentBody: { color: '#fff', fontSize: 14, marginTop: 1 },
  commentLike: { alignItems: 'center', paddingLeft: 6 },
  commentHeart: { color: '#c9bccf', fontSize: 18 },
  commentLikeCount: { color: '#c9bccf', fontSize: 10 },
  inputRow: { flexDirection: 'row', gap: 8, marginTop: 12, alignItems: 'center' },
  input: { flex: 1, backgroundColor: '#211826', borderRadius: 999, paddingHorizontal: 16, paddingVertical: 10, color: '#fff' },
  sendBtn: { backgroundColor: colors.magenta, paddingHorizontal: 16, paddingVertical: 10, borderRadius: 999 },
  sendText: { color: '#fff', fontWeight: '700' },
})
