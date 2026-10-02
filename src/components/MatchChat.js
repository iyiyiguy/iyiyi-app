// Light in-game chat sheet for 1:1 online games. Messages go through the room's chat
// (room.sendChat / snapshot.chat), so they also show in the game screen's own chat panel.
// Newest at the bottom, quick reactions, max length, closes with the handle or backdrop.
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { FlatList, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { LinearGradient } from 'expo-linear-gradient'
import { AC } from '../games/arcadeUI'
import { font } from '../theme'

export const CHAT_MAX = 200
const QUICK = ['👍', '😂', '😮', '🔥', 'GG', 'Good move!', 'Oops']

export function useUnreadChat(chat, myId, open) {
  const fromOthers = useMemo(() => (chat || []).filter((m) => m && m.from !== myId).length, [chat, myId])
  const [seen, setSeen] = useState(fromOthers)
  useEffect(() => { if (open) setSeen(fromOthers) }, [open, fromOthers])
  return open ? 0 : Math.max(0, fromOthers - seen)
}

export default function MatchChat({ visible, onClose, room, chat, myId, names, connected, bottomInset = 0 }) {
  const [text, setText] = useState('')
  const listRef = useRef(null)
  const data = useMemo(() => (Array.isArray(chat) ? chat.filter((m) => m && m.text) : []), [chat])

  useEffect(() => {
    if (!visible) return undefined
    const t = setTimeout(() => { try { listRef.current?.scrollToEnd({ animated: true }) } catch { /* ignore */ } }, 60)
    return () => clearTimeout(t)
  }, [visible, data.length])

  if (!visible) return null

  const send = (msg) => {
    const t = String(msg ?? text).trim().slice(0, CHAT_MAX)
    if (!t || !room) return
    try { room.sendChat(t) } catch { /* ignore */ }
    if (msg == null) setText('')
  }

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close chat" />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.kav} pointerEvents="box-none" keyboardVerticalOffset={Platform.OS === 'ios' ? 100 : 0}>
        <View style={[styles.sheet, { paddingBottom: 10 + bottomInset }]}>
          <Pressable onPress={onClose} style={styles.handleRow} accessibilityRole="button" accessibilityLabel="Close chat">
            <View style={styles.handle} />
          </Pressable>
          <View style={styles.header}>
            <Text style={styles.title}>Match chat</Text>
            <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel="Close chat">
              <Ionicons name="chevron-down" size={22} color={AC.muted} />
            </Pressable>
          </View>
          <FlatList
            ref={listRef}
            data={data}
            keyExtractor={(m, i) => String(m?.id ?? i)}
            style={styles.list}
            contentContainerStyle={{ paddingVertical: 6 }}
            onContentSizeChange={() => { try { listRef.current?.scrollToEnd({ animated: false }) } catch { /* ignore */ } }}
            ListEmptyComponent={<Text style={styles.empty}>Say hi to your opponent 👋</Text>}
            renderItem={({ item }) => {
              const mine = item.from === myId
              return (
                <View style={[styles.msgRow, mine ? styles.mineRow : null]}>
                  <View style={[styles.bubble, mine ? styles.mine : styles.theirs]}>
                    {!mine ? <Text style={styles.from} numberOfLines={1}>{names?.[item.from] || 'Opponent'}</Text> : null}
                    <Text style={styles.msg}>{String(item.text)}</Text>
                  </View>
                </View>
              )
            }}
          />
          <View style={styles.quickRow}>
            {QUICK.map((q) => (
              <Pressable key={q} onPress={() => send(q)} disabled={!connected} style={({ pressed }) => [styles.quick, pressed && { opacity: 0.6 }, !connected && { opacity: 0.4 }]} accessibilityRole="button" accessibilityLabel={`Send ${q}`}>
                <Text style={styles.quickText}>{q}</Text>
              </Pressable>
            ))}
          </View>
          <View style={styles.inputRow}>
            <TextInput
              value={text}
              onChangeText={setText}
              placeholder={connected ? 'Message' : 'Reconnecting…'}
              placeholderTextColor={AC.faint}
              style={styles.input}
              maxLength={CHAT_MAX}
              returnKeyType="send"
              onSubmitEditing={() => send()}
              blurOnSubmit={false}
              keyboardAppearance="dark"
            />
            <Pressable onPress={() => send()} disabled={!text.trim() || !connected} accessibilityRole="button" accessibilityLabel="Send" style={({ pressed }) => [{ opacity: !text.trim() || !connected ? 0.4 : 1 }, pressed && { transform: [{ scale: 0.92 }] }]}>
              <LinearGradient colors={AC.play} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.sendBtn}>
                <Ionicons name="arrow-up" size={18} color="#fff" />
              </LinearGradient>
            </Pressable>
          </View>
          {text.length > CHAT_MAX - 30 ? <Text style={styles.count}>{text.length}/{CHAT_MAX}</Text> : null}
        </View>
      </KeyboardAvoidingView>
    </View>
  )
}

const styles = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(2,3,10,0.35)' },
  kav: { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    maxHeight: 420, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 14,
    backgroundColor: 'rgba(12,15,34,0.97)', borderWidth: 1, borderColor: AC.border, borderBottomWidth: 0,
  },
  handleRow: { alignItems: 'center', paddingTop: 8, paddingBottom: 4 },
  handle: { width: 38, height: 5, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.22)' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 2 },
  title: { fontSize: 17, ...font.bold, color: AC.text },
  list: { minHeight: 90, maxHeight: 220 },
  empty: { fontSize: 14, ...font.regular, color: AC.muted, textAlign: 'center', paddingVertical: 18 },
  msgRow: { flexDirection: 'row', marginVertical: 3 },
  mineRow: { justifyContent: 'flex-end' },
  bubble: { maxWidth: '80%', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 16 },
  mine: { backgroundColor: '#5b6cf0', borderBottomRightRadius: 5 },
  theirs: { backgroundColor: AC.cardStrong, borderBottomLeftRadius: 5 },
  from: { fontSize: 11, ...font.bold, color: AC.gold, marginBottom: 2 },
  msg: { fontSize: 15, ...font.regular, color: AC.text },
  quickRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 },
  quick: { paddingHorizontal: 11, paddingVertical: 6, borderRadius: 999, backgroundColor: AC.card, borderWidth: 1, borderColor: AC.border },
  quickText: { fontSize: 13, ...font.semibold, color: AC.text },
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10 },
  input: { flex: 1, fontSize: 15, ...font.regular, color: AC.text, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 20, backgroundColor: AC.card, borderWidth: 1, borderColor: AC.border },
  sendBtn: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  count: { fontSize: 11, ...font.medium, color: AC.faint, textAlign: 'right', marginTop: 4 },
})
