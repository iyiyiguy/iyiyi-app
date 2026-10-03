import { cityLabel, loadShowPhotoLocation } from '../lib/photoLocation'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  View, Text, Image, Pressable, ActivityIndicator, Alert, StyleSheet, useWindowDimensions, Animated,
  PanResponder, Easing,
} from 'react-native'
import { CameraView, useCameraPermissions, useMicrophonePermissions } from 'expo-camera'
import { Ionicons } from '@expo/vector-icons'
import * as Haptics from 'expo-haptics'
import { GlassCard } from '../components/GlassCard'
import { GlassButton } from '../components/GlassButton'
import { GlassBackground } from '../components/GlassBackground'
import * as Location from 'expo-location'
// SDK 57's root "expo-media-library" export is the new class-based API; the function-style
// calls used here (createAssetAsync, getAlbumAsync, ...) only work from the legacy entry.
import * as MediaLibrary from 'expo-media-library/legacy'
import * as ImagePicker from 'expo-image-picker'
import { captureRef } from 'react-native-view-shot'
import { useIsFocused } from '@react-navigation/native'
import PeopleSheet from '../components/PeopleSheet'
import CaptureCard, { CARD_W } from '../components/camera/CaptureCard'
import Shutter from '../components/camera/Shutter'
import ModeSwitcher from '../components/camera/ModeSwitcher'
import CameraOptionsBar from '../components/camera/CameraOptionsBar'
import FirstUseTip from '../components/camera/FirstUseTip'
import CameraHelpSheet, { HelpButton } from '../components/camera/CameraHelpSheet'
import FilterPicker from '../components/camera/filters/FilterPicker'
import LiveFilterLayer, { visionAvailable } from '../components/camera/filters/LiveFilterLayer'
import BakeFilterLayer from '../components/camera/filters/BakeFilterLayer'
import { detectBodies, detectFaces, isFaceDetectAvailable } from '../../modules/body-hit'
import {
  fallbackHead, headsFromBodies, headsFromFaces, nameTagText, normalizeFilter, selectTargets,
} from '../lib/cameraFilters'
import { openProfile } from '../lib/profileNav'
import { colors, radii, type } from '../theme'
import { apiJson } from '../lib/api'
import { createCameraPost, fetchCameraNearby } from '../lib/cameraApi'
import { supabase } from '../lib/supabase'
import { loadTrimHandsFreePref } from '../lib/handsFreePref'
import {
  DEFAULT_CAMERA_OPTIONS, DEFAULT_BURST_SHOTS, FIRST_USE_TIPS, claimFirstUseTip, cutoffSeconds, loadCameraOptions, saveCameraOptions,
  timerSeconds,
} from '../lib/cameraPrefs'

const ALBUM = 'iYiYi'
const NEARBY_POLL_MS = 8000
const REDO_COUNTDOWN_S = 3
const HANDS_FREE_TRIM_S = 5
const REVIEW_MS = 5000 // how long a capture hovers before it posts
const MODE_SETTLE_MS = 700 // time the native session needs after a photo<->video switch
const MAX_RECORD_S = 600 // hard cap when no cut-off is chosen
const MIN_CLIP_MS = 700 // stopping sooner than this can yield an empty file on iOS
const CARD_SLOT = CARD_W + 8 // CaptureCard's outer width
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const haptic = (style = Haptics.ImpactFeedbackStyle.Light) => Haptics.impactAsync(style).catch(() => {})
const isNotReady = (e) => /not ready/i.test(String(e?.message ?? e ?? ''))

// Saves both full video and trims metadata (keeping full video for now)
// Trimming happens client-side on playback using duration tracking
async function trimVideoTail(inputUri, keepSeconds) {
  return inputUri
}

// File extension + content type from a local uri. iOS records .mov (QuickTime) - uploading
// that as "video/mp4" with an .mp4 name is what broke some players, so keep the real type.
function fileInfo(uri, isPhoto) {
  const ext = String(uri || '').split('?')[0].split('.').pop()?.toLowerCase() ?? ''
  if (isPhoto) {
    if (ext === 'png') return { ext: 'png', contentType: 'image/png' }
    if (ext === 'heic') return { ext: 'heic', contentType: 'image/heic' }
    return { ext: 'jpg', contentType: 'image/jpeg' }
  }
  if (ext === 'mov') return { ext: 'mov', contentType: 'video/quicktime' }
  if (ext === 'm4v') return { ext: 'm4v', contentType: 'video/x-m4v' }
  return { ext: 'mp4', contentType: 'video/mp4' }
}

// Saves to the camera roll with add-only access (no read prompt). The "iYiYi" album step
// needs full library access, so it only runs when the user already granted that. Never
// throws: saving to the phone is a nice-to-have, not a reason to fail a post. Calls are
// queued one after another so a burst can't create the album twice.
let albumChain = Promise.resolve()
async function saveToAlbumNow(uri) {
  try {
    const { status } = await MediaLibrary.requestPermissionsAsync(true)
    if (status !== 'granted') return false
    let full = null
    try {
      full = await MediaLibrary.getPermissionsAsync(false)
    } catch {
      full = null
    }
    if (full?.status === 'granted' && full.accessPrivileges === 'all') {
      const asset = await MediaLibrary.createAssetAsync(uri)
      try {
        const album = await MediaLibrary.getAlbumAsync(ALBUM)
        if (album) await MediaLibrary.addAssetsToAlbumAsync([asset], album, false)
        else await MediaLibrary.createAlbumAsync(ALBUM, asset, false)
      } catch (e) {
        console.warn('Album step failed (asset is still in the camera roll)', e)
      }
    } else {
      await MediaLibrary.saveToLibraryAsync(uri)
    }
    return true
  } catch (e) {
    console.warn('Saving to the photo library failed', e)
    return false
  }
}
function saveToAlbum(uri) {
  const p = albumChain.then(() => saveToAlbumNow(uri))
  albumChain = p.catch(() => false)
  return p
}

async function getUserId() {
  const { data } = await supabase.auth.getSession()
  const userId = data?.session?.user?.id
  if (!userId) throw new Error('You need to be signed in to post.')
  return userId
}

