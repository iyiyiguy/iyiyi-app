// Studio-look building blocks shared by the party / real-world games (Spider Spider 123,
// Beside Them, Mafia, Heads Up 7 Up). Built on the tokens in ../studio.js so these screens
// read as the same product as the shooters: dark ground, black glass panels, caps labels,
// Chakra Petch names and numbers, colour = role, square corners, no emoji in chrome.
//
// The rows keep the shared player-card behaviour of MultiplayerUI's PlayerRow: any player
// with an `id` opens the in-game player card (PlayerTapContext), and rows that aren't you
// show a Follow button unless follow={false} (action pickers).
import React, { useContext } from 'react'
import { ActivityIndicator, Image, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import GameFollowButton from '../../components/GameFollowButton'
import { useMyUserId } from '../../lib/profileNav'
import { PlayerTapContext, ProgressRing } from '../MultiplayerUI'
import { FONT, ST, StButton, StPanel, stType, withAlpha } from '../studio'

/** Full-height dark ground; scrolls by default. */
export function StScreen({ children, scroll = true, style, contentStyle, keyboardShouldPersistTaps }) {
  if (!scroll) return <View style={[k.ground, k.fill, style]}>{children}</View>
  return (
    <View style={[k.ground, k.fill, style]}>
      <ScrollView contentContainerStyle={[k.pad, contentStyle]} keyboardShouldPersistTaps={keyboardShouldPersistTaps}>
        {children}
      </ScrollView>
    </View>
  )
}

export function StLabel({ children, color, style }) {
  return <Text style={[stType.label, color && { color }, style]} numberOfLines={1}>{children}</Text>
}

/** Panel with a caps label header (and optional right-hand label). */
export function StSection({ label, right, accent, side, children, style, strong }) {
  return (
    <StPanel accent={accent} side={side} strong={strong} style={[k.section, style]}>
      {label || right ? (
        <View style={k.sectionHead}>
          <StLabel style={{ flex: 1 }}>{label}</StLabel>
          {typeof right === 'string' ? <StLabel>{right}</StLabel> : right}
        </View>
      ) : null}
      {children}
    </StPanel>
  )
}

/** Square avatar: photo, or the initial on a slate tile, with a role-colour bottom edge. */
export function StAvatar({ uri, name, size = 40, color }) {
  const edge = color ? { borderBottomWidth: 3, borderBottomColor: color } : null
  if (uri) return <Image source={{ uri }} style={[{ width: size, height: size, borderRadius: ST.radius, backgroundColor: '#2a3038' }, edge]} />
  return (
    <View style={[k.avatar, { width: size, height: size }, edge]}>
      <Text style={[stType.num, { fontSize: Math.round(size * 0.42) }]}>{(name || '?').slice(0, 1).toUpperCase()}</Text>
    </View>
  )
}

/** Small square caps tag (replaces the old rounded Pill). */
export function StTag({ text, color = ST.friendly, solid = false, style }) {
  return (
    <View style={[k.tag, { borderColor: color, backgroundColor: solid ? color : withAlpha(color, 0.12) }, style]}>
      <Text style={[k.tagText, { color: solid ? ST.ink : color }]} numberOfLines={1}>{text}</Text>
    </View>
  )
}

/** Player row: tap opens the player card, Follow on everyone but you (unless follow={false}). */
export function StPlayerRow({ player, subtitle, subtitleColor, right, dim, follow = true, color, selected, style }) {
  const onTap = useContext(PlayerTapContext)
  const myId = useMyUserId()
  const showFollow = follow && !!onTap && !!player?.id && !!myId && player.id !== myId
  const body = (
    <>
      <StAvatar uri={player.avatar} name={player.username} color={color} />
      <View style={{ flex: 1, minWidth: 0, marginLeft: 10 }}>
        <Text style={stType.name} numberOfLines={1}>{player.username || 'Player'}</Text>
        {subtitle ? <Text style={[stType.small, { fontSize: 11, lineHeight: 15 }, subtitleColor && { color: subtitleColor }]} numberOfLines={1}>{subtitle}</Text> : null}
      </View>
    </>
  )
  return (
    <View style={[k.row, selected && { borderColor: color || ST.friendly, backgroundColor: withAlpha(color || ST.friendly, 0.14) }, dim && { opacity: 0.45 }, style]}>
      {onTap && player?.id ? (
        <Pressable
          onPress={() => onTap(player)}
          style={({ pressed }) => [k.rowTap, pressed && { opacity: 0.7 }]}
          accessibilityRole="button"
          accessibilityLabel={`View ${player.username || 'player'}’s profile`}
          hitSlop={4}
        >
          {body}
        </Pressable>
      ) : (
        <View style={k.rowTap}>{body}</View>
      )}
      {right ? <View style={{ marginLeft: 8 }}>{right}</View> : null}
      {showFollow ? <GameFollowButton userId={player.id} name={player.username} size="sm" style={{ marginLeft: 8 }} /> : null}
    </View>
  )
}

/**
 * Selectable player tile for pick grids (Mafia night, Heads Up). Tap selects; long-press
 * opens the player card (with Follow) so a pick grid never navigates away by accident.
 */
export function StPlayerTile({ player, tag, selected, onPress, disabled, color = ST.friendly, dim, compact }) {
  const onTap = useContext(PlayerTapContext)
  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      onLongPress={onTap && player?.id ? () => onTap(player) : undefined}
      delayLongPress={350}
      accessibilityRole="button"
      accessibilityState={{ selected: !!selected, disabled: !!disabled }}
      accessibilityLabel={`${player.username || 'Player'}${tag ? `, ${tag}` : ''}`}
      accessibilityHint={onTap && player?.id ? 'Long-press for their profile' : undefined}
      style={({ pressed }) => [
        compact ? k.tileRow : k.tile,
        selected ? { borderWidth: 2, borderColor: color, backgroundColor: withAlpha(color, 0.18) } : null,
        (dim || disabled) && !selected ? { opacity: 0.4 } : null,
        pressed && !disabled ? { opacity: 0.8 } : null,
      ]}
    >
      <StAvatar uri={player.avatar} name={player.username} size={compact ? 32 : 44} />
      <View style={compact ? { flex: 1, minWidth: 0 } : { alignItems: 'center', maxWidth: '100%' }}>
        <Text style={[k.tileName, !compact && { textAlign: 'center' }]} numberOfLines={1}>{player.username || 'Player'}</Text>
        {tag ? <Text style={[k.tileTag, !compact && { textAlign: 'center' }]} numberOfLines={1}>{tag}</Text> : null}
      </View>
    </Pressable>
  )
}

