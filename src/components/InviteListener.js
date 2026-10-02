import { useEffect, useRef, useState } from 'react'
import { AppState, View, Text, Image, Pressable, Alert, StyleSheet } from 'react-native'
import { initialWindowMetrics } from 'react-native-safe-area-context'
import { StackActions } from '@react-navigation/native'
import * as Haptics from 'expo-haptics'
import GlassPanel from './GlassPanel'
import { GlassButton } from './GlassButton'
import { colors, radii, type } from '../theme'
import { supabase } from '../lib/supabase'
import { getMyUserId } from '../lib/profileNav'
import { INVITE_EVENT, inboxTopic, parseInvite } from '../lib/invites'
import { MP_GAMES, getCurrentRoom } from '../lib/multiplayer'
import { fetchUnseenBystanderTags, markBystanderTagsSeen } from '../lib/bystanderTags'

const SHOW_MS = 30000
const TAG_SHOW_MS = 12000

// Mounted once while signed in (App.js). Listens on this user's inbox channel while the
// app is in the foreground and shows a glass banner for incoming game challenges.
export default function InviteListener({ navRef }) {
  const [myId, setMyId] = useState(null)
  const [foreground, setForeground] = useState(AppState.currentState !== 'background')
  const [invite, setInvite] = useState(null)
  const hideTimer = useRef(null)
  // Laser Tag bystander alerts queue up and show one after another.
  const invRef = useRef(null)
  invRef.current = invite
  const pending = useRef([])
  const seenTagIds = useRef(new Set())

  const enqueueTag = (inv) => {
    if (inv.tagId) {
      if (seenTagIds.current.has(inv.tagId)) return
      seenTagIds.current.add(inv.tagId)
    }
    if (invRef.current) pending.current.push(inv)
    else { invRef.current = inv; setInvite(inv) }
  }
  // Close the banner; marks a bystander alert seen and shows the next queued one.
  const dismiss = () => {
    const cur = invRef.current
    if (cur?.kind === 'lt-tag' && cur.tagId) markBystanderTagsSeen([cur.tagId]).catch(() => {})
    const next = pending.current.shift() || null
    invRef.current = next
    setInvite(next)
  }

  useEffect(() => {
    let alive = true
    getMyUserId().then((id) => { if (alive) setMyId(id) })
    return () => { alive = false }
  }, [])

  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => setForeground(s !== 'background'))
    return () => sub.remove()
  }, [])

  useEffect(() => {
    if (!myId || !foreground) return undefined
    let cancelled = false
    let ch = null
    ;(async () => {
      const topic = inboxTopic(myId)
      const stale = supabase.getChannels().find((c) => c.topic === `realtime:${topic}`)
      if (stale) {
        try { await supabase.removeChannel(stale) } catch { /* ignore */ }
      }
      if (cancelled) return
      ch = supabase.channel(topic, { config: { broadcast: { self: false } } })
      ch.on('broadcast', { event: INVITE_EVENT }, ({ payload }) => {
        const inv = parseInvite(payload, myId)
        if (!inv) return
        if (inv.kind === 'lt-tag') {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {})
          enqueueTag(inv)
          return
        }
        // Already in that exact room (e.g. a repeat invite): nothing to show.
        const cur = getCurrentRoom()
        if (inv.kind === 'game' && cur && cur.gameId === inv.gameId && cur.code === inv.code) return
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {})
        setInvite(inv)
      })
      ch.subscribe()
    })()
    return () => {
      cancelled = true
      if (ch) supabase.removeChannel(ch).catch(() => {})
    }
  }, [myId, foreground])

  // Missed Laser Tag bystander alerts: on app open / foreground, newest first (max 3).
  useEffect(() => {
    if (!myId || !foreground) return undefined
    let cancelled = false
    fetchUnseenBystanderTags()
      .then((rows) => {
        if (cancelled) return
        for (const r of rows) {
          const inv = parseInvite({ kind: 'lt-tag', fromId: r.from_id, fromName: r.from_name, code: r.code, tagId: r.id }, myId)
          if (inv) enqueueTag(inv)
        }
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [myId, foreground]) // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-dismiss after a while.
  useEffect(() => {
    clearTimeout(hideTimer.current)
    if (invite) hideTimer.current = setTimeout(dismiss, invite.kind === 'lt-tag' ? TAG_SHOW_MS : SHOW_MS)
    return () => clearTimeout(hideTimer.current)
  }, [invite]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!invite) return null

  const game = MP_GAMES[invite.gameId]

  const go = (inv) => {
    if (!navRef?.isReady?.()) return
    // push (not navigate) so an already-open lobby screen isn't reused with stale state.
    navRef.dispatch(StackActions.push('GameLobby', { gameId: inv.gameId, code: inv.code }))
  }

  const fightBack = (inv) => {
    if (!navRef?.isReady?.()) return
    const current = getCurrentRoom()
    if (current?.info?.phase === 'playing') {
      Alert.alert('You’re in a match', 'Finish or leave your current game first, then head to Laser Tag to fight back.')
      return
    }
    const open = () => {
      if (inv.code) navRef.dispatch(StackActions.push('GameLobby', { gameId: 'lasertag', code: inv.code }))
      else navRef.navigate('LaserTagLobby')
    }
    if (current) {
      Alert.alert('Leave your current lobby?', 'Fighting back will leave the lobby you’re in.', [
        { text: 'Stay', style: 'cancel' },
        { text: 'Fight back', onPress: open },
      ])
      return
    }
    open()
  }

  const join = () => {
    const inv = invite
    dismiss()
    if (inv.kind === 'lt-tag') {
      fightBack(inv)
      return
    }
    if (inv.kind === 'event') {
      if (navRef?.isReady?.()) navRef.dispatch(StackActions.push('EventDetails', { eventId: inv.eventId }))
      return
    }
    const current = getCurrentRoom()
    if (current?.info?.phase === 'playing') {
      Alert.alert('You’re in a match', `Finish or leave your current game first, then join ${inv.fromName} from Arcade › Join game with code ${inv.code}.`)
      return
    }
    if (current) {
      Alert.alert('Leave your current lobby?', `Joining ${inv.fromName}’s ${MP_GAMES[inv.gameId]?.name ?? 'game'} will leave the lobby you’re in.`, [
        { text: 'Stay', style: 'cancel' },
        { text: 'Join', onPress: () => go(inv) },
      ])
      return
    }
    go(inv)
  }

  const top = (initialWindowMetrics?.insets?.top ?? 44) + 8

  return (
    <View style={[styles.wrap, { top }]} pointerEvents="box-none">
      <GlassPanel radius={radii.lg} strong style={styles.panel}>
        <View style={styles.inner}>
          <View style={styles.row}>
            {invite.fromAvatar ? (
              <Image source={{ uri: invite.fromAvatar }} style={styles.avatar} />
            ) : (
              <View style={[styles.avatar, styles.avatarFallback]}><Text style={styles.icon}>{invite.kind === 'event' ? '🎉' : invite.kind === 'lt-tag' ? '🎯' : game?.icon}</Text></View>
            )}
            <Text style={[type.body, { flex: 1 }]} numberOfLines={3}>
              {invite.kind === 'lt-tag' ? (
                <>🎯 <Text style={{ fontWeight: '700' }}>{invite.fromName}</Text> tagged you in Laser Tag! Join and fight back</>
              ) : invite.kind === 'event' ? (
                <><Text style={{ fontWeight: '700' }}>{invite.fromName}</Text> invited you to <Text style={{ fontWeight: '700' }}>{invite.title}</Text> 🎉</>
              ) : (
                <><Text style={{ fontWeight: '700' }}>{invite.fromName}</Text> challenged you to {game?.name ?? 'a game'} {game?.icon}</>
              )}
            </Text>
          </View>
          <View style={styles.buttons}>
            <GlassButton size="sm" onPress={dismiss}>{invite.kind === 'lt-tag' ? 'Dismiss' : 'Decline'}</GlassButton>
            <GlassButton size="sm" variant="primary" onPress={join}>{invite.kind === 'event' ? 'View' : invite.kind === 'lt-tag' ? 'Fight back' : 'Join'}</GlassButton>
          </View>
        </View>
      </GlassPanel>
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 12, right: 12, zIndex: 1000, elevation: 1000 },
  panel: {},
  inner: { padding: 14 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.inkSurfaceRaised },
  avatarFallback: { alignItems: 'center', justifyContent: 'center' },
  icon: { fontSize: 22 },
  buttons: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 12 },
})
