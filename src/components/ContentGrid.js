import { View, Text, Image, Pressable, StyleSheet, ActivityIndicator, useWindowDimensions } from 'react-native'
import { VideoView, useVideoPlayer } from 'expo-video'
import { colors, radii } from '../theme'
import { useOpenProfile } from '../lib/profileNav'

// 3-column grid of photo/video tiles. items need { id, media_url, media_type,
// owner_avatar_url? }. Videos show a play badge over a dark tile.
// Silent looping playback for a video tile. Only the first few videos autoplay so a long grid
// doesn't spin up dozens of players at once.
function AutoVideo({ uri }) {
  const player = useVideoPlayer(uri, (p) => { p.loop = true; p.muted = true; p.play() })
  return <VideoView player={player} style={StyleSheet.absoluteFill} contentFit="cover" nativeControls={false} pointerEvents="none" />
}

const MAX_AUTOPLAY = 6

// Optional: onDelete(item, index) puts a ✕ badge on each tile (your own profile);
// addTile = { onPress, busy, label } puts a "+" tile first (upload from the library).
export default function ContentGrid({
  items: rawItems, onOpen, showOwner, columns = 3, autoplay = false, tall = false, onOpenProfile, onDelete, addTile,
}) {
  const items = Array.isArray(rawItems) ? rawItems : []
  const navOpenProfile = useOpenProfile()
  const openOwner = onOpenProfile ?? navOpenProfile
  const { width } = useWindowDimensions()
  const gap = 6
  const size = Math.floor((width - 32 - gap * (columns - 1)) / columns)
  const height = tall ? size * 1.25 : size

  // Precomputed once per render, not mutated while building the JSX tree - only the
  // first MAX_AUTOPLAY videos (in list order) get a live player.
  let autoplayBudget = MAX_AUTOPLAY
  const shouldAutoplay = items.map((m) => {
    if (!autoplay || !m || m.media_type !== 'video' || !m.media_url || autoplayBudget <= 0) return false
    autoplayBudget -= 1
    return true
  })

  return (
    <View style={[styles.grid, { gap }]}>
      {addTile ? (
        <Pressable
          onPress={addTile.onPress}
          disabled={!!addTile.busy}
          style={[styles.tile, styles.addTile, { width: size, height }]}
          accessibilityRole="button"
          accessibilityLabel={addTile.label || 'Add a photo or video'}
        >
          {addTile.busy ? <ActivityIndicator color={colors.magenta} /> : <Text style={styles.addPlus}>+</Text>}
          {addTile.label ? <Text style={styles.addLabel} numberOfLines={1}>{addTile.label}</Text> : null}
        </Pressable>
      ) : null}
      {items.map((m, i) => (!m ? null : (
        <Pressable key={m.id != null ? String(m.id) : `i${i}`} onPress={() => onOpen?.(i)} style={[styles.tile, { width: size, height }]}>
          {m.media_type === 'video' ? (
            shouldAutoplay[i] ? (
              <AutoVideo uri={m.media_url} />
            ) : (
              <View style={styles.videoTile}>
                <Text style={styles.play}>▶</Text>
              </View>
            )
          ) : (
            <Image source={{ uri: m.media_url }} style={styles.img} />
          )}
          {m.kind === 'youtube' ? (
            <View style={styles.ytBadge}>
              <Text style={styles.ytBadgeText}>▶ YouTube</Text>
            </View>
          ) : null}
          {showOwner && m.owner_avatar_url ? (
            m.owner_id ? (
              <Pressable onPress={() => openOwner(m.owner_id)} hitSlop={8} style={styles.ownerDotWrap} accessibilityRole="button">
                <Image source={{ uri: m.owner_avatar_url }} style={styles.ownerDotImg} />
              </Pressable>
            ) : <Image source={{ uri: m.owner_avatar_url }} style={styles.ownerDot} />
          ) : null}
          {onDelete ? (
            <Pressable
              onPress={() => onDelete(m, i)}
              hitSlop={8}
              style={styles.deleteBadge}
              accessibilityRole="button"
              accessibilityLabel="Delete this post"
            >
              <Text style={styles.deleteText}>✕</Text>
            </Pressable>
          ) : null}
        </Pressable>
      )))}
    </View>
  )
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 16 },
  // Tiles hold real photo/video content, so no glass blur/tint here (that would just
  // muddy the image) - just the same rounded-corner + two-tone rim + soft shadow
  // treatment as every other glass surface, for visual consistency with the rest of
  // the screen.
  tile: {
    borderRadius: radii.md, overflow: 'hidden', backgroundColor: colors.inkSurfaceRaised,
    borderWidth: 1, borderTopColor: colors.glassBorderLight, borderLeftColor: colors.glassBorderLight,
    borderBottomColor: colors.glassBorderDark, borderRightColor: colors.glassBorderDark,
    shadowColor: '#5a4a80', shadowOpacity: 0.14, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 2,
  },
  img: { width: '100%', height: '100%' },
  videoTile: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#1a1220' },
  play: { color: '#f5eef2', fontSize: 26 },
  ytBadge: { position: 'absolute', top: 6, left: 6, backgroundColor: 'rgba(0,0,0,0.65)', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  ytBadgeText: { color: '#fff', fontSize: 10, fontWeight: '700' },
  ownerDot: { position: 'absolute', left: 6, bottom: 6, width: 24, height: 24, borderRadius: 12, borderWidth: 1, borderColor: '#fff' },
  ownerDotWrap: { position: 'absolute', left: 6, bottom: 6 },
  ownerDotImg: { width: 24, height: 24, borderRadius: 12, borderWidth: 1, borderColor: '#fff' },
  addTile: { alignItems: 'center', justifyContent: 'center', backgroundColor: colors.glassFill, shadowOpacity: 0 },
  addPlus: { fontSize: 30, color: colors.textMuted, lineHeight: 34 },
  addLabel: { fontSize: 11, fontWeight: '600', color: colors.textMuted, marginTop: 2 },
  deleteBadge: {
    position: 'absolute', top: 5, right: 5, width: 22, height: 22, borderRadius: 11,
    backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center',
  },
  deleteText: { color: '#fff', fontSize: 12 },
})