/** Grid wrapper: `cols` equal columns with 8 px gaps. */
export function StGrid({ cols = 3, children, style }) {
  const items = React.Children.toArray(children)
  return (
    <View style={[k.grid, style]}>
      {items.map((c, i) => (
        <View key={c.key ?? i} style={{ width: `${100 / cols}%`, padding: 4 }}>{c}</View>
      ))}
    </View>
  )
}

/** One-line banner (notices, alerts). */
export function StBanner({ text, sub, color = ST.friendly, icon, solid = false, children, style }) {
  const fg = solid ? (color === ST.enemy ? '#ffffff' : ST.ink) : ST.text
  return (
    <View style={[k.banner, solid ? { backgroundColor: color } : { backgroundColor: withAlpha(color, 0.12), borderLeftWidth: 3, borderLeftColor: color }, style]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        {icon ? <Ionicons name={icon} size={16} color={solid ? fg : color} /> : null}
        <Text style={[stType.body, { flex: 1, color: fg, fontFamily: FONT.ui }]}>{text}</Text>
      </View>
      {sub ? <Text style={[stType.small, { color: solid ? fg : ST.muted, marginTop: 3, opacity: solid ? 0.85 : 1 }]}>{sub}</Text> : null}
      {children}
    </View>
  )
}

/** Event feed list. */
export function StFeed({ items, label = 'Feed', max = 8 }) {
  if (!items?.length) return null
  return (
    <StSection label={label}>
      {items.slice(0, max).map((f, i) => (
        <Text key={f.id ?? i} style={[stType.small, { color: i === 0 ? ST.text : ST.muted, marginVertical: 2 }]}>{f.text}</Text>
      ))}
    </StSection>
  )
}

/** Big centre header: kicker, title, sub. */
export function StHero({ kicker, title, sub, color = ST.friendly, big = false, style }) {
  return (
    <View style={[{ alignItems: 'center', gap: 2, paddingVertical: 10 }, style]}>
      {kicker ? <Text style={[stType.kicker, { color, textAlign: 'center' }]} numberOfLines={1}>{kicker}</Text> : null}
      {title ? <Text style={[big ? stType.display : stType.title, { textAlign: 'center' }, !big && { fontSize: 26 }]} numberOfLines={2} adjustsFontSizeToFit minimumFontScale={0.6}>{title}</Text> : null}
      {sub ? <Text style={[stType.small, { textAlign: 'center', color: 'rgba(242,244,247,0.75)' }]} numberOfLines={3}>{sub}</Text> : null}
    </View>
  )
}

/** Segmented ring with a number in the middle (timers, tag hold). */
export function StRing({ size = 84, progress = 0, color = ST.objective, value, unit }) {
  return (
    <ProgressRing size={size} progress={progress} color={color} trackColor="rgba(255,255,255,0.12)" thickness={5} segments={40}>
      <View style={{ alignItems: 'center' }}>
        <Text style={[stType.num, { fontSize: Math.round(size * 0.3) }]}>{value}</Text>
        {unit ? <Text style={[stType.label, { fontSize: 9 }]}>{unit}</Text> : null}
      </View>
    </ProgressRing>
  )
}

/** Full-screen role reveal / countdown. */
export function StReveal({ kicker, title, body, count, color = ST.friendly, icon, foot }) {
  return (
    <View style={[k.ground, k.fill, k.center, { padding: 24 }]}>
      <View style={[k.revealEdge, { backgroundColor: color }]} />
      {icon ? (
        <View style={[k.revealIcon, { borderColor: color, backgroundColor: withAlpha(color, 0.12) }]}>
          <Ionicons name={icon} size={40} color={color} />
        </View>
      ) : null}
      {kicker ? <Text style={[stType.kicker, { color, textAlign: 'center' }]}>{kicker}</Text> : null}
      <Text style={[stType.display, { textAlign: 'center', color, marginTop: 4 }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.5}>{title}</Text>
      {body ? <Text style={[stType.body, { textAlign: 'center', marginTop: 10, maxWidth: 320 }]}>{body}</Text> : null}
      {count != null ? <Text style={[stType.num, { fontSize: 72, marginTop: 22 }]}>{count}</Text> : null}
      {foot ? <Text style={[stType.label, { marginTop: 10, textAlign: 'center' }]}>{foot}</Text> : null}
    </View>
  )
}

/** Stat strip: [{ label, value, color }]. */
export function StStats({ items, style }) {
  return (
    <View style={[{ flexDirection: 'row', gap: 6, marginBottom: 10 }, style]}>
      {items.map((it) => (
        <View key={it.label} style={k.stat}>
          <Text style={stType.label} numberOfLines={1}>{it.label}</Text>
          <Text style={[stType.num, { fontSize: 20, color: it.color || ST.text }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>{it.value}</Text>
        </View>
      ))}
    </View>
  )
}

/** MVP card (results). */
export function StMvp({ player, line, color = ST.objective }) {
  const onTap = useContext(PlayerTapContext)
  const inner = (
    <>
      <Ionicons name="star-outline" size={30} color={color} />
      <StAvatar uri={player.avatar} name={player.username} size={44} color={color} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[stType.label, { color }]}>MVP</Text>
        <Text style={[stType.name, { fontSize: 18 }]} numberOfLines={1}>{player.username}</Text>
        {line ? <Text style={stType.small} numberOfLines={1}>{line}</Text> : null}
      </View>
    </>
  )
  const box = [k.mvp, { borderColor: color, backgroundColor: withAlpha(color, 0.08) }]
  if (onTap && player?.id) {
    return <Pressable onPress={() => onTap(player)} style={({ pressed }) => [box, pressed && { opacity: 0.8 }]} accessibilityRole="button" accessibilityLabel={`MVP ${player.username}, view profile`}>{inner}</Pressable>
  }
  return <View style={box}>{inner}</View>
}

/** Results footer: host rematch + leave. */
export function StResultsFooter({ isHost, onAgain, onExit, againTitle = 'Rematch', waiting = 'Waiting for the host to start another round…' }) {
  return (
    <View style={{ gap: 8, marginTop: 4 }}>
      {isHost ? <StButton title={againTitle} onPress={onAgain} /> : <Text style={[stType.small, { textAlign: 'center' }]}>{waiting}</Text>}
      <StButton title="Leave" tone="ghost" onPress={onExit} />
    </View>
  )
}

/** Studio version of MultiplayerUI's LocationGate (always dark, legible in light mode too). */
export function StLocationGate({ status, onExit, what = 'This game' }) {
  if (status === 'granted') return null
  if (status === 'pending') {
    return (
      <View style={[k.ground, k.fill, k.center]}>
        <ActivityIndicator color={ST.friendly} />
        <Text style={[stType.label, { marginTop: 12 }]}>Getting your location</Text>
      </View>
    )
  }
  return (
    <View style={[k.ground, k.fill, k.center, { padding: 24 }]}>
      <Ionicons name="navigate-outline" size={36} color={ST.objective} />
      <Text style={[stType.title, { textAlign: 'center', marginTop: 10 }]}>Location needed</Text>
      <Text style={[stType.body, { textAlign: 'center', marginVertical: 12 }]}>
        {what} is played in the real world, so it needs your location to know how close other players are. Your exact location is only shared with players in this match while you play.
      </Text>
      {status === 'denied' ? <StButton title="Open settings" onPress={() => Linking.openSettings().catch(() => {})} style={{ alignSelf: 'stretch' }} /> : null}
      {status === 'error' ? <Text style={[stType.small, { textAlign: 'center' }]}>Couldn’t read your location. Make sure Location Services are on.</Text> : null}
      <StButton title="Leave game" tone="ghost" onPress={onExit} style={{ marginTop: 10, alignSelf: 'stretch' }} />
    </View>
  )
}

/** Studio version of Spectating. */
export function StSpectating({ text = 'A round is in progress. You’ll be in the next one.', title = 'Round in progress' }) {
  return (
    <View style={[k.ground, k.fill, k.center, { padding: 24 }]}>
      <Ionicons name="eye-outline" size={32} color={ST.muted} />
      <Text style={[stType.title, { textAlign: 'center', marginTop: 10 }]}>{title}</Text>
      <Text style={[stType.body, { textAlign: 'center', marginTop: 8 }]}>{text}</Text>
    </View>
  )
}

const k = StyleSheet.create({
  ground: { backgroundColor: ST.ground },
  fill: { flex: 1 },
  center: { alignItems: 'center', justifyContent: 'center' },
  pad: { padding: 12, paddingBottom: 40 },
  section: { marginBottom: 10 },
  sectionHead: { flexDirection: 'row', alignItems: 'center', marginBottom: 6, gap: 8 },
  avatar: { borderRadius: ST.radius, backgroundColor: '#2a3038', alignItems: 'center', justifyContent: 'center' },
  tag: { paddingHorizontal: 6, height: 22, justifyContent: 'center', borderRadius: ST.radius, borderWidth: 1 },
  tagText: { fontFamily: FONT.ui, fontSize: 11, letterSpacing: 1.2, textTransform: 'uppercase' },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 7, paddingHorizontal: 8, marginVertical: 2, backgroundColor: 'rgba(255,255,255,0.04)', borderRadius: ST.radius, borderWidth: 1, borderColor: 'transparent' },
  rowTap: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -4 },
  tile: { minHeight: 104, paddingVertical: 10, paddingHorizontal: 4, alignItems: 'center', justifyContent: 'center', gap: 5, backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', borderRadius: ST.radius },
  tileRow: { height: 52, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', borderRadius: ST.radius },
  tileName: { fontFamily: FONT.ui, fontSize: 14, color: ST.text },
  tileTag: { fontFamily: FONT.ui, fontSize: 10, letterSpacing: 1.2, color: 'rgba(242,244,247,0.55)', textTransform: 'uppercase' },
  banner: { padding: 12, marginBottom: 10, borderRadius: ST.radius },
  stat: { flex: 1, padding: 8, backgroundColor: ST.cell, borderRadius: ST.radius, gap: 2 },
  mvp: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderWidth: 1, borderRadius: ST.radius, marginBottom: 10 },
  revealEdge: { position: 'absolute', top: 0, left: 0, right: 0, height: 3 },
  revealIcon: { width: 84, height: 84, borderRadius: ST.radius, borderWidth: 2, alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
})
