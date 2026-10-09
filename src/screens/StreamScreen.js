import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  View, Text, Image, Pressable, Animated, Easing, StyleSheet, AppState, ActivityIndicator, useWindowDimensions,
} from 'react-native'
import { useFocusEffect } from '@react-navigation/native'
import { LinearGradient } from 'expo-linear-gradient'
import { Ionicons } from '@expo/vector-icons'
import * as Location from 'expo-location'
import * as Haptics from 'expo-haptics'
import BrandHeader from '../components/BrandHeader'
import Glass from '../components/Glass'
import ContentViewer from '../components/ContentViewer'
import { LiveDot } from '../components/LiveButton'
import { colors, font, radii } from '../theme'
import { apiJson } from '../lib/api'
import { supabase } from '../lib/supabase'
import { openProfile, getMyUserId } from '../lib/profileNav'
import { fetchMyMedia, mergeMine, itemFromMediaRow } from '../lib/myContent'
import { onMediaPosted } from '../lib/mediaEvents'
import { avatarSource } from '../lib/avatarSource'

// Live Stream as a 3D cover-flow "TV": the current photo is a big portrait card in the
// centre, ~3 cards each side recede in perspective (rotated toward the centre, smaller,
// dimmer), each with a soft mirror reflection. Oldest is on the left, newest on the right.
//
// LIVE (default): each new upload slides in from the right and becomes the centre card the
// moment it arrives. With nothing new, it drifts back through recent photos every ~4s like a
// screensaver, and snaps back to the newest when something new lands.
// Swiping scrubs with momentum and pauses auto-play; a "● LIVE" pill jumps back.
//
// Every card's transform is interpolated from one native-driven scroll position, so the
// motion runs on the UI thread at 60fps.
//
// Sources: Realtime INSERTs on profile_media (needs supabase/migrations/005_stream_realtime.sql),
// your own camera posts via lib/mediaEvents, and a 10s poll of /api/content/feed
// (scope=global, sort=recent) plus your own uploads as the fallback.

const POLL_MS = 10000
const AUTOPLAY_MS = 4000
const MAX_ITEMS = 150
const SIDE = 3 // cards visible each side
const RENDER_WINDOW = SIDE + 3 // cards mounted each side (extra for fast scrubs)
const IDLE_DEPTH = 12 // how far back the screensaver drifts before returning to the newest
const STAGE_BG = '#05060a'

const keyOf = (m) => String(m?.id)
const toTime = (v) => {
  const t = v ? Date.parse(v) : NaN
  return Number.isFinite(t) ? t : null
}
const isPhoto = (m) => m && m.kind !== 'youtube' && m.media_url && m.media_type !== 'video'

function sortOldestFirst(list) {
  if (!list.every((m) => toTime(m.created_at) != null)) return list
  return [...list].sort((a, b) => toTime(a.created_at) - toTime(b.created_at))
}

