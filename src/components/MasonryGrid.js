import { useMemo, useState } from 'react'
import { View, Text, Image, Pressable, StyleSheet, useWindowDimensions } from 'react-native'
import { VideoView, useVideoPlayer } from 'expo-video'
import { colors, radii } from '../theme'
import { useOpenProfile } from '../lib/profileNav'
import { avatarSource } from '../lib/avatarSource'

// A grid where every tile keeps its own shape: wide photos, tall vertical videos, squares.
// Two columns; each new tile goes into whichever column is currently shorter. Videos show
// their first frame with a small play badge in the corner (only the first few load a
// player so a long feed stays light). items need { id, media_url, media_type, width?, height? }.
const GAP = 6
const MIN_RATIO = 0.6 // tallest a tile may be relative to its width... (height / width)
const MAX_RATIO = 1.9
const MAX_VIDEO_FRAMES = 8

function VideoFrame({ uri }) {
  const player = useVideoPlayer(uri, (p) => { p.muted = true })
  return <VideoView player={player} style={StyleSheet.absoluteFill} contentFit="cover" nativeControls={false} pointerEvents="none" />
}

export default function MasonryGrid({ items, onOpen, showOwner, columns = 2, onOpenProfile }) {
  const navOpenProfile = useOpenProfile()
  const openOwner = onOpenProfile ?? navOpenProfile
  const { width } = useWindowDimensions()
  const colWidth = (width - 32 - GAP * (columns - 1)) / columns
  // Photos without stored dimensions report their real size once loaded.
  const [measured, setMeasured] = useState({})

  const cols = useMemo(() => {
    const out = Array.from({ length: columns }, () => ({ h: 0, tiles: [] }))
    let videoFrames = 0
    items.forEach((m, index) => {
      const w = m.width || measured[m.id]?.w
      const h = m.height || measured[m.id]?.h
      const isVideo = m.media_type === 'video'
      const natural = w && h ? h / w : isVideo ? 1.6 : 1.2
      const ratio = Math.min(MAX_RATIO, Math.max(MIN_RATIO, natural))
      const shortest = out.reduce((best, c) => (c.h < best.h ? c : best), out[0])
      shortest.tiles.push({ m, index, height: colWidth * ratio, frame: isVideo && videoFrames++ < MAX_VIDEO_FRAMES })
      shortest.h += colWidth * ratio + GAP
    })
    return out
  }, [items, measured, columns, colWidth])

  return (
    <View style={styles.row}>
      {cols.map((c, ci) => (
        <View key={ci} style={{ width: colWidth, gap: GAP }}>
          {c.tiles.map(({ m, index, height, frame }) => (
            <Pressable key={`${m.kind ?? 'm'}-${m.id ?? index}`} onPress={() => onOpen(index)} style={[styles.tile, { height }]}>
              {m.media_type === 'video' ? (
                <>
                  {frame && m.media_url ? <VideoFrame uri={m.media_url} /> : <View style={styles.videoTile} />}
                  <View style={styles.playBadge}><Text style={styles.playText}>▶</Text></View>
                </>
              ) : (
                <Image
                  source={{ uri: m.media_url }}
                  style={styles.img}
                  onLoad={(e) => {
                    const s = e.nativeEvent?.source
                    if (!m.width && s?.width && s?.height && !measured[m.id]) {
                      setMeasured((prev) => ({ ...prev, [m.id]: { w: s.width, h: s.height } }))
                    }
                  }}
                />
              )}
              {m.kind === 'youtube' ? (
                <View style={styles.ytBadge}><Text style={styles.ytBadgeText}>▶ YouTube</Text></View>
              ) : null}
              {m.is_mine ? (
                <View style={styles.mineBadge}><Text style={styles.mineBadgeText}>You</Text></View>
              ) : null}
              {showOwner && m.owner_avatar_url ? (
                m.owner_id ? (
                  <Pressable onPress={() => openOwner(m.owner_id)} hitSlop={8} style={styles.ownerDotWrap} accessibilityRole="button" accessibilityLabel={`Open ${m.owner_username ?? 'owner'}’s profile`}>
                    <Image source={avatarSource(m?.owner_avatar_url)} style={styles.ownerDotImg} />
                  </Pressable>
                ) : <Image source={avatarSource(m?.owner_avatar_url)} style={styles.ownerDot} />
              ) : null}
            </Pressable>
          ))}
        </View>
      ))}
    </View>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: GAP, paddingHorizontal: 16, alignItems: 'flex-start' },
  // Real photo/video content, not a glass panel - same rounded-corner + two-tone rim +
  // soft shadow treatment as the rest of the app's glass surfaces, without blurring/
  // tinting the image itself.
  tile: {
    borderRadius: radii.md, overflow: 'hidden', backgroundColor: colors.inkSurfaceRaised,
    borderWidth: 1, borderTopColor: colors.glassBorderLight, borderLeftColor: colors.glassBorderLight,
    borderBottomColor: colors.glassBorderDark, borderRightColor: colors.glassBorderDark,
    shadowColor: '#5a4a80', shadowOpacity: 0.14, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 2,
  },
  img: { width: '100%', height: '100%' },
  videoTile: { flex: 1, backgroundColor: '#1a1220' },
  playBadge: {
    position: 'absolute', right: 8, bottom: 8, width: 28, height: 28, borderRadius: 14,
    backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center',
  },
  playText: { color: '#fff', fontSize: 12, marginLeft: 2 },
  ytBadge: { position: 'absolute', left: 6, top: 6, backgroundColor: '#e62117', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  ytBadgeText: { color: '#fff', fontSize: 10, fontWeight: '800' },
  mineBadge: {
    position: 'absolute', right: 8, top: 8, backgroundColor: colors.magenta, borderRadius: 999,
    paddingHorizontal: 8, paddingVertical: 2, borderWidth: 1, borderColor: 'rgba(255,255,255,0.7)',
  },
  mineBadgeText: { color: '#fff', fontSize: 10, fontWeight: '700', letterSpacing: 0.3 },
  ownerDot: { position: 'absolute', left: 8, bottom: 8, width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: '#fff' },
  ownerDotWrap: { position: 'absolute', left: 8, bottom: 8 },
  ownerDotImg: { width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: '#fff' },
})