async function uploadFile(uri, isPhoto, userId) {
  const { ext, contentType } = fileInfo(uri, isPhoto)
  const path = `${userId}/cam-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
  const body = await fetch(uri).then((r) => r.arrayBuffer())
  const { error } = await supabase.storage.from('profile-media').upload(path, body, { contentType, upsert: true })
  if (error) throw error
  return supabase.storage.from('profile-media').getPublicUrl(path).data.publicUrl
}

// The whole screen behind the card is transparent (see App.js), so the app underneath
// stays visible, dimmed. Tapping outside the card backs out, same as the ✕ button.
// Module scope on purpose: defining this inside the screen would remount the whole
// subtree (including <CameraView>, killing recordings) on every state change.
function Backdrop({ isInline, cardSize, onDismiss, children }) {
  return (
    <View style={isInline ? styles.backdropInline : styles.backdrop}>
      {!isInline && <Pressable style={StyleSheet.absoluteFill} onPress={onDismiss} />}
      <View style={[isInline ? styles.cardInline : styles.card, cardSize]}>{children}</View>
    </View>
  )
}

// Recording time, ticking on its own so the rest of the screen doesn't re-render 4x a second.
function RecordingTimer({ startedAt, cutoffS }) {
  const [now, setNow] = useState(Date.now())
  const blink = useRef(new Animated.Value(1)).current
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250)
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(blink, { toValue: 0.25, duration: 500, useNativeDriver: true }),
      Animated.timing(blink, { toValue: 1, duration: 500, useNativeDriver: true }),
    ]))
    loop.start()
    return () => { clearInterval(t); loop.stop() }
  }, [blink])
  const s = Math.max(0, Math.floor((now - startedAt) / 1000))
  const fmt = (x) => `${String(Math.floor(x / 60)).padStart(2, '0')}:${String(x % 60).padStart(2, '0')}`
  const pct = cutoffS ? Math.min(1, (now - startedAt) / (cutoffS * 1000)) : 0
  return (
    <View style={styles.recPill}>
      <Animated.View style={[styles.recDot, { opacity: blink }]} />
      <Text style={styles.recText}>{fmt(s)}</Text>
      {cutoffS ? (
        <>
          <View style={styles.recTrack}><View style={[styles.recFill, { width: `${pct * 100}%` }]} /></View>
          <Text style={styles.recLimit}>{fmt(cutoffS)}</Text>
        </>
      ) : null}
    </View>
  )
}

// Big countdown number that pops each second.
function CountdownNumber({ value, hint }) {
  const pop = useRef(new Animated.Value(0)).current
  useEffect(() => {
    pop.setValue(0)
    Animated.timing(pop, { toValue: 1, duration: 900, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start()
  }, [value, pop])
  const scale = pop.interpolate({ inputRange: [0, 0.25, 1], outputRange: [1.6, 1, 0.92] })
  const opacity = pop.interpolate({ inputRange: [0, 0.15, 0.85, 1], outputRange: [0, 1, 1, 0.4] })
  return (
    <View style={styles.overlayCenter} pointerEvents="none">
      <Animated.Text style={[styles.countdownText, { opacity, transform: [{ scale }] }]}>{value}</Animated.Text>
      {hint ? <Text style={styles.overlayHint}>{hint}</Text> : null}
    </View>
  )
}

// Choose Photo or Video with the "VIDEO · PHOTO" switch (or swipe across the preview), then tap
// the shutter: a photo, or start/stop a video. Options (countdown timer, burst, video cut-off)
// sit in the glass pill above. Every capture hovers at the top for 5 seconds with a countdown
// bar - tap its X to cancel - then flies off and posts. Everyone who is within 150 ft, visible
// and has tagging turned on is tagged automatically. Originals are saved to an "iYiYi" album
// on the phone the moment they're captured; posted photos carry the watermark.
export default function CameraScreen({ navigation, route }) {
  const isFocused = useIsFocused()
  const { width: winWidth, height: winHeight } = useWindowDimensions()
  const isInline = route?.params?.inline ?? false
  const cardSize = isInline
    ? { width: winWidth, height: winHeight * 0.5 }
    : { width: winWidth * 0.9, height: winHeight * 0.72 }
  const cameraRef = useRef(null)
  const cameraReadyRef = useRef(false)
  const modeChangedAt = useRef(0)
  const recording = useRef(false)
  const recordStartedAtRef = useRef(0)
  const handsFree = useRef(false)
  const stopRequested = useRef(false)
  const discardNextRecording = useRef(false)
  const recordWatchdog = useRef(null)
  const recIdRef = useRef(0) // identifies the current recording; bumped to orphan a stuck one
  const mountErrors = useRef(0)
  const publishRef = useRef(null)
  const cutoffTimer = useRef(null)
  const mounted = useRef(true)
  const phaseRef = useRef('idle')
  const seqRef = useRef(0) // bumps to cancel a running countdown/burst sequence
  const trimPrefRef = useRef(true)
  const lastCaptureAt = useRef(0)
  // Latest location/nearby results, read at post time so tags reflect who is here *now*.
  const coordsRef = useRef(null)
  const locationLabelRef = useRef(null)
  // Settings > "Show location on my photos" (on by default).
  const showPhotoLocationRef = useRef(true)
  useEffect(() => {
    loadShowPhotoLocation().then((v) => { showPhotoLocationRef.current = v }).catch(() => {})
  }, [isFocused])
  const nearbyRef = useRef([])
  const queueRef = useRef([])
  const captureIdRef = useRef(0)
  const postingCount = useRef(0)
  // Watermark baking: one hidden view, reused for every photo, one job at a time.
  const bakeViewRef = useRef(null)
  const bakeWaiter = useRef(null)
  const bakeChain = useRef(Promise.resolve())
  // AR filters: the live layer publishes waitIdle() here; holdFilter stops new tracking
  // samples from starting while a real photo / burst is being taken.
  const filterCtlRef = useRef(null)
  const holdFilter = useRef(false)
  const facingRef = useRef('back')
  const meRef = useRef(null)
  const cardSizeRef = useRef(null)
  const shutterFlash = useRef(new Animated.Value(0)).current

  const [camPerm, requestCam] = useCameraPermissions()
  const [micPerm, requestMic] = useMicrophonePermissions()
  const [facing, setFacing] = useState('back')
  const [camKey, setCamKey] = useState(0)
  const [options, setOptionsState] = useState(DEFAULT_CAMERA_OPTIONS)
  const optionsRef = useRef(DEFAULT_CAMERA_OPTIONS)
  const mode = options.mode
  const filter = normalizeFilter(options.filter)
  const modeRef = useRef(mode)
  modeRef.current = mode
  const [muted, setMuted] = useState(false)
  const [isRecording, setIsRecording] = useState(false)
  const [recordStartedAt, setRecordStartedAt] = useState(0)
  const [recordCutoffS, setRecordCutoffS] = useState(0) // cut-off of the recording in progress (0 = none)
  const [isHandsFree, setIsHandsFree] = useState(false)
  const [phase, setPhaseState] = useState('idle') // idle | countdown | burst | redoCountdown
  const [countdown, setCountdown] = useState(0)
  const [burstCount, setBurstCount] = useState(0)
  const [burstTotal, setBurstTotal] = useState(0)
  const [nearby, setNearby] = useState([])
  const [me, setMe] = useState(null)
  const [capturedQueue, setCapturedQueue] = useState([]) // [{ id, type: photo|video|burst, uri, shots?, width?, height?, fromLibrary? }]
  const [posting, setPosting] = useState(0)
  const [peopleOpen, setPeopleOpen] = useState(false)
  const [bakeJob, setBakeJob] = useState(null)
  const [tip, setTip] = useState(null)
  const [helpOpen, setHelpOpen] = useState(false)
  const [barOpen, setBarOpen] = useState(false) // an option's choices are showing in the bar
  const [notice, setNotice] = useState(null)
  const [bottomH, setBottomH] = useState(0) // height of the bottom controls, to fit the filter strip
  facingRef.current = facing
  meRef.current = me
  cardSizeRef.current = cardSize

  const setPhase = (p) => {
    phaseRef.current = p
    setPhaseState(p)
  }
  const updateQueue = (fn) => {
    const next = fn(queueRef.current)
    queueRef.current = next
    setCapturedQueue(next)
  }
  const flash = (msg) => {
    setNotice(msg)
    setTimeout(() => { if (mounted.current) setNotice((n) => (n === msg ? null : n)) }, 3200)
  }
  const dismiss = () => navigation.goBack()
  // Who's around (and will be tagged): tap the chip to see them, follow, or open a profile.
  // A profile is pushed on top of the camera; posting carries on underneath.
  const openPerson = (id) => {
    setPeopleOpen(false)
    openProfile(navigation, id)
  }

  useEffect(() => {
    mounted.current = true
    apiJson('/api/profiles/me').then((v) => { if (mounted.current) setMe(v) }).catch(() => {})
    loadTrimHandsFreePref().then((v) => { trimPrefRef.current = v }).catch(() => {})
    loadCameraOptions().then((o) => {
      if (!mounted.current) return
      optionsRef.current = o
      modeChangedAt.current = Date.now()
      setOptionsState(o)
    }).catch(() => {})
    return () => {
      mounted.current = false
      seqRef.current += 1
      clearTimeout(recordWatchdog.current)
      clearTimeout(cutoffTimer.current)
      bakeWaiter.current?.(false)
      // Captures still hovering when the camera closes go out anyway - only the X cancels.
      const pending = queueRef.current
      queueRef.current = []
      pending.forEach((item) => { try { publishRef.current?.(item) } catch {} })
      if (recording.current) {
        discardNextRecording.current = true
        try { cameraRef.current?.stopRecording() } catch {}
      }
    }
  }, [])

  const setOptions = (patch) => {
    const next = { ...optionsRef.current, ...patch }
    optionsRef.current = next
    setOptionsState(next)
    saveCameraOptions(next)
  }

  // First time each option is turned on, explain it once.
  const maybeTip = (id) => {
    claimFirstUseTip(id).then((fresh) => {
      if (fresh && mounted.current && FIRST_USE_TIPS[id]) setTip(FIRST_USE_TIPS[id])
    }).catch(() => {})
  }
  // Reopen any tip from the "?" sheet; closing it goes back to the sheet.
  const openHelpTip = (id) => {
    if (!FIRST_USE_TIPS[id]) return
    setHelpOpen(false)
    setTip({ ...FIRST_USE_TIPS[id], fromHelp: true })
  }
  const closeTip = () => {
    const back = !!tip?.fromHelp
    setTip(null)
    if (back && mounted.current) setHelpOpen(true)
  }
  const onOptionsChange = (patch) => {
    if (!patch || typeof patch !== 'object') return
    const prev = optionsRef.current
    if ('filter' in patch) {
      const { filter: f, ...rest } = patch
      changeFilter(f)
      if (!Object.keys(rest).length) return
      patch = rest // eslint-disable-line no-param-reassign
    }
    setOptions(patch)
    if (patch.timer && !prev.timer) maybeTip('timer')
    if (patch.cutoff && !prev.cutoff) maybeTip('cutoff')
    if (patch.burst && !prev.burst) maybeTip('burst')
    if (patch.burstAfterCountdown && !prev.burstAfterCountdown) maybeTip('burstAfterCountdown')
  }

  const refreshNearby = useCallback(async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync()
      if (status !== 'granted') return
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High })
      const c = { lat: loc.coords.latitude, lng: loc.coords.longitude, acc: loc.coords.accuracy ?? null }
      coordsRef.current = c
      const data = await fetchCameraNearby(c.lat, c.lng)
      const users = Array.isArray(data?.users) ? data.users.filter(Boolean) : []
      nearbyRef.current = users
      if (mounted.current) setNearby(users)
      Location.reverseGeocodeAsync({ latitude: c.lat, longitude: c.lng })
        .then(([place]) => {
          if (!place) return
          // City only (never the street), e.g. "Las Vegas, NV" - and only if the person allows it.
          locationLabelRef.current = cityLabel(place)
        })
        .catch(() => {})
    } catch (e) {
      console.warn('Nearby lookup failed', e)
    }
  }, [])

  // Keeps polling while the camera is open, so a queued post tags whoever is around when it goes out.
  useEffect(() => {
    if (!isFocused) return undefined
    refreshNearby()
    const t = setInterval(refreshNearby, NEARBY_POLL_MS)
    return () => clearInterval(t)
  }, [isFocused, refreshNearby])

  // --- camera readiness ------------------------------------------------------------------
  const onCameraReady = () => {
    cameraReadyRef.current = true
    mountErrors.current = 0
  }
  // A fresh preview mounts whenever the screen regains focus.
  useEffect(() => {
    if (!isFocused) cameraReadyRef.current = false
  }, [isFocused])
  const onMountError = (e) => {
    console.warn('Camera failed to start', e?.message ?? e)
    cameraReadyRef.current = false
    if (mountErrors.current >= 2) {
      flash("Camera couldn't start. Close it and try again.")
      return
    }
    mountErrors.current += 1
    flash("Camera couldn't start - trying again…")
    setTimeout(() => { if (mounted.current) setCamKey((k) => k + 1) }, 600)
  }
  // Resolves once the preview is up (and, for video, the session has had time to add the
  // movie output after a mode switch). Gives up quietly after a few seconds.
  const waitForCamera = async (forVideo = false) => {
    const deadline = Date.now() + 4000
    while (mounted.current && Date.now() < deadline) {
      const settled = !forVideo || Date.now() - modeChangedAt.current >= MODE_SETTLE_MS
      if (cameraRef.current && cameraReadyRef.current && settled) return true
      // eslint-disable-next-line no-await-in-loop
      await wait(50)
    }
    return !!cameraRef.current
  }

  // --- watermark baking ------------------------------------------------------------------
  // Mounts the photo + watermark in a hidden view (behind the camera preview), waits for the
  // image to load, snapshots it, and unmounts it again. Returns null if anything goes wrong
  // (then the original is posted instead).
  // With an AR filter (fx = { filter, facing }), the photo itself is run through Vision to find
  // heads, and the still filter art is drawn over them (top-center if nobody is found).
  const bakeWatermark = (uri, fx = null) => {
    // No name bar on photos any more: only an AR filter needs baking into the image.
    if (!fx || !fx.filter || fx.filter === 'none') return Promise.resolve(null)
    const run = async () => {
      if (!mounted.current) return null
      const view = cardSizeRef.current || cardSize
      let overlay = null
      if (fx && fx.filter && fx.filter !== 'none') {
        try {
          // Faces on the photo itself (box, roll, yaw); body pose on older binaries.
          let heads = []
          if (isFaceDetectAvailable) {
            const faces = await Promise.race([detectFaces(uri, false), wait(3000).then(() => null)])
            heads = headsFromFaces(faces, view, false)
          } else if (visionAvailable) {
            const bodies = await Promise.race([detectBodies(uri, false), wait(3000).then(() => null)])
            heads = headsFromBodies(bodies, view, false)
          }
          // Same matching as the live preview: nearby iYiYi users by compass bearing, else
          // the nearest face. Uses the heading/position captured with the photo.
          const targets = selectTargets({
            heads, facing: fx.facing, nearby: nearbyRef.current, me: meRef.current, myPos: fx.myPos || coordsRef.current, headingDeg: fx.heading,
          })
          overlay = {
            filter: fx.filter,
            heads: targets.length ? targets : [fallbackHead(view, fx.facing)],
            name: nameTagText({ facing: fx.facing, headCount: heads.length, nearby: nearbyRef.current, me: meRef.current }),
          }
        } catch {
          overlay = null
        }
      }
      if (!mounted.current) return null
      const loaded = new Promise((resolve) => {
        let need = overlay ? 2 : 1
        bakeWaiter.current = (ok) => {
          if (!ok) { resolve(false); return }
          need -= 1
          if (need <= 0) resolve(true)
        }
      })
      setBakeJob({ uri, key: `${Date.now()}-${Math.random()}`, overlay })
      const ok = await Promise.race([loaded, wait(3000).then(() => false)])
      bakeWaiter.current = null
      let out = null
      if (ok && mounted.current && bakeViewRef.current) {
        await wait(overlay ? 160 : 80) // let the loaded frame (and filter art) commit before the snapshot
        try {
          out = await captureRef(bakeViewRef.current, { format: 'jpg', quality: 0.92, result: 'tmpfile' })
        } catch (e) {
          console.warn('Watermark capture failed, posting the original', e)
        }
      }
      if (mounted.current) setBakeJob(null)
      return out
    }
    const p = bakeChain.current.then(run, run)
    bakeChain.current = p.catch(() => null)
    return p
  }

  // --- posting -----------------------------------------------------------------------------
  const postOne = async (userId, uri, isPhoto, size) => {
    const mediaUrl = await uploadFile(uri, isPhoto, userId)
    const c = coordsRef.current
    // Straight into profile_media (+ media_tags); emits a mediaPosted event for the feed/profile.
    await createCameraPost({
      media_url: mediaUrl,
      media_type: isPhoto ? 'photo' : 'video',
      watermarked_url: size.watermarked ? mediaUrl : null,
      width: size.width ?? null,
      height: size.height ?? null,
      lat: c?.lat ?? null,
      lng: c?.lng ?? null,
      location_label: showPhotoLocationRef.current ? locationLabelRef.current : null,
      tagged_ids: nearbyRef.current.map((u) => u.id),
    })
  }

  // Uploads a capture once its hover countdown runs out. Tags and location are read fresh.
  const publish = async (item) => {
    if (!item) return
    postingCount.current += 1
    setPosting(postingCount.current)
    let ok = false
    try {
      const userId = await getUserId()
      if (item.type === 'video') {
        await postOne(userId, item.postUri || item.uri, false, item)
      } else if (item.type === 'photo') {
        const wm = await bakeWatermark(item.uri, item.fx)
        if (wm) saveToAlbum(wm) // keep the watermarked copy too (the original was saved at capture)
        await postOne(userId, wm || item.uri, true, { ...item, watermarked: !!wm })
      } else if (item.type === 'burst') {
        let failed = 0
        let lastError = null
        for (const shot of item.shots || []) {
          try {
            // eslint-disable-next-line no-await-in-loop
            const wm = await bakeWatermark(shot.uri, item.fx)
            // eslint-disable-next-line no-await-in-loop
            await postOne(userId, wm || shot.uri, true, { ...shot, watermarked: !!wm })
          } catch (e) {
            failed += 1
            lastError = e
          }
        }
        if (failed && failed === (item.shots || []).length) throw lastError || new Error('The burst could not be posted.')
        if (failed) Alert.alert('Some photos didn’t post', `${failed} of ${item.shots.length} burst photos couldn't be posted.`)
      }
      ok = true
    } catch (e) {
      console.warn('Camera post failed', e?.message ?? e, e?.code ?? '')
      // The original is already in the camera roll (saved at capture).
      const msg = "Couldn't post — saved to your camera roll"
      if (mounted.current) flash(msg)
      else Alert.alert(msg, e?.message ?? 'Please try again.')
    } finally {
      postingCount.current -= 1
      if (mounted.current) setPosting(postingCount.current)
    }
    // Back out once everything queued has gone out, unless the user is mid-shot again.
    if (
      ok && mounted.current && !isInline && postingCount.current === 0 && queueRef.current.length === 0
      && !recording.current && phaseRef.current === 'idle' && Date.now() - lastCaptureAt.current > 4000
      && navigation.isFocused()
    ) {
      navigation.goBack()
    }
  }

  publishRef.current = publish

  const onCardExpire = (captureId) => {
    if (!mounted.current) return
    const item = queueRef.current.find((q) => q.id === captureId)
    if (!item) return
    updateQueue((q) => q.filter((x) => x.id !== captureId))
    publish(item)
  }
  const onCardCancel = (captureId) => {
    if (!mounted.current) return
    updateQueue((q) => q.filter((x) => x.id !== captureId))
  }

  // Every capture lands here: originals go to the phone right away, then a hover card.
  const afterCapture = (item) => {
    refreshNearby() // freshen tags; publish reads the latest result when it goes out
    lastCaptureAt.current = Date.now()
    if (!item.fromLibrary) {
      if (item.type === 'burst') item.shots.forEach((s) => saveToAlbum(s.uri))
      else saveToAlbum(item.uri)
    }
    if (!mounted.current) {
      publish(item) // screen closed mid-capture: still post it
      return
    }
    const id = captureIdRef.current++
    updateQueue((q) => [...q, { ...item, id }])
  }

  // --- AR filter helpers ------------------------------------------------------------------
  // Filter to bake into a photo taken right now (stills only - see the video note below),
  // with the compass heading and position at the moment of capture for name matching.
  const captureFx = () => {
    const f = normalizeFilter(optionsRef.current?.filter)
    if (f === 'none') return null
    let heading = null
    try { heading = filterCtlRef.current?.getHeading?.() ?? null } catch {}
    const pos = coordsRef.current
    return { filter: f, facing: facingRef.current, heading, myPos: pos ? { ...pos } : null }
  }
  // Stops head tracking from starting a new sample and waits (briefly) for one in flight, so
  // the real capture never queues behind it.
  const holdTracking = async () => {
    holdFilter.current = true
    try {
      const idle = filterCtlRef.current?.waitIdle?.()
      if (idle && typeof idle.then === 'function') await Promise.race([idle.catch(() => {}), wait(800)])
    } catch {}
  }
  const flashShutter = () => {
    try {
      shutterFlash.setValue(0.85)
      Animated.timing(shutterFlash, { toValue: 0, duration: 260, useNativeDriver: true }).start()
    } catch {}
  }

  // --- photo -------------------------------------------------------------------------------
  const takePhoto = async () => {
    const fx = captureFx()
    try {
      await waitForCamera(false)
      if (fx) await holdTracking()
      haptic(Haptics.ImpactFeedbackStyle.Medium)
      if (fx) flashShutter() // the native shutter blink is off while tracking
      // A quick second tap can land while the previous photo is still being delivered:
      // retry for a moment instead of failing.
      let photo = null
      const deadline = Date.now() + 2000
      for (;;) {
        try {
          // eslint-disable-next-line no-await-in-loop
          photo = await cameraRef.current?.takePictureAsync({ quality: 0.85 })
          break
        } catch (e) {
          if (!isNotReady(e) || Date.now() > deadline || !mounted.current) throw e
          // eslint-disable-next-line no-await-in-loop
          await wait(60)
        }
      }
      if (photo?.uri) {
        afterCapture({ type: 'photo', uri: photo.uri, width: photo.width, height: photo.height, fx })
      } else {
        Alert.alert("Couldn't take the photo", 'No image came back from the camera - please try again.')
      }
    } catch (e) {
      Alert.alert("Couldn't take the photo", e?.message ?? 'Please try again.')
    } finally {
      holdFilter.current = false
    }
  }

  // --- burst -------------------------------------------------------------------------------
  // Fires shots back to back without waiting for each photo to be processed or uploaded.
  // expo-camera allows one capture "in flight" at a time; the next one is accepted as soon
  // as the sensor has delivered the previous frame (well before it's encoded and saved), so
  // a call that bounces with "not ready" is just retried a few ms later.
  const fireBurstShot = async (token) => {
    const deadline = Date.now() + 2500
    while (mounted.current && seqRef.current === token && Date.now() < deadline) {
      const cam = cameraRef.current
      if (!cam) return null
      let p
      try {
        p = cam.takePictureAsync({ quality: 0.5, skipProcessing: true, exif: false })
      } catch {
        return null
      }
      if (!p || typeof p.then !== 'function') return null
      const state = { v: 'pending', e: null }
      p.then(() => { state.v = 'ok' }, (e) => { state.v = 'err'; state.e = e })
      // eslint-disable-next-line no-await-in-loop
      await wait(60)
      if (state.v !== 'err') return p // accepted (in flight or already done)
      if (!isNotReady(state.e)) return null // a real failure - skip this shot
      // eslint-disable-next-line no-await-in-loop
      await wait(20)
    }
    return null
  }

  const runBurst = async (shots, token) => {
    const fx = captureFx()
    setPhase('burst')
    setBurstTotal(shots)
    setBurstCount(0)
    await waitForCamera(false)
    if (fx) await holdTracking()
    try {
      await runBurstShots(shots, token, fx)
    } finally {
      holdFilter.current = false
    }
  }
  const runBurstShots = async (shots, token, fx) => {
    if (!mounted.current || seqRef.current !== token) return
    const inFlight = []
    for (let i = 0; i < shots; i++) {
      if (!mounted.current || seqRef.current !== token) break
      // eslint-disable-next-line no-await-in-loop
      const p = await fireBurstShot(token)
      if (p) {
        inFlight.push(p.catch(() => null))
        Haptics.selectionAsync().catch(() => {})
        if (mounted.current) setBurstCount(inFlight.length)
      }
    }
    const results = (await Promise.all(inFlight)).filter((r) => r?.uri)
    if (!results.length) {
      if (mounted.current && seqRef.current === token) Alert.alert('Burst failed', 'The camera didn’t return any photos - please try again.')
      return
    }
    if (results.length === 1) {
      afterCapture({ type: 'photo', uri: results[0].uri, width: results[0].width, height: results[0].height, fx })
    } else {
      const shotsOut = results.map((r) => ({ uri: r.uri, width: r.width, height: r.height }))
      afterCapture({ type: 'burst', uri: shotsOut[0].uri, shots: shotsOut, fx })
    }
  }

  // --- video -------------------------------------------------------------------------------
  // Asks for the microphone; if it's refused, records without sound instead of failing.
  const ensureMic = async () => {
    try {
      if (micPerm?.granted) {
        if (muted) setMuted(false)
        return true
      }
      if (micPerm && micPerm.canAskAgain === false) {
        if (!muted) { setMuted(true); modeChangedAt.current = Date.now() }
        return false
      }
      const r = await requestMic()
      if (r?.granted) {
        if (muted) { setMuted(false); modeChangedAt.current = Date.now() }
        return true
      }
      if (!muted) { setMuted(true); modeChangedAt.current = Date.now() }
      flash('No microphone access - videos will record without sound.')
      return false
    } catch {
      return false
    }
  }

  const resetRecordingState = () => {
    clearTimeout(recordWatchdog.current)
    clearTimeout(cutoffTimer.current)
    recordWatchdog.current = null
    cutoffTimer.current = null
    recording.current = false
    handsFree.current = false
    stopRequested.current = false
    holdFilter.current = false
    if (mounted.current) {
      setIsRecording(false)
      setIsHandsFree(false)
    }
  }

  // startLocked = started by the countdown (hands-free / tripod). Either way a tap on the
  // shutter stops it, and the cut-off (if chosen) stops it automatically.
  const startVideo = async (startLocked = false) => {
    if (recording.current || !mounted.current) return
    if (modeRef.current !== 'video') return
    await ensureMic()
    const ready = await waitForCamera(true)
    if (!mounted.current || recording.current || !ready) {
      if (mounted.current && !ready) Alert.alert("Couldn't start recording", 'The camera isn’t ready yet - please try again.')
      return
    }
    // The chosen cut-off (preset or custom), fixed for this recording.
    const cutoffS = cutoffSeconds(optionsRef.current)
    setRecordCutoffS(cutoffS)
    const recId = ++recIdRef.current
    recording.current = true
    stopRequested.current = false
    discardNextRecording.current = false
    handsFree.current = startLocked
    const startedAt = Date.now()
    recordStartedAtRef.current = startedAt
    setRecordStartedAt(startedAt)
    setIsRecording(true)
    setIsHandsFree(startLocked)
    haptic(Haptics.ImpactFeedbackStyle.Medium)
    // Belt and braces for the cut-off: the native maxDuration should end it, this makes sure.
    if (cutoffS) {
      cutoffTimer.current = setTimeout(() => {
        if (recording.current) stopVideo()
      }, cutoffS * 1000 + 1200)
    }

    const record = () => cameraRef.current?.recordAsync({ maxDuration: cutoffS || MAX_RECORD_S })
    // Live filter tracking grabs stills from the same session: let any in-flight one finish
    // and hold new ones until the recording has started.
    if (normalizeFilter(optionsRef.current?.filter) !== 'none') {
      await holdTracking()
      setTimeout(() => { holdFilter.current = false }, 1200)
    }
    let video = null
    let error = null
    try {
      video = await record()
    } catch (e) {
      error = e
      // The movie output can lag a mode/camera switch by a moment: retry once.
      if (isNotReady(e) && mounted.current && !stopRequested.current) {
        await wait(MODE_SETTLE_MS)
        try {
          if (mounted.current && !stopRequested.current) {
            recordStartedAtRef.current = Date.now()
            setRecordStartedAt(recordStartedAtRef.current)
            video = await record()
            error = null
          }
        } catch (e2) {
          error = e2
        }
      }
    }
    // Orphaned by the watchdog (the camera was restarted): another recording may be running now.
    if (recIdRef.current !== recId) return
    const elapsedS = (Date.now() - recordStartedAtRef.current) / 1000
    const discard = discardNextRecording.current
    discardNextRecording.current = false
    resetRecordingState()
    if (discard) return
    if (error || !video?.uri) {
      console.warn('Recording failed', error)
      if (mounted.current) {
        Alert.alert(
          "Video didn't save",
          error?.message
            ? `The camera reported: ${error.message}`
            : 'Nothing was recorded - hold on a moment after starting before you stop.',
        )
      }
      return
    }
    let postUri = video.uri
    if (startLocked && trimPrefRef.current && elapsedS - HANDS_FREE_TRIM_S >= 2) {
      try {
        postUri = await trimVideoTail(video.uri, elapsedS - HANDS_FREE_TRIM_S)
      } catch (e) {
        console.warn('Trim failed, posting the full clip instead', e)
      }
    }
    afterCapture({ type: 'video', uri: video.uri, postUri })
  }

  const stopVideo = () => {
    if (!recording.current || stopRequested.current) return
    stopRequested.current = true
    const doStop = () => {
      holdFilter.current = true // released by resetRecordingState once the file is delivered
      try { cameraRef.current?.stopRecording() } catch (e) { console.warn('stopRecording failed', e) }
      haptic(Haptics.ImpactFeedbackStyle.Medium)
      // If the native side never answers (it can drop a promise if a stop races a start),
      // don't leave the screen stuck "recording": reset and restart the camera.
      clearTimeout(recordWatchdog.current)
      recordWatchdog.current = setTimeout(() => {
        if (!recording.current || !mounted.current) return
        console.warn('Recording did not finish - resetting the camera')
        recIdRef.current += 1
        discardNextRecording.current = false
        resetRecordingState()
        cameraReadyRef.current = false
        setCamKey((k) => k + 1)
        Alert.alert("Video didn't save", 'The camera stopped responding. Please try recording again.')
      }, 6000)
    }
    const sinceStart = Date.now() - recordStartedAtRef.current
    if (sinceStart < MIN_CLIP_MS) setTimeout(doStop, MIN_CLIP_MS - sinceStart)
    else doStop()
  }

  // --- countdown / sequences ------------------------------------------------------------------
  const runCountdown = async (seconds, token, p = 'countdown') => {
    setPhase(p)
    for (let n = seconds; n >= 1; n--) {
      if (!mounted.current || seqRef.current !== token) return false
      setCountdown(n)
      if (n <= 3) haptic(Haptics.ImpactFeedbackStyle.Light)
      // eslint-disable-next-line no-await-in-loop
      await wait(1000)
    }
    return mounted.current && seqRef.current === token
  }

  const cancelSequence = () => {
    seqRef.current += 1
    setPhase('idle')
    haptic()
  }

  const onShutter = async () => {
    const p = phaseRef.current
    if (p === 'countdown' || p === 'redoCountdown') { cancelSequence(); return }
    if (p === 'burst') return
    if (recording.current) { stopVideo(); return }

    const o = optionsRef.current
    const timerS = timerSeconds(o) // preset or custom countdown length
    const token = ++seqRef.current
    const afterCountdownShots = o.burstAfterCountdown ? (o.burst || o.burstShots || DEFAULT_BURST_SHOTS) : 0
    try {
      if (modeRef.current === 'picture') {
        if (timerS) {
          if (!(await runCountdown(timerS, token))) return
          if (afterCountdownShots) await runBurst(afterCountdownShots, token)
          else if (o.burst) await runBurst(o.burst, token)
          else { setPhase('idle'); await takePhoto() }
        } else if (o.burst) {
          await runBurst(o.burst, token)
        } else {
          setPhase('idle')
          await takePhoto()
        }
      } else if (timerS) {
        // Hands-free video: countdown, optional burst of stills, then a locked recording.
        if (!(await runCountdown(timerS, token))) return
        if (afterCountdownShots) await runBurst(afterCountdownShots, token)
        if (!mounted.current || seqRef.current !== token) return
        setPhase('idle')
        await startVideo(true)
      } else {
        await startVideo(false)
      }
    } finally {
      if (mounted.current && seqRef.current === token && phaseRef.current !== 'idle') setPhase('idle')
    }
  }

  // Throws away what's recorded so far, counts "3, 2, 1" back down, then starts the same kind
  // of recording again from scratch.
  const redoRecording = async () => {
    if (!recording.current || phaseRef.current !== 'idle') return
    const wasHandsFree = handsFree.current
    discardNextRecording.current = true
    stopRequested.current = false
    try { cameraRef.current?.stopRecording() } catch {}
    const token = ++seqRef.current
    // Wait for the discarded recording to wind down before starting again.
    const deadline = Date.now() + 4000
    while (recording.current && Date.now() < deadline && mounted.current) {
      // eslint-disable-next-line no-await-in-loop
      await wait(50)
    }
    if (recording.current) resetRecordingState()
    if (!(await runCountdown(REDO_COUNTDOWN_S, token, 'redoCountdown'))) return
    setPhase('idle')
    startVideo(wasHandsFree)
  }

  // --- mode / facing ---------------------------------------------------------------------------
  const busy = phase !== 'idle' || isRecording
  const changeMode = (m) => {
    if (m === modeRef.current || recording.current || phaseRef.current !== 'idle') return
    Haptics.selectionAsync().catch(() => {})
    modeChangedAt.current = Date.now()
    setOptions({ mode: m })
    if (m === 'video') ensureMic()
  }
  const changeFilter = (f) => {
    const next = normalizeFilter(f)
    const prev = normalizeFilter(optionsRef.current?.filter)
    if (next === prev) return
    setOptions({ filter: next })
    if (next !== 'none' && prev === 'none') maybeTip('filters')
  }
  const flipCamera = () => {
    if (recording.current || phaseRef.current !== 'idle') return
    Haptics.selectionAsync().catch(() => {})
    cameraReadyRef.current = false
    modeChangedAt.current = Date.now()
    setFacing((f) => (f === 'back' ? 'front' : 'back'))
  }
  const flipSpin = useRef(new Animated.Value(0)).current
  useEffect(() => {
    Animated.timing(flipSpin, { toValue: facing === 'front' ? 1 : 0, duration: 300, useNativeDriver: true }).start()
  }, [facing, flipSpin])

  // Swipe across the preview to switch Photo/Video, like the iPhone Camera app.
  const changeModeRef = useRef(changeMode)
  changeModeRef.current = changeMode
  const swipe = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 24 && Math.abs(g.dx) > Math.abs(g.dy) * 1.6,
    onPanResponderRelease: (_, g) => {
      if (Math.abs(g.dx) < 40) return
      changeModeRef.current(g.dx > 0 ? 'video' : 'picture')
    },
  }), [])

  // Second way in: pick something already on the phone instead of shooting it live. It
  // still gets tagged with whoever is nearby right now, same as a fresh shot.
  const pickFromLibrary = async () => {
    if (busy) return
    try {
      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images', 'videos'], quality: 0.9 })
      if (result.canceled || !result.assets?.length) return
      const asset = result.assets[0]
      afterCapture({
        type: asset.type === 'video' ? 'video' : 'photo', uri: asset.uri, width: asset.width, height: asset.height, fromLibrary: true,
      })
    } catch (e) {
      Alert.alert("Couldn't open your library", e?.message ?? 'Please try again.')
    }
  }

  const peopleSheet = (
    <PeopleSheet
      visible={peopleOpen}
      onClose={() => setPeopleOpen(false)}
      title={nearby.length ? `${nearby.length} nearby` : 'Nobody nearby yet'}
      subtitle="Everyone within 150 ft who has tagging on is tagged in what you post."
      people={nearby}
      onOpenProfile={openPerson}
      emptyText="When people with tagging on are within 150 ft, they’ll show up here."
    />
  )

  if (!camPerm) return <Backdrop isInline={isInline} cardSize={cardSize} onDismiss={dismiss} />
  if (!camPerm.granted) {
    return (
      <GlassBackground isDark={true}>
        <View style={[StyleSheet.absoluteFill, styles.center]}>
          <GlassCard intensity={90} tint="dark" radius={28} padding={28} style={{ width: '85%' }}>
            <Text style={[type.title, { textAlign: 'center', color: '#fff', marginBottom: 12 }]}>Camera access</Text>
            <Text style={[type.caption, styles.permText, { color: 'rgba(255,255,255,0.8)' }]}>
              The iYiYi camera tags the people around you in what you shoot. Allow the camera to get started.
            </Text>
            <GlassButton onPress={requestCam} size="lg" tint="dark" style={{ marginTop: 20 }}>
              Allow camera
            </GlassButton>
            <Pressable onPress={dismiss} style={{ padding: 14, marginTop: 8 }}>
              <Text style={[type.caption, { color: 'rgba(255,255,255,0.6)', textAlign: 'center' }]}>Not now</Text>
            </Pressable>
          </GlassCard>
        </View>
      </GlassBackground>
    )
  }

  const hint = phase === 'redoCountdown'
    ? null
    : phase === 'countdown'
      ? null
      : isRecording
        ? (isHandsFree ? 'Hands-free · tap to stop' : 'Tap to stop')
        : null
  // Side by side while they fit; past that they overlap like a fanned stack.
  const cardStep = capturedQueue.length > 1
    ? Math.min(CARD_SLOT + 6, (cardSize.width - 28 - CARD_SLOT) / (capturedQueue.length - 1))
    : CARD_SLOT
  const flipRotate = flipSpin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '180deg'] })
  // Live AR filter: shown in photo and video mode (and while recording). Photos get it baked
  // in; recorded video files don't (no video compositor in this build).
  const filterLive = filter !== 'none' && isFocused
  const tracking = filterLive && visionAvailable

  // --- live camera (captures hover on top of it) -------------------------------------------
  return (
    <Backdrop isInline={isInline} cardSize={cardSize} onDismiss={dismiss}>
      {/* Watermark bake (photos only): fully opaque but covered by the preview / black layer
          above it - an opacity:0 view snapshots blank on iOS, a covered one doesn't. */}
      {bakeJob && (
        <View
          key={bakeJob.key}
          ref={bakeViewRef}
          collapsable={false}
          style={[styles.preview, styles.hiddenBake, cardSize]}
          pointerEvents="none"
        >
          <Image
            source={{ uri: bakeJob.uri }}
            style={StyleSheet.absoluteFill}
            resizeMode="cover"
            onLoad={() => bakeWaiter.current?.(true)}
            onError={() => bakeWaiter.current?.(false)}
          />
          {bakeJob.overlay ? (
            <BakeFilterLayer
              filter={bakeJob.overlay.filter}
              heads={bakeJob.overlay.heads}
              name={bakeJob.overlay.name}
              onReady={() => bakeWaiter.current?.(true)}
            />
          ) : null}
        </View>
      )}
      <View style={[StyleSheet.absoluteFill, styles.bakeCover]} pointerEvents="none" />

      {isFocused && (
        <CameraView
          key={`${facing}-${camKey}`}
          ref={cameraRef}
          style={StyleSheet.absoluteFill}
          facing={facing}
          mode={mode}
          mute={muted}
          videoQuality="720p"
          animateShutter={phase !== 'burst' && !tracking}
          onCameraReady={onCameraReady}
          onMountError={onMountError}
        />
      )}

      {filterLive && (
        <LiveFilterLayer
          key={filter}
          filter={filter}
          cameraRef={cameraRef}
          cameraReadyRef={cameraReadyRef}
          facing={facing}
          paused={phase === 'burst' || isRecording /* never grab stills mid-recording: protects the saved video */}
          recording={isRecording}
          coordsRef={coordsRef}
          holdRef={holdFilter}
          controlRef={filterCtlRef}
          view={cardSize}
          nearby={nearby}
          me={me}
        />
      )}
      <Animated.View style={[StyleSheet.absoluteFill, styles.flash, { opacity: shutterFlash }]} pointerEvents="none" />

      {/* Swipe surface for Photo/Video (sits under every control). */}
      <View style={StyleSheet.absoluteFill} {...swipe.panHandlers} />

      {bottomH > 0 && (
        <FilterPicker
          value={filter}
          onChange={changeFilter}
          disabled={busy}
          top={66}
          bottom={16 + bottomH + 6}
          note={mode === 'video' && filter !== 'none' ? 'Live only · not saved in video' : null}
        />
      )}

      {(phase === 'countdown' || phase === 'redoCountdown') && (
        <CountdownNumber
          value={countdown}
          hint={phase === 'redoCountdown' ? 'Restarting…' : 'Tap the shutter to cancel'}
        />
      )}
      {phase === 'burst' && (
        <View style={styles.overlayCenter} pointerEvents="none">
          <Text style={styles.burstNumber}>{burstCount}</Text>
          <Text style={styles.overlayHint}>BURST · {burstTotal}</Text>
        </View>
      )}

      <View style={styles.top}>
        <Pressable onPress={dismiss} hitSlop={12} style={[styles.round, styles.roundGlass]} accessibilityLabel="Close camera">
          <Ionicons name="close" size={22} color="#fff" />
        </Pressable>
        {isRecording ? (
          <View style={{ flex: 1, alignItems: 'center', marginHorizontal: 12 }}>
            <RecordingTimer startedAt={recordStartedAt} cutoffS={recordCutoffS} />
          </View>
        ) : (
          <Pressable onPress={() => setPeopleOpen(true)} style={{ flex: 1, marginHorizontal: 12 }} accessibilityRole="button" accessibilityLabel="See who is nearby">
            <GlassCard intensity={80} tint="dark" radius={20} padding={12}>
              <Text style={[styles.badgeText, { textAlign: 'center' }]}>
                {nearby.length ? `${nearby.length} nearby will be tagged ›` : 'Nobody nearby yet'}
              </Text>
            </GlassCard>
          </Pressable>
        )}
        <View style={[styles.round, posting ? styles.roundGlass : null]} accessibilityLabel={posting ? 'Posting' : undefined}>
          {posting ? <ActivityIndicator color="#fff" size="small" /> : null}
        </View>
      </View>

      {/* Captures hovering before they post */}
      {capturedQueue.length > 0 && (
        <View style={styles.reviewStack} pointerEvents="box-none">
          {capturedQueue.map((capture, idx) => (
            <View
              key={capture.id}
              style={idx === 0 ? null : { marginLeft: cardStep - CARD_SLOT }}
              pointerEvents="box-none"
            >
              <CaptureCard
                item={capture}
                durationMs={REVIEW_MS}
                onExpire={onCardExpire}
                onCancel={onCardCancel}
              />
            </View>
          ))}
        </View>
      )}

      {notice && (
        <View style={styles.noticeWrap} pointerEvents="none">
          <GlassCard tint="dark" radius={16} padding={10}>
            <Text style={styles.noticeText}>{notice}</Text>
          </GlassCard>
        </View>
      )}

      <View
        style={styles.bottom}
        pointerEvents="box-none"
        onLayout={(e) => {
          const h = e?.nativeEvent?.layout?.height
          if (Number.isFinite(h) && Math.abs(h - bottomH) > 1) setBottomH(h)
        }}
      >
        {hint ? <Text style={styles.hint}>{hint}</Text> : null}
        <View style={styles.optionsRow} pointerEvents="box-none">
          {/* Same width as the "?" on the right, so the bar stays centred. */}
          {!barOpen && <View style={styles.helpSpacer} />}
          <CameraOptionsBar mode={mode} options={options} onChange={onOptionsChange} disabled={busy} onOpenChange={setBarOpen} />
          {!barOpen && <HelpButton onPress={() => { setTip(null); setHelpOpen(true) }} disabled={busy} />}
        </View>
        <ModeSwitcher mode={mode} onChange={changeMode} disabled={busy} />
        <View style={styles.shutterRow}>
          <Pressable
            onPress={pickFromLibrary}
            hitSlop={10}
            style={[styles.sideButton, busy && { opacity: 0.4 }]}
            disabled={busy}
            accessibilityLabel="Choose from library"
          >
            <Ionicons name="images-outline" size={21} color="#fff" />
          </Pressable>
          <Shutter mode={mode} recording={isRecording} busy={phase === 'burst'} onPress={onShutter} />
          {isRecording ? (
            <Pressable onPress={redoRecording} hitSlop={10} style={[styles.sideButton, styles.sideButtonArmed]} accessibilityLabel="Restart recording">
              <Ionicons name="refresh" size={21} color="#fff" />
            </Pressable>
          ) : (
            <Pressable
              onPress={flipCamera}
              hitSlop={10}
              style={[styles.sideButton, phase !== 'idle' && { opacity: 0.4 }]}
              disabled={phase !== 'idle'}
              accessibilityLabel={facing === 'back' ? 'Switch to front camera' : 'Switch to back camera'}
            >
              <Animated.View style={{ transform: [{ rotateY: flipRotate }] }}>
                <Ionicons name="camera-reverse-outline" size={23} color="#fff" />
              </Animated.View>
            </Pressable>
          )}
        </View>
      </View>

      <CameraHelpSheet visible={helpOpen && !tip} onClose={() => setHelpOpen(false)} onOpenTip={openHelpTip} />
      <FirstUseTip tip={tip} onClose={closeTip} />
      {peopleSheet}
    </Backdrop>
  )
}