function dedupe(list) {
  const seen = new Set()
  return list.filter((m) => {
    const k = keyOf(m)
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
}

function timeAgo(v, now) {
  const t = toTime(v)
  if (t == null) return ''
  const s = Math.max(0, Math.round((now - t) / 1000))
  if (s < 45) return 'just now'
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.round(h / 24)}d ago`
}

const clampIndex = (i, n) => (n <= 0 ? 0 : Math.min(n - 1, Math.max(0, Math.round(Number(i) || 0))))

export default function StreamScreen({ navigation }) {
  const { width: screenW } = useWindowDimensions()
  const [items, setItems] = useState([]) // oldest -> newest (display order)
  const [fresh, setFresh] = useState(() => new Set())
  const [loaded, setLoaded] = useState(false)
  const [live, setLive] = useState(true)
  const [index, setIndex] = useState(0)
  const [unseen, setUnseen] = useState(0)
  const [stageH, setStageH] = useState(0)
  const [now, setNow] = useState(Date.now())
  const [viewer, setViewer] = useState({ open: false, index: 0 })

  const known = useRef(new Set())
  const coords = useRef(null)
  const alive = useRef(true)
  const scrollRef = useRef(null)
  const indexRef = useRef(0)
  const itemsRef = useRef(items)
  itemsRef.current = items
  const liveRef = useRef(live)
  liveRef.current = live
  const viewerOpenRef = useRef(false)
  viewerOpenRef.current = viewer.open
  const dragging = useRef(false)
  const lastArrival = useRef(0)
  const freshTimers = useRef([])
  const scrollX = useRef(new Animated.Value(0)).current

  useEffect(() => () => {
    alive.current = false
    freshTimers.current.forEach(clearTimeout)
  }, [])

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30000)
    return () => clearInterval(t)
  }, [])

  // Geometry: portrait cards sized to the stage; scrolling one step (STEP px) moves one card.
  const cardW = Math.max(120, Math.min(screenW * 0.56, stageH > 0 ? (stageH * 0.66) / 1.42 : screenW * 0.56))
  const cardH = cardW * 1.42
  const reflH = cardH * 0.28
  const STEP = cardW * 0.5
  const sidePad = (screenW - cardW) / 2
  const n = items.length

  const markFresh = useCallback((ids) => {
    if (!ids.length) return
    setFresh((prev) => {
      const next = new Set(prev)
      ids.forEach((id) => next.add(id))
      return next
    })
    const t = setTimeout(() => {
      if (!alive.current) return
      setFresh((prev) => {
        const next = new Set(prev)
        ids.forEach((id) => next.delete(id))
        return next
      })
    }, 8000)
    freshTimers.current.push(t)
  }, [])

  // Move the carousel to card i (animated = the smooth slide).
  const goTo = useCallback((i, animated = true) => {
    const len = itemsRef.current.length
    if (!len) return
    const target = clampIndex(i, len)
    indexRef.current = target
    setIndex(target)
    try {
      if (!animated) scrollX.setValue(target * STEP)
      scrollRef.current?.scrollTo?.({ x: target * STEP, animated })
    } catch {}
  }, [STEP, scrollX])

  // New photos join the right-hand end. Live: jump to the newest. Otherwise count them.
  const ingest = useCallback((list, initial = false) => {
    if (!alive.current) return
    const photos = dedupe((Array.isArray(list) ? list : []).filter(isPhoto))
    if (initial) {
      photos.forEach((m) => known.current.add(keyOf(m)))
      const ordered = sortOldestFirst(photos).slice(-MAX_ITEMS)
      itemsRef.current = ordered
      indexRef.current = Math.max(0, ordered.length - 1)
      setIndex(indexRef.current)
      setItems(ordered)
      setLoaded(true)
      // Start on the newest once the content has laid out.
      setTimeout(() => { if (alive.current) goTo(ordered.length - 1, false) }, 50)
      return
    }
    const newOnes = photos.filter((m) => !known.current.has(keyOf(m)))
    if (!newOnes.length) return
    newOnes.forEach((m) => known.current.add(keyOf(m)))
    const prevLen = itemsRef.current.length
    const next = sortOldestFirst(dedupe([...itemsRef.current, ...newOnes])).slice(-MAX_ITEMS)
    const trimmed = prevLen + newOnes.length - next.length // dropped off the left
    itemsRef.current = next
    setItems(next)
    markFresh(newOnes.map(keyOf))
    lastArrival.current = Date.now()
    setLoaded(true)
    if (liveRef.current && !dragging.current) {
      Haptics.selectionAsync().catch(() => {})
      // Let the new card mount, then glide to it.
      setTimeout(() => { if (alive.current) goTo(itemsRef.current.length - 1, true) }, 60)
    } else {
      setUnseen((u) => u + newOnes.length)
      // Keep the card you're looking at in place when old ones fall off the left.
      if (trimmed > 0) setTimeout(() => { if (alive.current) goTo(indexRef.current - trimmed, false) }, 30)
    }
  }, [goTo, markFresh])

  const getCoords = useCallback(async () => {
    if (coords.current) return coords.current
    try {
      const { status } = await Location.getForegroundPermissionsAsync()
      if (status === 'granted') {
        const last = await Location.getLastKnownPositionAsync()
        const pos = last ?? await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced })
        if (pos?.coords) {
          coords.current = { latitude: pos.coords.latitude, longitude: pos.coords.longitude }
          return coords.current
        }
      }
    } catch {}
    return { latitude: 0, longitude: 0 }
  }, [])

  const fetchLatest = useCallback(async () => {
    const c = await getCoords()
    const [feed, mine, myId] = await Promise.all([
      apiJson(`/api/content/feed?lat=${c.latitude}&lng=${c.longitude}&scope=global&sort=recent`).catch(() => null),
      fetchMyMedia(15).catch(() => []),
      getMyUserId(),
    ])
    return mergeMine(Array.isArray(feed?.items) ? feed.items : [], mine, myId)
  }, [getCoords])

  // Your own camera posts arrive instantly through mediaEvents.
  useEffect(() => {
    const off = onMediaPosted((row) => {
      itemFromMediaRow(row).then((item) => { if (item && alive.current) ingest([item]) }).catch(() => {})
    })
    return () => { off?.() }
  }, [ingest])

  useFocusEffect(
    useCallback(() => {
      let cancelled = false
      let channel = null
      let debounce = null

      const poll = async (initial = false) => {
        try {
          const list = await fetchLatest()
          if (!cancelled) ingest(list, initial && known.current.size === 0)
        } catch (e) {
          console.warn('Stream refresh failed', e?.message ?? e)
          if (!cancelled && initial) setLoaded(true)
        }
      }

      poll(true)
      const followUp = setTimeout(() => { if (!cancelled) poll(false) }, 4000)
      const timer = setInterval(() => {
        if (AppState.currentState === 'active') poll(false)
      }, POLL_MS)

      try {
        channel = supabase
          .channel(`stream-media-${Date.now()}`)
          .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'profile_media' }, (payload) => {
            if (cancelled) return
            itemFromMediaRow(payload?.new)
              .then((item) => { if (item && !cancelled) ingest([item]) })
              .catch(() => {})
            if (debounce) clearTimeout(debounce)
            debounce = setTimeout(() => { if (!cancelled) poll(false) }, 2500)
          })
          .subscribe()
      } catch (e) {
        console.warn('Stream realtime unavailable', e?.message ?? e)
      }

      return () => {
        cancelled = true
        clearTimeout(followUp)
        clearInterval(timer)
        if (debounce) clearTimeout(debounce)
        if (channel) supabase.removeChannel(channel).catch(() => {})
      }
    }, [fetchLatest, ingest])
  )

  // Screensaver: while Live and idle, step back through recent photos every ~4s, then return
  // to the newest. A new arrival (handled in ingest) interrupts it.
  useEffect(() => {
    if (!live || viewer.open || n < 2) return
    const t = setInterval(() => {
      if (!alive.current || dragging.current || viewerOpenRef.current) return
      if (Date.now() - lastArrival.current < AUTOPLAY_MS * 1.5) return
      const len = itemsRef.current.length
      const cur = indexRef.current
      const floor = Math.max(0, len - 1 - IDLE_DEPTH)
      goTo(cur <= floor ? len - 1 : cur - 1, true)
    }, AUTOPLAY_MS)
    return () => clearInterval(t)
  }, [live, viewer.open, n, goTo])

  useEffect(() => { if (live) setUnseen(0) }, [live])

  const onScroll = useMemo(() => Animated.event(
    [{ nativeEvent: { contentOffset: { x: scrollX } } }],
    {
      useNativeDriver: true,
      listener: (e) => {
        const x = e?.nativeEvent?.contentOffset?.x ?? 0
        const i = clampIndex(x / (STEP || 1), itemsRef.current.length)
        if (i !== indexRef.current) {
          indexRef.current = i
          setIndex(i)
          if (dragging.current) Haptics.selectionAsync().catch(() => {})
        }
      },
    }
  ), [scrollX, STEP])

  const onDragStart = () => {
    dragging.current = true
    if (liveRef.current) setLive(false)
  }
  const onDragEnd = () => { dragging.current = false }

  const backToLive = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {})
    setLive(true)
    setUnseen(0)
    lastArrival.current = Date.now()
    goTo(itemsRef.current.length - 1, true)
  }

  const toggleLive = () => {
    if (live) {
      Haptics.selectionAsync().catch(() => {})
      setLive(false)
    } else {
      backToLive()
    }
  }

  const cur = items[clampIndex(index, n)]
  const lastHour = items.filter((m) => {
    const t = toTime(m.created_at)
    return t != null && now - t < 3600000
  }).length

  const ci = clampIndex(index, n)
  const lo = Math.max(0, ci - RENDER_WINDOW)
  const hi = Math.min(n - 1, ci + RENDER_WINDOW)
  const windowed = []
  for (let i = lo; i <= hi; i += 1) windowed.push(i)
  // Centre card drawn last (on top), then outward.
  windowed.sort((a, b) => Math.abs(b - ci) - Math.abs(a - ci))

  return (
    <View style={styles.screen}>
      <BrandHeader
        title="Live"
        subtitle={loaded ? `${n} ${n === 1 ? 'photo' : 'photos'}${lastHour ? ` · ${lastHour} in the last hour` : ''}` : 'Connecting…'}
        onBack={() => navigation.goBack()}
        right={
          <Pressable
            onPress={toggleLive}
            hitSlop={6}
            accessibilityRole="switch"
            accessibilityState={{ checked: live }}
            accessibilityLabel="Live mode"
            style={({ pressed }) => [pressed && { transform: [{ scale: 0.95 }] }]}
          >
            <Glass radius={radii.pill} interactive shadow={false} style={[styles.liveToggle, live && styles.liveToggleOn]}>
              {live ? <LiveDot size={7} /> : <Ionicons name="pause" size={12} color={colors.text} />}
              <Text style={styles.liveToggleText}>{live ? 'LIVE' : 'Paused'}</Text>
            </Glass>
          </Pressable>
        }
      />

      <View
        style={styles.stage}
        onLayout={(e) => {
          const h = Math.round(e?.nativeEvent?.layout?.height ?? 0)
          if (h > 0 && h !== stageH) setStageH(h)
        }}
      >
        <LinearGradient
          colors={['rgba(91,108,240,0.18)', 'rgba(5,6,10,0)']}
          style={styles.stageGlow}
          pointerEvents="none"
        />
        {!loaded ? (
          <View style={styles.center}>
            <ActivityIndicator color="#fff" />
            <Text style={styles.centerCaption}>Tuning in…</Text>
          </View>
        ) : n === 0 ? (
          <View style={styles.center}>
            <View style={styles.emptyOrb}><LiveDot size={12} /></View>
            <Text style={styles.emptyTitle}>Waiting for the first photo</Text>
            <Text style={styles.centerCaption}>New uploads play here the moment they're posted.</Text>
          </View>
        ) : stageH > 0 ? (
          <>
            <Animated.ScrollView
              ref={scrollRef}
              horizontal
              showsHorizontalScrollIndicator={false}
              snapToInterval={STEP}
              decelerationRate="fast"
              scrollEventThrottle={16}
              onScroll={onScroll}
              onScrollBeginDrag={onDragStart}
              onScrollEndDrag={onDragEnd}
              onMomentumScrollEnd={onDragEnd}
              contentContainerStyle={{ width: (n - 1) * STEP + screenW, height: stageH }}
              style={StyleSheet.absoluteFill}
              onLayout={() => goTo(indexRef.current, false)}
            >
              {windowed.map((i) => {
                const m = items[i]
                if (!m) return null
                return (
                  <CoverCard
                    key={keyOf(m)}
                    item={m}
                    i={i}
                    scrollX={scrollX}
                    step={STEP}
                    left={sidePad + i * STEP}
                    top={Math.max(8, (stageH - cardH - reflH) / 2 - 10)}
                    cardW={cardW}
                    cardH={cardH}
                    reflH={reflH}
                    zIndex={100 - Math.abs(i - ci)}
                    centered={i === ci}
                    fresh={fresh.has(keyOf(m))}
                    now={now}
                    onPress={() => {
                      if (i === indexRef.current) {
                        setViewer({ open: true, index: i })
                      } else {
                        if (liveRef.current) setLive(false)
                        goTo(i, true)
                      }
                    }}
                    onOwner={() => openProfile(navigation, m.owner_id)}
                  />
                )
              })}
            </Animated.ScrollView>

            <View style={styles.footer} pointerEvents="box-none">
              {!live ? (
                <Pressable onPress={backToLive} accessibilityRole="button" accessibilityLabel="Back to live" style={({ pressed }) => [pressed && { transform: [{ scale: 0.95 }] }]}>
                  <View style={styles.pill}>
                    <LiveDot size={7} />
                    <Text style={styles.pillText}>{unseen > 0 ? `LIVE · ${unseen} new` : 'LIVE'}</Text>
                  </View>
                </Pressable>
              ) : (
                <Text style={styles.footerText} numberOfLines={1}>
                  {cur ? `${cur.is_mine ? 'You' : cur.owner_username ?? 'Someone'} · ${timeAgo(cur.created_at, now) || 'recent'}` : ''}
                </Text>
              )}
              <Text style={styles.counter}>{clampIndex(index, n) + 1} / {n}</Text>
            </View>
          </>
        ) : null}
      </View>

      <ContentViewer
        visible={viewer.open}
        items={items}
        startIndex={viewer.index}
        onClose={() => setViewer({ open: false, index: 0 })}
        onOpenProfile={(id) => {
          setViewer({ open: false, index: 0 })
          openProfile(navigation, id)
        }}
      />
    </View>
  )
}

// One cover-flow card + its reflection. All motion comes from scrollX (native driver):
// d = i - scrollX/step is the card's distance from the centre (positive = right side).
function CoverCard({ item, i, scrollX, step, left, top, cardW, cardH, reflH, zIndex, centered, fresh, now, onPress, onOwner }) {
  const enter = useRef(new Animated.Value(0)).current
  useEffect(() => {
    Animated.timing(enter, { toValue: 1, duration: 520, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start()
  }, [enter])

  const input = [-SIDE - 1, -SIDE, -2, -1, 0, 1, 2, SIDE, SIDE + 1].map((k) => (i - k) * step) // ascending scrollX
  // At scrollX = (i - k)*step the card sits k steps right of centre (k = d).
  const ds = [-SIDE - 1, -SIDE, -2, -1, 0, 1, 2, SIDE, SIDE + 1]
  const ascIn = input.slice().reverse()
  const pick = (fn) => ds.map(fn).reverse()

  // Where each card should appear (px from centre) vs where the scroll content puts it (d*step).
  const visual = (d) => {
    const a = Math.abs(d)
    const s = Math.sign(d)
    const pos = a === 0 ? 0 : a === 1 ? cardW * 0.6 : a === 2 ? cardW * 0.86 : a === 3 ? cardW * 1.04 : cardW * 1.18
    return s * pos
  }
  const translateX = scrollX.interpolate({ inputRange: ascIn, outputRange: pick((d) => visual(d) - d * step), extrapolate: 'clamp' })
  const rotateY = scrollX.interpolate({
    inputRange: ascIn,
    outputRange: pick((d) => `${d === 0 ? 0 : Math.sign(d) * (Math.abs(d) === 1 ? 42 : 52)}deg`),
    extrapolate: 'clamp',
  })
  const scale = scrollX.interpolate({
    inputRange: ascIn,
    outputRange: pick((d) => [1, 0.8, 0.68, 0.58, 0.5][Math.min(4, Math.abs(d))]),
    extrapolate: 'clamp',
  })
  // Cards beyond SIDE fade out entirely.
  const visible = scrollX.interpolate({
    inputRange: ascIn,
    outputRange: pick((d) => (Math.abs(d) > SIDE ? 0 : 1)),
    extrapolate: 'clamp',
  })
  const opacity = Animated.multiply(enter, visible)
  const dim = scrollX.interpolate({
    inputRange: ascIn,
    outputRange: pick((d) => [0, 0.32, 0.5, 0.64, 1][Math.min(4, Math.abs(d))]),
    extrapolate: 'clamp',
  })

  return (
    <Animated.View
      style={{
        position: 'absolute', left, top, width: cardW, height: cardH + reflH, zIndex,
        opacity,
        transform: [
          { perspective: 900 },
          { translateX },
          { translateY: enter.interpolate({ inputRange: [0, 1], outputRange: [24, 0] }) },
          { rotateY },
          { scale },
        ],
      }}
    >
      <Pressable onPress={onPress} accessibilityRole="imagebutton" accessibilityLabel={`Photo by ${item.owner_username ?? 'someone'}`} style={[styles.card, { width: cardW, height: cardH }, fresh && styles.cardFresh]}>
        <Image source={{ uri: item.media_url }} style={StyleSheet.absoluteFill} resizeMode="cover" />
        <LinearGradient colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.78)']} locations={[0.55, 1]} style={StyleSheet.absoluteFill} pointerEvents="none" />
        <Pressable onPress={centered ? onOwner : onPress} style={styles.cardOwner} hitSlop={4} accessibilityRole="button" accessibilityLabel={`Open ${item.owner_username ?? 'their'} profile`}>
          {item.owner_avatar_url ? (
            <Image source={avatarSource(item?.owner_avatar_url)} style={styles.avatar} />
          ) : (
            <View style={[styles.avatar, styles.avatarFallback]}><Ionicons name="person" size={13} color="#fff" /></View>
          )}
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.ownerName} numberOfLines={1}>{item.is_mine ? 'You' : item.owner_username ?? 'Someone'}</Text>
            <Text style={styles.ownerSub} numberOfLines={1}>{timeAgo(item.created_at, now) || 'recent'}</Text>
          </View>
        </Pressable>
        {fresh ? (
          <View style={styles.newBadge} pointerEvents="none">
            <LiveDot size={5} color="#fff" />
            <Text style={styles.newBadgeText}>NEW</Text>
          </View>
        ) : null}
        <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.dim, { opacity: dim }]} />
      </Pressable>

      {/* Reflection: the same photo flipped, fading into the floor. */}
      <View style={[styles.reflection, { width: cardW, height: reflH }]} pointerEvents="none">
        <Image
          source={{ uri: item.media_url }}
          style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: cardH, transform: [{ scaleY: -1 }] }}
          resizeMode="cover"
        />
        <LinearGradient colors={['rgba(5,6,10,0.55)', STAGE_BG]} locations={[0, 0.85]} style={StyleSheet.absoluteFill} />
        <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: STAGE_BG, opacity: dim }]} />
      </View>
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: 'transparent' },
  stage: { flex: 1, backgroundColor: STAGE_BG, overflow: 'hidden' },
  stageGlow: { position: 'absolute', top: 0, left: 0, right: 0, height: 220 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 40, paddingBottom: 80 },
  centerCaption: { fontSize: 13, color: 'rgba(255,255,255,0.6)', marginTop: 8, textAlign: 'center' },
  emptyTitle: { fontSize: 17, ...font.semibold, color: '#fff', marginTop: 18 },
  emptyOrb: {
    width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(255,59,79,0.12)', borderWidth: 1, borderColor: 'rgba(255,59,79,0.35)',
  },

  liveToggle: { flexDirection: 'row', alignItems: 'center', gap: 7, height: 36, paddingHorizontal: 13 },
  liveToggleOn: { borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,59,79,0.6)' },
  liveToggleText: { fontSize: 13, ...font.heavy, letterSpacing: 0.8, color: colors.text },

  card: {
    borderRadius: 18, overflow: 'hidden', backgroundColor: '#141720',
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.18)',
  },
  cardFresh: { borderWidth: 2, borderColor: '#ff3b4f' },
  dim: { backgroundColor: '#000' },
  cardOwner: { position: 'absolute', left: 10, right: 10, bottom: 10, flexDirection: 'row', alignItems: 'center', gap: 8 },
  avatar: { width: 30, height: 30, borderRadius: 15, borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.9)' },
  avatarFallback: { backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' },
  ownerName: { color: '#fff', fontSize: 14, ...font.bold },
  ownerSub: { color: 'rgba(255,255,255,0.75)', fontSize: 11, ...font.medium },
  newBadge: {
    position: 'absolute', top: 10, left: 10, flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: '#ff3b4f', borderRadius: 8, paddingHorizontal: 7, paddingVertical: 3,
  },
  newBadgeText: { color: '#fff', fontSize: 10, ...font.heavy, letterSpacing: 0.8 },
  reflection: { marginTop: 6, borderRadius: 18, overflow: 'hidden', opacity: 0.5 },

  footer: { position: 'absolute', left: 16, right: 16, bottom: 26, alignItems: 'center', gap: 8 },
  footerText: { color: 'rgba(255,255,255,0.85)', fontSize: 14, ...font.semibold },
  counter: { color: 'rgba(255,255,255,0.45)', fontSize: 12, ...font.semibold, letterSpacing: 0.5 },
  pill: {
    flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#fff', borderRadius: radii.pill,
    paddingHorizontal: 16, height: 38,
    shadowColor: '#000', shadowOpacity: 0.35, shadowRadius: 12, shadowOffset: { width: 0, height: 5 }, elevation: 8,
  },
  pillText: { color: '#0c0f1a', fontSize: 14, ...font.heavy, letterSpacing: 0.6 },
})
