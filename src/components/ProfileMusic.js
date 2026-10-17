// Profile "Music" strip: a member's public sounds/songs and public playlists. Compact (top 3
// tracks), playable in place; "See all" opens their Music page. Hidden when they have none.
import { useEffect, useState } from 'react'
import { View, Text, Pressable, StyleSheet } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { publicSoundsOf, publicPlaylistsOf } from '../lib/sounds'
import { playQueue, toggle, useMusic } from '../lib/musicPlayer'
import SoundRow, { MC } from './SoundRow'
import { useT } from '../i18n'
import strings from '../i18n/strings/music'

export default function ProfileMusic({ userId, username, navigation, style }) {
  const t = useT(strings)
  const [sounds, setSounds] = useState([])
  const [lists, setLists] = useState([])
  const music = useMusic()
  useEffect(() => {
    if (!userId) return
    publicSoundsOf(userId).then(setSounds).catch(() => setSounds([]))
    publicPlaylistsOf(userId).then(setLists).catch(() => setLists([]))
  }, [userId])
  if (!sounds.length && !lists.length) return null
  const top = sounds.slice(0, 3)
  const seeAll = (tab) => navigation.navigate('Music', { userId, username, tab })
  return (
    <View style={[st.card, style]}>
      <View style={st.head}>
        <Ionicons name="musical-notes" size={16} color={MC.gold} />
        <Text style={st.title} accessibilityRole="header">{t('music')}</Text>
        <Text style={st.count}>{sounds.length ? t(sounds.length === 1 ? 'soundsOne' : 'soundsMany', { n: sounds.length }) : ''}{sounds.length && lists.length ? ' · ' : ''}{lists.length ? t(lists.length === 1 ? 'playlistsOne' : 'playlistsMany', { n: lists.length }) : ''}</Text>
        <Pressable onPress={() => seeAll(sounds.length ? 'sounds' : 'playlists')} hitSlop={8} style={{ marginLeft: 'auto' }}><Text style={st.link}>{t('seeAll')}</Text></Pressable>
      </View>
      {top.map((s, i) => (
        <SoundRow
          key={s.id}
          sound={s}
          showOwner={false}
          playing={music.current?.id === s.id && music.playing}
          onPlay={() => (music.current?.id === s.id ? toggle() : playQueue(sounds, i))}
          onPress={() => navigation.navigate('Sound', { soundId: s.id, sound: s })}
        />
      ))}
      {lists.length ? (
        <Pressable onPress={() => seeAll('playlists')} style={st.lists}>
          <Ionicons name="albums-outline" size={16} color={MC.text} />
          <Text style={st.listsText} numberOfLines={1}>{lists.slice(0, 3).map((l) => l.title).join(' · ')}</Text>
          <Ionicons name="chevron-forward" size={16} color={MC.muted} />
        </Pressable>
      ) : null}
    </View>
  )
}

const st = StyleSheet.create({
  card: { padding: 12, borderRadius: 18, backgroundColor: 'rgba(13,15,20,0.72)', borderWidth: 1, borderColor: MC.line },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  title: { color: MC.text, fontWeight: '800', fontSize: 16 },
  count: { color: MC.muted, fontSize: 12 },
  link: { color: MC.accent, fontWeight: '800', fontSize: 13 },
  lists: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8, paddingHorizontal: 4 },
  listsText: { color: MC.text, fontWeight: '600', fontSize: 14, flex: 1 },
})
