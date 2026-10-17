// Song timeline (GarageBand-style): a bar ruler, one lane per drum instrument (the looping beat
// drawn faintly, pad hits you record drawn bright), a vocal lane with its waveform, and a playhead.
// Record = count-in, then the beat plays while the mic records; the vocal waveform and any pad
// hits draw onto the timeline live as they happen. Pitch correction applies to the take afterwards.
import { useEffect, useMemo, useRef, useState } from 'react'
import { View, Text, Pressable, ScrollView, StyleSheet, Animated, Alert, Platform, useWindowDimensions } from 'react-native'
import Svg, { Path, Line, G } from 'react-native-svg'
import { Ionicons } from '@expo/vector-icons'
import { SX, sxType, Panel, HwButton, Seg, Fader, Stepper } from './ui'
import { FONT, withAlpha } from '../games/studio'
import { getContext, resumeAudio, startSequencer, countIn, playBuffer, triggerPad, stepDuration, bufferFromPCM } from './engine'
import { ensureMic, startMic } from './mic'
import {
  getSong, SONG_BARS, songSteps, vocalOffset, DEFAULT_LATENCY, getDeviceNudge, setDeviceNudge, saveWav, rememberVocal, loadVocal,
  vocalForPlayback, cachedTuned, vocalPeaks,
} from './song'
import { NOTE_NAMES } from './autotune'
import { useT } from '../i18n'
import strings from '../i18n/strings/studio'

const LABEL_W = 70
const LANE_H = 24
const VOCAL_H = 72
const RULER_H = 18
const DEFAULT_TUNE = { on: false, key: 'auto', scale: 'major', style: 'hard' }

// Alert.alert is a no-op on web, so confirmations use the browser's confirm there.
function confirmAsync(title, msg, okLabel, cancelLabel) {
  if (Platform.OS === 'web') return Promise.resolve(typeof window !== 'undefined' && window.confirm ? window.confirm(`${title}\n\n${msg || ''}`) : true)
  return new Promise((res) => Alert.alert(title, msg, [
    { text: cancelLabel, style: 'cancel', onPress: () => res(false) },
    { text: okLabel, style: 'destructive', onPress: () => res(true) },
  ], { cancelable: true, onDismiss: () => res(false) }))
}