const styles = StyleSheet.create({
  // A dimmed scrim over the app, with the camera card floating in the middle so the
  // screen behind it stays visible - this pops open in place instead of taking over.
  backdrop: { flex: 1, backgroundColor: 'rgba(5,2,8,0.72)', alignItems: 'center', justifyContent: 'center' },
  card: { borderRadius: 32, overflow: 'hidden', backgroundColor: '#000', borderWidth: 2, borderColor: 'rgba(255,255,255,0.15)' },
  center: { alignItems: 'center', justifyContent: 'center', padding: 30, backgroundColor: colors.ink },
  permText: { textAlign: 'center', marginVertical: 14 },
  top: { position: 'absolute', top: 18, left: 14, right: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  round: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
  roundGlass: { backgroundColor: 'rgba(30,30,50,0.35)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)' },
  // Never seen - rendered fully opaque but covered by bakeCover/the preview, just a mount point
  // so captureRef can bake the watermark onto a photo before upload.
  hiddenBake: { position: 'absolute', top: 0, left: 0 },
  bakeCover: { backgroundColor: '#000' },
  flash: { backgroundColor: '#fff' },
  badgeText: { color: 'rgba(255,255,255,0.9)', fontWeight: '600', fontSize: 12 },
  reviewStack: { position: 'absolute', top: 66, left: 14, right: 14, flexDirection: 'row', alignItems: 'flex-start' },
  recPill: {
    flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 12, paddingVertical: 7,
    borderRadius: radii.pill, backgroundColor: 'rgba(255,59,48,0.92)',
  },
  recDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#fff' },
  recText: { color: '#fff', fontWeight: '700', fontSize: 15, fontVariant: ['tabular-nums'] },
  recTrack: { width: 44, height: 3, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.35)', overflow: 'hidden' },
  recFill: { height: '100%', backgroundColor: '#fff' },
  recLimit: { color: 'rgba(255,255,255,0.85)', fontWeight: '600', fontSize: 12, fontVariant: ['tabular-nums'] },
  noticeWrap: { position: 'absolute', left: 24, right: 24, top: '42%', alignItems: 'center' },
  noticeText: { color: '#fff', fontSize: 13, fontWeight: '600', textAlign: 'center' },
  bottom: { position: 'absolute', bottom: 16, left: 12, right: 12, alignItems: 'center', gap: 10 },
  hint: { color: 'rgba(255,255,255,0.9)', fontWeight: '600', fontSize: 12, textShadowColor: 'rgba(0,0,0,0.5)', textShadowRadius: 3 },
  optionsRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, maxWidth: '100%' },
  helpSpacer: { width: 24 },
  shutterRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 34 },
  sideButton: {
    width: 46, height: 46, borderRadius: 23, backgroundColor: 'rgba(30,30,50,0.35)',
    alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)',
  },
  sideButtonArmed: { backgroundColor: 'rgba(255, 57, 48, 0.6)', borderColor: 'rgba(255, 100, 80, 0.5)' },
  overlayCenter: {
    ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'transparent', gap: 8,
  },
  countdownText: { fontSize: 96, fontWeight: '800', color: '#fff', textShadowColor: 'rgba(0,0,0,0.55)', textShadowRadius: 14 },
  burstNumber: { fontSize: 64, fontWeight: '800', color: '#fff', fontVariant: ['tabular-nums'], textShadowColor: 'rgba(0,0,0,0.55)', textShadowRadius: 12 },
  overlayHint: { color: 'rgba(255,255,255,0.92)', fontWeight: '700', fontSize: 13, letterSpacing: 0.6, textShadowColor: 'rgba(0,0,0,0.5)', textShadowRadius: 4 },
  preview: { flex: 1, backgroundColor: '#000', overflow: 'hidden' },
  backdropInline: { flex: 1, backgroundColor: 'transparent', alignItems: 'center', justifyContent: 'flex-start', paddingTop: 0 },
  cardInline: { borderRadius: 0, backgroundColor: '#000' },
})