export default function SongView({ project, setProject, stopRef, onBeforeStart, onAddSample }) {
  const t = useT(strings)
  const { width } = useWindowDimensions()
  const song = getSong(project)
  const v = song.vocal
  const projRef = useRef(project)
  projRef.current = project

  const [mode, setMode] = useState('idle') // idle | count | play | rec
  const modeRef = useRef('idle')
  const setModeBoth = (m) => { modeRef.current = m; setMode(m) }
  const [armVoice, setArmVoice] = useState(true)
  const [armPads, setArmPads] = useState(true)
  const [barText, setBarText] = useState('')
  const [countN, setCountN] = useState(0)
  const [recHits, setRecHits] = useState([])
  const recHitsRef = useRef([])
  const [rawBuf, setRawBuf] = useState(null)
  const [playBuf, setPlayBuf] = useState(null)
  const [tuneProgress, setTuneProgress] = useState(null)
  const [live, setLive] = useState([]) // [{ t, v }] while recording
  const liveRef = useRef([])
  const lastLiveDraw = useRef(0)
  const [flash, setFlash] = useState({})

  const seqStop = useRef(null)
  const vocalStop = useRef(null)
  const micRef = useRef(null)
  const startAtRef = useRef(0)
  const raf = useRef(null)
  const timers = useRef([])
  const scrollRef = useRef(null)
  const scrollX = useRef(0)
  const lastScroll = useRef(0)
  const head = useRef(new Animated.Value(0)).current

  // ---- geometry
  const avail = Math.min(width, 720) - 32 - 24 - LABEL_W
  const barW = Math.max(44, Math.floor(avail / song.bars))
  const W = barW * song.bars
  const steps = song.bars * 16
  const stepW = W / steps
  const stepS = stepDuration(project.bpm)
  const songS = steps * stepS

  // ---- vocal buffers (raw + pitch-corrected)
  useEffect(() => {
    let alive = true
    setRawBuf(null)
    setPlayBuf(null)
    if (!v?.uri) return
    loadVocal(v).then((b) => { if (alive) setRawBuf(b) }).catch(() => {})
    return () => { alive = false }
  }, [v?.uri])

  const tuneSig = v ? `${v.uri}|${v.tune?.on}|${v.tune?.key}|${v.tune?.scale}|${v.tune?.style}` : ''
  useEffect(() => {
    let alive = true
    if (!rawBuf || !v) return
    if (!v.tune?.on) { setPlayBuf(rawBuf); setTuneProgress(null); return }
    const hit = cachedTuned(v)
    if (hit) { setPlayBuf(hit.buf); return }
    setTuneProgress(0)
    vocalForPlayback(v, (p) => alive && setTuneProgress(p))
      .then((res) => {
        if (!alive) return
        setPlayBuf(res.buf)
        setTuneProgress(null)
        const d = res.key
        if (d && v.tune.key === 'auto' && (v.tune.detected?.root !== d.root || v.tune.detected?.scale !== d.scale)) {
          updateVocal({ tune: { ...v.tune, detected: d } })
        }
      })
      .catch(() => { if (alive) { setTuneProgress(null); setPlayBuf(rawBuf) } })
    return () => { alive = false }
  }, [rawBuf, tuneSig])

  const updateSong = (patch) => setProject((p) => ({ ...p, song: { ...getSong(p), ...(typeof patch === 'function' ? patch(getSong(p)) : patch) } }))
  const updateVocal = (patch) => updateSong((s) => (s.vocal ? { vocal: { ...s.vocal, ...patch } } : {}))

  // ---- transport
  const clearTimers = () => { timers.current.forEach(clearTimeout); timers.current = [] }
  const later = (ms, fn) => { timers.current.push(setTimeout(fn, ms)) }

  const tick = () => {
    const c = getContext()
    const tm = c.currentTime - startAtRef.current
    const x = Math.max(0, Math.min(W, (tm / songS) * W))
    head.setValue(x)
    const bar = Math.floor(Math.max(0, tm) / (stepS * 16)) + 1
    const txt = t('songBarPos', { n: Math.min(bar, song.bars), total: song.bars })
    setBarText((prev) => (prev === txt ? prev : txt))
    const now = Date.now()
    if (now - lastScroll.current > 250 && scrollRef.current) {
      const vis = Math.min(avail, W)
      if (x > scrollX.current + vis * 0.75 || x < scrollX.current) {
        scrollRef.current.scrollTo({ x: Math.max(0, x - vis * 0.25), animated: true })
        lastScroll.current = now
      }
    }
    raf.current = requestAnimationFrame(tick)
  }

  const onChunk = (chunk) => {
    const c = getContext()
    const tm = c.currentTime - startAtRef.current - DEFAULT_LATENCY
    if (tm < 0) return
    let m = 0
    for (let i = 0; i < chunk.length; i += 4) { const a = Math.abs(chunk[i]); if (a > m) m = a }
    liveRef.current.push({ t: tm, v: m })
    const now = Date.now()
    if (now - lastLiveDraw.current > 70) { lastLiveDraw.current = now; setLive(liveRef.current.slice()) }
  }

  const stopAll = async ({ keep = true } = {}) => {
    cancelAnimationFrame(raf.current)
    clearTimers()
    seqStop.current?.()
    seqStop.current = null
    vocalStop.current?.()
    vocalStop.current = null
    const wasMode = modeRef.current
    setModeBoth('idle')
    setCountN(0)
    const mic = micRef.current
    micRef.current = null
    const startAt = startAtRef.current
    const newHits = recHitsRef.current
    recHitsRef.current = []
    setRecHits([])
    if (keep && newHits.length) updateSong((s) => ({ hits: [...(s.hits || []), ...newHits] }))
    if (mic) {
      try {
        const r = await mic.stop()
        if (keep && (wasMode === 'rec' || wasMode === 'count')) await keepTake(r, startAt)
      } catch (e) {
        Alert.alert(t('recordFailed'), e?.message || t('tryAgain'))
      }
    }
    liveRef.current = []
    setLive([])
    setBarText('')
    head.setValue(0)
  }
  if (stopRef) stopRef.current = () => { if (modeRef.current !== 'idle') stopAll() }

  const keepTake = async (r, startAt) => {
    const sr = r.sampleRate
    if (r.startClock == null || !r.data?.length) { Alert.alert(t('recordFailed'), t('nothingHeard')); return }
    let base = startAt - r.startClock + DEFAULT_LATENCY
    // nothing past bar 1 (stopped during the count-in): drop it quietly
    if (r.data.length / sr < base + 0.25) return
    const cut = Math.max(0, Math.floor((base - 0.3) * sr))
    const endCut = Math.min(r.data.length, Math.ceil((base + songS + 1) * sr))
    const data = r.data.slice(cut, endCut)
    base -= cut / sr
    const uri = await saveWav(data, sr)
    rememberVocal(uri, bufferFromPCM(data, sr))
    const nudgeMs = await getDeviceNudge()
    updateSong((s) => ({
      vocal: { uri, duration: data.length / sr, base, nudgeMs, vol: s.vocal?.vol ?? 0.9, mute: false, tune: { ...DEFAULT_TUNE, ...(s.vocal?.tune || {}), detected: null } },
    }))
  }

  const start = async (recording) => {
    if (modeRef.current !== 'idle') { stopAll(); return }
    const recVoice = recording && armVoice
    if (recVoice && v) {
      if (!(await confirmAsync(t('replaceVocalTitle'), t('replaceVocalMsg'), t('replace'), t('cancel')))) return
    }
    onBeforeStart?.()
    await resumeAudio()
    let mic = null
    if (recVoice) {
      if (!(await ensureMic())) { Alert.alert(t('micNeeded'), t('micNeededSong')); return }
      try {
        liveRef.current = []
        setLive([])
        mic = await startMic({ onChunk })
      } catch (e) {
        Alert.alert(t('recordFailed'), e?.message || t('tryAgain'))
        return
      }
    }
    const c = getContext()
    const p = projRef.current
    const beat = 60 / p.bpm
    const doCount = recording && song.countIn
    const startAt = c.currentTime + (doCount ? beat * 4 : 0) + 0.15
    startAtRef.current = startAt
    micRef.current = mic
    if (doCount) countIn(startAt, p.bpm)
    const baseHits = getSong(p).hits || []
    seqStop.current = startSequencer(() => projRef.current, null, {
      startAt,
      song: () => ({ hits: baseHits, steps: songSteps(projRef.current), beatMute: getSong(projRef.current).beatMute }),
      onEnd: () => stopAll(),
    })
    const vocalNow = getSong(p).vocal
    if (!recVoice && playBuf && vocalNow && !vocalNow.mute) vocalStop.current = playBuffer(playBuf, startAt, vocalOffset(vocalNow), vocalNow.vol ?? 0.9)
    if (doCount) {
      setModeBoth('count')
      for (let k = 0; k < 4; k++) later(Math.max(0, (startAt - beat * (4 - k) - c.currentTime) * 1000), () => setCountN(4 - k))
      later((startAt - c.currentTime) * 1000, () => { setCountN(0); setModeBoth('rec') })
    } else {
      setModeBoth(recording ? 'rec' : 'play')
    }
    raf.current = requestAnimationFrame(tick)
  }

  useEffect(() => () => {
    cancelAnimationFrame(raf.current)
    clearTimers()
    seqStop.current?.()
    vocalStop.current?.()
    micRef.current?.stop().catch(() => {})
  }, [])

  // ---- pads (play + record onto the timeline)
  const hitPad = (i) => {
    const p = projRef.current
    if (!p.pads[i]?.src) return
    triggerPad(p, i)
    setFlash((f) => ({ ...f, [i]: Date.now() }))
    if (modeRef.current === 'rec' && armPads) {
      const c = getContext()
      let s = (c.currentTime - startAtRef.current - DEFAULT_LATENCY / 2) / stepDuration(p.bpm)
      if (getSong(p).snap) s = Math.round(s)
      if (s >= 0 && s < songSteps(p)) {
        const h = { p: i, s: Math.round(s * 100) / 100, v: 1 }
        recHitsRef.current = [...recHitsRef.current, h]
        setRecHits(recHitsRef.current)
      }
    }
  }

  // ---- drawing
  const allHits = useMemo(() => [...(song.hits || []), ...recHits], [song.hits, recHits])
  const lanes = useMemo(() => {
    const len = project.steps || 16
    return project.pads
      .map((pad, i) => ({ pad, i }))
      .filter(({ pad, i }) => pad.src && (project.pattern[i]?.some(Boolean) || allHits.some((h) => h.p === i)))
      .map(({ pad, i }) => {
        let loop = ''
        if (!song.beatMute) {
          for (let a = 0; a < steps; a++) {
            const cell = project.pattern[i]?.[a % len]
            if (cell) loop += `M${(a * stepW).toFixed(1)} 5h${Math.max(1.5, stepW * 0.6).toFixed(1)}v${LANE_H - 10}h-${Math.max(1.5, stepW * 0.6).toFixed(1)}Z`
          }
        }
        let rec = ''
        for (const h of allHits) {
          if (h.p !== i) continue
          rec += `M${(h.s * stepW).toFixed(1)} 2h${Math.max(2, stepW * 0.7).toFixed(1)}v${LANE_H - 4}h-${Math.max(2, stepW * 0.7).toFixed(1)}Z`
        }
        return { i, pad, loop, rec }
      })
  }, [project.pads, project.pattern, project.steps, song.beatMute, steps, stepW, allHits])

  const vocalPath = useMemo(() => {
    const buf = playBuf || rawBuf
    if (!buf || !v) return ''
    const buckets = Math.max(20, Math.floor(W / 3))
    const pk = vocalPeaks(buf, vocalOffset(v), songS, buckets)
    let d = ''
    pk.forEach((p, b) => {
      if (p < 0.02) return
      const h = Math.max(1, p * (VOCAL_H - 10))
      d += `M${b * 3} ${((VOCAL_H - h) / 2).toFixed(1)}h2v${h.toFixed(1)}h-2Z`
    })
    return d
  }, [playBuf, rawBuf, v?.base, v?.nudgeMs, W, songS])

  const livePath = useMemo(() => {
    if (!live.length) return ''
    let top = 0.05
    for (const p of live) if (p.v > top) top = p.v
    let d = ''
    for (const p of live) {
      const h = Math.max(1, (p.v / top) * (VOCAL_H - 10))
      d += `M${((p.t / songS) * W).toFixed(1)} ${((VOCAL_H - h) / 2).toFixed(1)}h1.6v${h.toFixed(1)}h-1.6Z`
    }
    return d
  }, [live, W, songS])

  const lanesH = RULER_H + lanes.length * LANE_H + VOCAL_H + 4
  const busy = mode !== 'idle'
  const recording = mode === 'rec' || mode === 'count'
  const tune = { ...DEFAULT_TUNE, ...(v?.tune || {}) }
  const keyLabel = (root, scale) => `${NOTE_NAMES[root]} ${t(scale === 'minor' ? 'minor' : 'major')}`
  const padW = Math.floor((Math.min(width, 720) - 32 - 24 - 7 * 6) / 8)

  return (
    <View style={{ gap: 12 }}>
      {/* transport */}
      <Panel style={{ gap: 10 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <Pressable onPress={() => start(false)} style={[st.bigBtn, mode === 'play' && { backgroundColor: SX.accent, borderColor: SX.accent }]} accessibilityRole="button" accessibilityLabel={mode === 'play' ? t('songStop') : t('songPlay')} disabled={recording}>
            <Ionicons name={mode === 'play' ? 'stop' : 'play'} size={22} color={mode === 'play' ? SX.bg : SX.text} style={mode !== 'play' && { marginLeft: 3 }} />
          </Pressable>
          <Pressable onPress={() => start(true)} style={[st.bigBtn, { borderColor: withAlpha(SX.rec, 0.6) }, recording && { backgroundColor: SX.rec, borderColor: SX.rec }]} accessibilityRole="button" accessibilityLabel={recording ? t('songStop') : t('songRecord')} disabled={mode === 'play'}>
            {recording ? <Ionicons name="stop" size={22} color="#fff" /> : <View style={st.recDot} />}
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text style={[st.status, recording && { color: SX.rec }]} numberOfLines={1}>
              {mode === 'count' ? t('countingIn', { n: countN || 4 }) : mode === 'rec' ? `● ${t('recordingLive')} · ${barText}` : mode === 'play' ? barText : t('barsN', { n: song.bars })}
            </Text>
            <View style={{ flexDirection: 'row', gap: 6, marginTop: 6 }}>
              <HwButton label={t('armVoice')} icon={<Ionicons name="mic" size={12} color={armVoice ? SX.rec : SX.muted} />} active={armVoice} color={SX.rec} onPress={() => setArmVoice((x) => !x)} disabled={busy} style={st.chip} />
              <HwButton label={t('armPads')} icon={<Ionicons name="grid" size={12} color={armPads ? SX.rec : SX.muted} />} active={armPads} color={SX.rec} onPress={() => setArmPads((x) => !x)} disabled={busy} style={st.chip} />
              <HwButton label={t('countIn')} active={song.countIn} color={SX.cool} onPress={() => updateSong({ countIn: !song.countIn })} disabled={busy} style={st.chip} />
            </View>
          </View>
        </View>
        <Seg small options={SONG_BARS.map((n) => ({ key: n, label: t('barsN', { n }) }))} value={song.bars} onChange={(n) => !busy && updateSong({ bars: n })} />
      </Panel>

      {/* timeline */}
      <Panel style={{ paddingHorizontal: 0, paddingVertical: 8 }}>
        <View style={{ flexDirection: 'row' }}>
          <View style={{ width: LABEL_W, paddingLeft: 10 }}>
            <View style={{ height: RULER_H }} />
            {lanes.map(({ i, pad }) => (
              <View key={i} style={[st.laneLabel, { height: LANE_H }]}>
                <View style={[st.dot, { backgroundColor: pad.color }]} />
                <Text style={st.laneText} numberOfLines={1}>{pad.label}</Text>
              </View>
            ))}
            <View style={[st.laneLabel, { height: VOCAL_H }]}>
              <Ionicons name="mic" size={12} color={v?.mute ? SX.faint : SX.rec} />
              <Text style={[st.laneText, { color: SX.text }]} numberOfLines={1}>{t('laneVocal')}</Text>
            </View>
          </View>
          <ScrollView
            ref={scrollRef}
            horizontal
            showsHorizontalScrollIndicator={false}
            onScroll={(e) => { scrollX.current = e.nativeEvent.contentOffset.x }}
            scrollEventThrottle={32}
            style={{ flex: 1 }}
            contentContainerStyle={{ paddingRight: 12 }}
          >
            <View style={{ width: W, height: lanesH }}>
              <Svg width={W} height={lanesH}>
                {Array.from({ length: song.bars + 1 }, (_, b) => (
                  <Line key={`g${b}`} x1={b * barW} x2={b * barW} y1={0} y2={lanesH} stroke={b % 4 === 0 ? SX.lineStrong : SX.line} strokeWidth={1} />
                ))}
                {lanes.map(({ i, pad, loop, rec }, k) => (
                  <G key={i} transform={`translate(0, ${RULER_H + k * LANE_H})`}>
                    {loop ? <Path d={loop} fill={withAlpha(pad.color, 0.35)} /> : null}
                    {rec ? <Path d={rec} fill={pad.color} /> : null}
                  </G>
                ))}
                <G transform={`translate(0, ${RULER_H + lanes.length * LANE_H})`}>
                  {vocalPath && !recording ? <Path d={vocalPath} fill={v?.mute ? SX.faint : tune.on ? SX.hot : SX.cool} /> : null}
                  {livePath ? <Path d={livePath} fill={SX.rec} /> : null}
                </G>
              </Svg>
              {/* bar numbers */}
              {Array.from({ length: song.bars }, (_, b) => (
                <Text key={`n${b}`} style={[st.barNum, { left: b * barW + 4 }]}>{b + 1}</Text>
              ))}
              {!v && !live.length ? <Text style={[st.vocalEmpty, { top: RULER_H + lanes.length * LANE_H + VOCAL_H / 2 - 8 }]} numberOfLines={1}>{t('vocalEmptyLane')}</Text> : null}
              <Animated.View pointerEvents="none" style={[st.playhead, { height: lanesH, transform: [{ translateX: head }] }]} />
            </View>
          </ScrollView>
        </View>
        <View style={{ flexDirection: 'row', gap: 8, paddingHorizontal: 10, marginTop: 8, flexWrap: 'wrap' }}>
          <HwButton label={t('laneLoop')} icon={<Ionicons name="repeat" size={13} color={song.beatMute ? SX.muted : SX.accent} />} active={!song.beatMute} onPress={() => updateSong({ beatMute: !song.beatMute })} style={st.chip} />
          <HwButton label={t('snap')} active={song.snap} color={SX.cool} onPress={() => updateSong({ snap: !song.snap })} style={st.chip} />
          {song.hits?.length ? (
            <HwButton label={t('clearHits')} icon={<Ionicons name="trash-outline" size={12} color={SX.muted} />} onPress={async () => { if (await confirmAsync(t('clearHitsTitle'), '', t('clear'), t('cancel'))) updateSong({ hits: [] }) }} disabled={busy} style={st.chip} />
          ) : null}
        </View>
      </Panel>

      {!v && !busy ? <Text style={[sxType.small, { textAlign: 'center', paddingHorizontal: 12 }]}>{t('headphonesTip')}</Text> : null}

      {/* pads */}
      <Panel style={{ gap: 8 }}>
        <Text style={sxType.label}>{t('padsTitle')}</Text>
        <View style={st.padGrid}>
          {project.pads.map((pad, i) => (
            <MiniPad key={i} pad={pad} size={padW} flashAt={flash[i]} onPress={() => hitPad(i)} />
          ))}
        </View>
        <Text style={sxType.small}>{t('padsHint')}</Text>
      </Panel>

      {/* vocal */}
      {v ? (
        <Panel style={{ gap: 12 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Ionicons name="mic" size={16} color={SX.rec} />
            <Text style={[sxType.title, { flex: 1 }]}>{t('vocalTitle')}</Text>
            <HwButton label="Mute" active={!!v.mute} color={SX.rec} onPress={() => updateVocal({ mute: !v.mute })} style={st.chip} />
            <HwButton icon={<Ionicons name="trash-outline" size={14} color={SX.muted} />} accessibilityLabel={t('deleteVocalTitle')} disabled={busy} style={st.chip} onPress={async () => { if (await confirmAsync(t('deleteVocalTitle'), t('deleteVocalMsg'), t('delete'), t('cancel'))) updateSong({ vocal: null }) }} />
          </View>
          <View>
            <Text style={sxType.label}>{t('volume')}</Text>
            <Fader value={v.vol ?? 0.9} onChange={(x) => updateVocal({ vol: x })} color={SX.rec} />
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <Stepper label={t('sync')} value={v.nudgeMs || 0} step={10} min={-400} max={400} format={(x) => `${x > 0 ? '+' : ''}${x}ms`} onChange={(x) => { updateVocal({ nudgeMs: x }); setDeviceNudge(x) }} />
            <Text style={[sxType.small, { flex: 1 }]}>{t('syncHint')}</Text>
          </View>

          <View style={st.divider} />
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Ionicons name="musical-note" size={16} color={SX.hot} />
            <Text style={[sxType.title, { flex: 1 }]}>{t('tuneTitle')}</Text>
            <HwButton label={tune.on ? t('on') : t('off')} active={tune.on} color={SX.hot} onPress={() => updateVocal({ tune: { ...tune, on: !tune.on } })} style={{ minWidth: 64 }} />
          </View>
          {tune.on ? (
            <>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
                <HwButton label={tune.key === 'auto' && tune.detected ? t('tuneAutoKey', { key: keyLabel(tune.detected.root, tune.detected.scale) }) : t('tuneAuto')} active={tune.key === 'auto'} color={SX.hot} onPress={() => updateVocal({ tune: { ...tune, key: 'auto' } })} style={st.chip} />
                {NOTE_NAMES.map((n, k) => (
                  <HwButton key={n} label={n} active={tune.key === k} color={SX.hot} onPress={() => updateVocal({ tune: { ...tune, key: k, scale: tune.key === 'auto' && tune.detected ? tune.detected.scale : tune.scale } })} style={st.keyChip} />
                ))}
              </ScrollView>
              <View style={{ flexDirection: 'row', gap: 10 }}>
                {tune.key !== 'auto' ? (
                  <Seg small style={{ flex: 1 }} options={[{ key: 'major', label: t('major') }, { key: 'minor', label: t('minor') }]} value={tune.scale} onChange={(s) => updateVocal({ tune: { ...tune, scale: s } })} />
                ) : null}
                <Seg small style={{ flex: 1 }} options={[{ key: 'natural', label: t('natural') }, { key: 'hard', label: t('hard') }]} value={tune.style} onChange={(s) => updateVocal({ tune: { ...tune, style: s } })} />
              </View>
              <Text style={[sxType.small, tuneProgress != null && { color: SX.hot }]}>
                {tuneProgress != null ? t('tuning', { pct: Math.round(tuneProgress * 100) }) : t('tuneHint')}
              </Text>
            </>
          ) : null}

          <View style={st.divider} />
          <HwButton
            label={t('toSampler')}
            icon={<Ionicons name="cut-outline" size={14} color={SX.text} />}
            disabled={busy || !playBuf}
            onPress={async () => {
              try {
                const buf = playBuf
                const data = buf.getChannelData(0)
                const from = Math.max(0, Math.floor(vocalOffset(v) * buf.sampleRate))
                const uri = await saveWav(data.slice(from), buf.sampleRate, 'vs')
                await onAddSample?.(uri, `${t('laneVocal')}${tune.on ? ' (tuned)' : ''}.wav`)
              } catch (e) {
                Alert.alert(t('recordFailed'), e?.message || t('tryAgain'))
              }
            }}
          />
        </Panel>
      ) : null}
    </View>
  )
}

function MiniPad({ pad, size, flashAt, onPress }) {
  const [lit, setLit] = useState(false)
  useEffect(() => {
    if (!flashAt) return
    setLit(true)
    const tm = setTimeout(() => setLit(false), 120)
    return () => clearTimeout(tm)
  }, [flashAt])
  const empty = !pad.src
  const c = empty ? '#3a4152' : pad.color
  return (
    <Pressable
      onPressIn={onPress}
      disabled={empty}
      style={[st.miniPad, { width: size, height: size, borderColor: withAlpha(c, empty ? 0.3 : 0.6), backgroundColor: lit ? withAlpha(c, 0.7) : withAlpha(c, empty ? 0.04 : 0.14) }]}
      accessibilityRole="button"
      accessibilityLabel={pad.label}
    >
      <Text style={[st.miniPadText, empty && { color: SX.faint }]} numberOfLines={1}>{empty ? '' : pad.label}</Text>
    </Pressable>
  )
}

const st = StyleSheet.create({
  bigBtn: { width: 54, height: 54, borderRadius: 27, backgroundColor: SX.panel2, borderWidth: 1.5, borderColor: SX.lineStrong, alignItems: 'center', justifyContent: 'center' },
  recDot: { width: 18, height: 18, borderRadius: 9, backgroundColor: SX.rec },
  status: { fontFamily: FONT.ui, fontSize: 13, letterSpacing: 1.2, color: SX.text, textTransform: 'uppercase' },
  chip: { minHeight: 28, paddingHorizontal: 8 },
  keyChip: { minHeight: 28, paddingHorizontal: 6, minWidth: 34 },
  laneLabel: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingRight: 6 },
  laneText: { fontFamily: FONT.uiSemi, fontSize: 11, color: SX.muted, flexShrink: 1 },
  dot: { width: 7, height: 7, borderRadius: 4 },
  barNum: { position: 'absolute', top: 2, fontFamily: FONT.display, fontSize: 10, color: SX.faint },
  vocalEmpty: { position: 'absolute', left: 8, fontFamily: FONT.uiSemi, fontSize: 12, color: SX.faint },
  playhead: { position: 'absolute', left: 0, top: 0, width: 2, backgroundColor: '#fff', shadowColor: '#fff', shadowOpacity: 0.8, shadowRadius: 4 },
  padGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  miniPad: { borderRadius: 9, borderWidth: 1, alignItems: 'center', justifyContent: 'flex-end', paddingBottom: 4, paddingHorizontal: 2 },
  miniPadText: { fontFamily: FONT.ui, fontSize: 8.5, letterSpacing: 0.4, color: SX.text, textTransform: 'uppercase' },
  divider: { height: 1, backgroundColor: SX.line },
})
