// iYiYi Studio: drum machine + sampler. 16 pads (8 kit pads, 8 sampler pads), a step
// sequencer (16 or 32 steps), tempo / swing / metronome, live pad recording, an Auto mode that
// writes beats, a sampler that chops any audio file onto pads, a mixer, and export to a sound
// (private, or public after a copyright scan). Beats save on the device and play without export.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  View, Text, Pressable, StyleSheet, ScrollView, Modal, TextInput, Alert, ActivityIndicator, Platform, useWindowDimensions,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import * as Haptics from 'expo-haptics'
import { useFocusEffect } from '@react-navigation/native'
import { LinearGradient } from 'expo-linear-gradient'
import { useAudioRecorder, RecordingPresets, requestRecordingPermissionsAsync, setAudioModeAsync } from 'expo-audio'
import { FONT, useStudioFonts, withAlpha } from '../games/studio'
import { SX, sxType, Panel, HwButton, Seg, Fader, Stepper, Waveform } from '../studio/ui'
import { KITS } from '../studio/kits'
import {
  NUM_PADS, resumeAudio, prepareProject, loadSource, triggerPad, startSequencer, renderProject, peaks as getPeaks, chop, playRegion, cachedBuffer,
} from '../studio/engine'
import { newProject, loadProject, saveProject, withKit, setSteps, keepFile, PAD_COLORS } from '../studio/projects'
import { generateBeat, STYLES, STYLE_BY_ID, styleForKit } from '../studio/generator'
import { encodeWav } from '../studio/wav'
import { publishSound } from '../lib/sounds'
import TagPicker from '../components/TagPicker'
import { pauseMusic } from '../lib/musicPlayer'
import { useT, translate } from '../i18n'
import strings from '../i18n/strings/studio'

const TABS = [
  { key: 'pads', label: 'tabPads' },
  { key: 'steps', label: 'tabSteps' },
  { key: 'sampler', label: 'tabSampler' },
  { key: 'mix', label: 'tabMix' },
]
const tap = () => { if (Platform.OS !== 'web') Haptics.selectionAsync().catch(() => {}) }

export default function StudioScreen({ navigation, route }) {
  useStudioFonts()
  const t = useT(strings)
  const insets = useSafeAreaInsets()
  const { width } = useWindowDimensions()
  const [project, setProjectState] = useState(null)
  useEffect(() => { pauseMusic() }, [])
  const projRef = useRef(null)
  const [dirty, setDirty] = useState(false)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState('pads')
  const [playing, setPlaying] = useState(false)
  const [playStep, setPlayStep] = useState(-1)
  const playStepRef = useRef(-1)
  const [rec, setRec] = useState(false)
  const [selPad, setSelPad] = useState(0)
  const [bar, setBar] = useState(0)
  const [autoOpen, setAutoOpen] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  const [renameOpen, setRenameOpen] = useState(false)
  const [flash, setFlash] = useState({})
  const stopRef = useRef(null)
  const tapTimes = useRef([])

  const setProject = useCallback((updater, { markDirty = true } = {}) => {
    setProjectState((prev) => {
      const next = typeof updater === 'function' ? updater(prev) : updater
      projRef.current = next
      return next
    })
    if (markDirty) setDirty(true)
  }, [])

  // load or create
  useEffect(() => {
    let alive = true
    ;(async () => {
      const id = route?.params?.projectId
      let p = id ? await loadProject(id) : null
      if (!p) p = newProject(route?.params?.kit)
      if (route?.params?.autoStyle) p = generateBeat(p, route.params.autoStyle)
      if (!alive) return
      projRef.current = p
      setProjectState(p)
      try {
        await resumeAudio()
        await prepareProject(p)
      } catch (e) {
        console.warn('Studio: audio init failed', e)
      }
      if (alive) setLoading(false)
    })()
    return () => { alive = false }
  }, [route?.params?.projectId])

  // stop audio when leaving
  useFocusEffect(useCallback(() => () => { stopRef.current?.(); stopRef.current = null; setPlaying(false) }, []))

  const save = useCallback(async (quiet) => {
    const p = projRef.current
    if (!p) return
    const saved = await saveProject(p)
    projRef.current = saved
    setDirty(false)
    if (!quiet) Alert.alert(translate(strings, 'savedTitle'), translate(strings, 'savedMsg', { name: saved.name }))
  }, [])

  // autosave every 20 s while there are changes
  useEffect(() => {
    if (!dirty) return
    const t = setTimeout(() => save(true).catch(() => {}), 20000)
    return () => clearTimeout(t)
  }, [dirty, project, save])

  const togglePlay = async () => {
    tap()
    if (playing) {
      stopRef.current?.()
      stopRef.current = null
      setPlaying(false)
      return
    }
    await resumeAudio()
    stopRef.current = startSequencer(() => projRef.current, (s) => { playStepRef.current = s; setPlayStep(s) })
    setPlaying(true)
  }

  const hitPad = async (i) => {
    const p = projRef.current
    if (!p) return
    setSelPad(i)
    setFlash((f) => ({ ...f, [i]: Date.now() }))
    if (!p.pads[i]?.src) {
      if (i >= 8) setTab('sampler')
      return
    }
    triggerPad(p, i)
    if (rec && playing && playStepRef.current >= 0) {
      const s = playStepRef.current
      setProject((prev) => {
        const pattern = prev.pattern.map((row, r) => (r === i ? row.map((v, k) => (k === s ? 1 : v)) : row))
        return { ...prev, pattern }
      })
    }
  }

  const toggleStep = (padIdx, step, accent) => {
    tap()
    setProject((prev) => {
      const pattern = prev.pattern.map((row, r) => (r === padIdx ? row.map((v, k) => (k === step ? (accent ? (v === 2 ? 0 : 2) : v ? 0 : 1) : v)) : row))
      return { ...prev, pattern }
    })
    const p = projRef.current
    if (!playing && p?.pads[padIdx]?.src && !(p.pattern[padIdx]?.[step])) triggerPad(p, padIdx)
  }

  const updatePad = (i, patch) => setProject((prev) => ({ ...prev, pads: prev.pads.map((pd, k) => (k === i ? { ...pd, ...patch } : pd)) }))

  const tapTempo = () => {
    const now = Date.now()
    tapTimes.current = [...tapTimes.current.filter((t) => now - t < 2500), now].slice(-6)
    if (tapTimes.current.length >= 3) {
      const ts = tapTimes.current
      const avg = (ts[ts.length - 1] - ts[0]) / (ts.length - 1)
      const bpm = Math.round(Math.max(60, Math.min(190, 60000 / avg)))
      setProject((prev) => ({ ...prev, bpm }))
    }
  }

  const changeKit = async (kitId) => {
    tap()
    const next = withKit(projRef.current, kitId)
    setProject(next)
    await prepareProject(next)
  }

  const clearPattern = () => {
    Alert.alert(t('clearTitle'), t('clearMsg'), [
      { text: t('cancel'), style: 'cancel' },
      { text: t('clear'), style: 'destructive', onPress: () => setProject((prev) => ({ ...prev, pattern: prev.pattern.map((r) => r.map(() => 0)) })) },
    ])
  }

  const runAuto = (styleId) => {
    setAutoOpen(false)
    const kit = STYLE_BY_ID[styleId]?.kit
    setProject((prev) => generateBeat(kit && prev.kit !== kit ? withKit(prev, kit) : prev, styleId))
    setTab('steps')
    if (!playing) setTimeout(() => togglePlay(), 120)
  }

  if (loading || !project) {
    return (
      <View style={[st.screen, { alignItems: 'center', justifyContent: 'center' }]}>
        <ActivityIndicator color={SX.accent} />
        <Text style={[sxType.small, { marginTop: 10 }]}>{t('loading')}</Text>
      </View>
    )
  }

  const maxW = Math.min(width, 720)
  return (
    <View style={st.screen}>
      <View style={[st.wrap, { paddingTop: insets.top + 6, maxWidth: maxW }]}>
        {/* header */}
        <View style={st.header}>
          <Pressable onPress={() => { stopRef.current?.(); if (dirty) save(true).catch(() => {}); navigation.goBack() }} hitSlop={10} style={st.iconBtn} accessibilityLabel={t('back')}>
            <Ionicons name="chevron-back" size={22} color={SX.text} />
          </Pressable>
          <Pressable onPress={() => setRenameOpen(true)} style={{ flex: 1 }} accessibilityLabel={t('renameBeat')}>
            <Text style={sxType.label}>Studio{dirty ? t('unsavedSuffix') : ''}</Text>
            <Text style={sxType.title} numberOfLines={1}>{project.name}</Text>
          </Pressable>
          <HwButton icon={<Ionicons name="save-outline" size={16} color={SX.text} />} onPress={() => save()} accessibilityLabel={t('saveBeat')} style={{ paddingHorizontal: 10 }} />
          <HwButton label={t('export')} active color={SX.accent} onPress={() => { stopRef.current?.(); stopRef.current = null; setPlaying(false); setExportOpen(true) }} icon={<Ionicons name="share-outline" size={15} color={SX.accent} />} />
        </View>

        {/* LCD + transport deck (MPC-style): kit, tempo, position, playhead LEDs */}
        <Panel style={st.deck}>
          <View style={st.lcd}>
            <View style={st.lcdRow}>
              <Text style={st.lcdSmall} numberOfLines={1}>KIT · {(KITS.find((k) => k.id === project.kit)?.name || t('kitCustom')).toUpperCase()}</Text>
              <Text style={st.lcdSmall}>{playing && playStep >= 0 ? t('lcdBar', { n: Math.floor(playStep / 16) + 1, total: project.steps / 16, step: String((playStep % 16) + 1).padStart(2, '0') }) : `${t(project.steps > 16 ? 'lcdBarsMany' : 'lcdBarsOne', { n: project.steps / 16 })} · ${rec ? t('recArmed') : t('ready')}`}</Text>
            </View>
            <View style={st.lcdMain}>
              <View style={st.lcdBlock}>
                <View style={st.lcdBtns}>
                  <Pressable onPress={() => setProject((p) => ({ ...p, bpm: Math.max(60, p.bpm - 1) }))} onLongPress={() => setProject((p) => ({ ...p, bpm: Math.max(60, p.bpm - 10) }))} style={st.lcdBtn} hitSlop={6} accessibilityLabel={t('slower')}><Ionicons name="remove" size={16} color={SX.accent} /></Pressable>
                  <Pressable onPress={tapTempo} accessibilityLabel={t('tapTempo')} accessibilityHint={t('tapTempoHint')}>
                    <Text style={st.lcdBig}>{project.bpm}</Text>
                  </Pressable>
                  <Pressable onPress={() => setProject((p) => ({ ...p, bpm: Math.min(190, p.bpm + 1) }))} onLongPress={() => setProject((p) => ({ ...p, bpm: Math.min(190, p.bpm + 10) }))} style={st.lcdBtn} hitSlop={6} accessibilityLabel={t('faster')}><Ionicons name="add" size={16} color={SX.accent} /></Pressable>
                </View>
                <Text style={st.lcdLabel}>{t('bpmTap')}</Text>
              </View>
              <View style={[st.lcdBlock, { alignItems: 'flex-end' }]}>
                <View style={st.lcdBtns}>
                  <Pressable onPress={() => setProject((p) => ({ ...p, swing: Math.max(0, Math.round(((p.swing || 0) - 0.05) * 100) / 100) }))} style={st.lcdBtn} hitSlop={6} accessibilityLabel={t('lessSwing')}><Ionicons name="remove" size={16} color={SX.accent} /></Pressable>
                  <Text style={st.lcdMid}>{Math.round((project.swing || 0) * 100)}%</Text>
                  <Pressable onPress={() => setProject((p) => ({ ...p, swing: Math.min(0.6, Math.round(((p.swing || 0) + 0.05) * 100) / 100) }))} style={st.lcdBtn} hitSlop={6} accessibilityLabel={t('moreSwing')}><Ionicons name="add" size={16} color={SX.accent} /></Pressable>
                </View>
                <Text style={st.lcdLabel}>SWING</Text>
              </View>
            </View>
            <View style={st.leds}>
              {Array.from({ length: 16 }, (_, i) => {
                const on = playing && playStep >= 0 && playStep % 16 === i
                return <View key={i} style={[st.led, i % 4 === 0 && st.ledBeat, on && st.ledOn]} />
              })}
            </View>
          </View>
          <View style={st.transportRow}>
            <Pressable onPress={togglePlay} style={[st.play, playing && { backgroundColor: SX.accent, borderColor: SX.accent }]} accessibilityLabel={playing ? t('stop') : t('play')}>
              <Ionicons name={playing ? 'stop' : 'play'} size={24} color={playing ? SX.bg : SX.text} style={!playing && { marginLeft: 3 }} />
            </Pressable>
            <Pressable onPress={() => { tap(); setRec((r) => !r) }} style={[st.recBtn, rec && { backgroundColor: withAlpha(SX.rec, 0.2), borderColor: SX.rec }]} accessibilityLabel={t('recordA11y')}>
              <View style={[st.recDot, rec && { backgroundColor: SX.rec }]} />
            </Pressable>
            <View style={{ flex: 1 }} />
            <HwButton label={t('stepsCount', { n: project.steps })} onPress={() => { tap(); setProject((p) => setSteps(p, p.steps === 16 ? 32 : 16)); setBar(0) }} accessibilityLabel={t('patternLength')} style={st.miniBtn} />
            <HwButton label={t('click')} icon={<Ionicons name="pulse" size={13} color={project.metronome ? SX.cool : SX.muted} />} active={project.metronome} color={SX.cool} onPress={() => setProject((p) => ({ ...p, metronome: !p.metronome }))} accessibilityLabel={t('metronome')} style={st.miniBtn} />
          </View>
        </Panel>

        {/* kit + auto */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={st.kitRow}>
          <HwButton label={t('auto')} active color={SX.hot} icon={<Ionicons name="sparkles" size={14} color={SX.hot} />} onPress={() => setAutoOpen(true)} />
          {KITS.map((k) => (
            <HwButton key={k.id} label={k.name} active={project.kit === k.id} onPress={() => changeKit(k.id)} />
          ))}
          <HwButton icon={<Ionicons name="trash-outline" size={14} color={SX.muted} />} onPress={clearPattern} accessibilityLabel={t('clearPattern')} />
        </ScrollView>

        <Seg options={TABS.map((x) => ({ ...x, label: t(x.label) }))} value={tab} onChange={(k) => { tap(); setTab(k) }} style={{ marginTop: 10 }} />
      </View>

      <ScrollView contentContainerStyle={[st.content, { paddingBottom: insets.bottom + 30, maxWidth: maxW }]} keyboardShouldPersistTaps="handled">
        {tab === 'pads' ? (
          <PadsView project={project} selPad={selPad} flash={flash} onHit={hitPad} onUpdatePad={updatePad} playing={playing} rec={rec} />
        ) : tab === 'steps' ? (
          <StepsView project={project} playStep={playStep} bar={bar} setBar={setBar} onToggle={toggleStep} selPad={selPad} setSelPad={setSelPad} />
        ) : tab === 'sampler' ? (
          <SamplerView project={project} setProject={setProject} selPad={selPad} />
        ) : (
          <MixView project={project} onUpdatePad={updatePad} />
        )}
      </ScrollView>

      <AutoSheet visible={autoOpen} onClose={() => setAutoOpen(false)} onPick={runAuto} />
      <RenameSheet visible={renameOpen} name={project.name} onClose={() => setRenameOpen(false)} onSave={(name) => { setProject((p) => ({ ...p, name })); setRenameOpen(false) }} />
      <ExportSheet visible={exportOpen} project={project} onClose={() => setExportOpen(false)} onSaved={() => save(true)} navigation={navigation} />
    </View>
  )
}

// ---- Pads ---------------------------------------------------------------------------------
function PadsView({ project, selPad, flash, onHit, onUpdatePad, rec, playing }) {
  const t = useT(strings)
  const pad = project.pads[selPad]
  const { width } = useWindowDimensions()
  const padW = Math.floor((Math.min(width, 720) - 32 - 24) / 4)
  return (
    <View style={{ gap: 12 }}>
      {rec ? <Text style={[sxType.small, { color: playing ? SX.rec : SX.muted, textAlign: 'center' }]}>{playing ? t('recordingOn') : t('recordPressPlay')}</Text> : null}
      <View style={st.padGrid}>
        {project.pads.map((p, i) => (
          <Pad key={i} pad={p} index={i} size={padW} selected={selPad === i} flashAt={flash[i]} onPress={() => onHit(i)} />
        ))}
      </View>
      {pad ? (
        <Panel style={{ gap: 12 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <View style={[st.dot, { backgroundColor: pad.src ? pad.color : SX.faint }]} />
            <Text style={sxType.title}>{pad.label}</Text>
            <Text style={[sxType.small, { marginLeft: 'auto' }]}>{t('padN', { n: selPad + 1 })}</Text>
          </View>
          <View>
            <Text style={sxType.label}>{t('volume')}</Text>
            <Fader value={pad.vol ?? 0.85} onChange={(v) => onUpdatePad(selPad, { vol: v })} color={pad.color} />
          </View>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Stepper label={t('pitch')} value={pad.pitch || 0} min={-12} max={12} format={(v) => (v > 0 ? `+${v}` : `${v}`)} onChange={(v) => onUpdatePad(selPad, { pitch: v })} />
            <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-end' }}>
              <HwButton label="Mute" active={pad.mute} color={SX.rec} onPress={() => onUpdatePad(selPad, { mute: !pad.mute })} />
              <HwButton label="Solo" active={pad.solo} color={SX.ok} onPress={() => onUpdatePad(selPad, { solo: !pad.solo })} />
            </View>
          </View>
          {pad.src?.kind === 'uri' ? (() => {
            // Fine-tune a chop: nudge where it starts and stops (10 ms a tap, 100 ms on long press).
            const len = cachedBuffer(pad.src)?.duration ?? (pad.src.end ?? 0) + 5
            const st0 = pad.src.start ?? 0
            const en0 = pad.src.end ?? len
            const setRegion = (patch) => { onUpdatePad(selPad, { src: { ...pad.src, ...patch } }); if (!rec) setTimeout(() => onHit(selPad), 60) }
            return (
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Stepper label={t('chopStart')} step={0.01} value={st0} min={0} max={Math.max(0, en0 - 0.03)} format={(v) => `${v.toFixed(2)}s`} onChange={(v) => setRegion({ start: Math.round(v * 1000) / 1000 })} />
                <Stepper label={t('chopEnd')} step={0.01} value={en0} min={st0 + 0.03} max={len} format={(v) => `${v.toFixed(2)}s`} onChange={(v) => setRegion({ end: Math.round(v * 1000) / 1000 })} />
              </View>
            )
          })() : null}
        </Panel>
      ) : null}
    </View>
  )
}

function Pad({ pad, index, size, selected, flashAt, onPress }) {
  const tr = useT(strings)
  const [lit, setLit] = useState(false)
  useEffect(() => {
    if (!flashAt) return
    setLit(true)
    const t = setTimeout(() => setLit(false), 140)
    return () => clearTimeout(t)
  }, [flashAt])
  const empty = !pad.src
  const c = empty ? '#3a4152' : pad.color
  return (
    <Pressable
      onPressIn={onPress}
      style={[
        st.pad,
        { width: size, height: size, borderColor: selected ? c : empty ? SX.line : withAlpha(c, 0.35) },
        lit && { backgroundColor: withAlpha(c, 0.6), shadowColor: c, shadowOpacity: 0.9, shadowRadius: 14, elevation: 8, transform: [{ scale: 0.97 }] },
        !lit && !empty && { backgroundColor: withAlpha(c, 0.13) },
      ]}
      accessibilityRole="button"
      accessibilityLabel={empty ? tr('emptyPad', { n: index + 1 }) : pad.label}
    >
      {/* rubber pad shading: light from the top, darker at the bottom edge */}
      <LinearGradient colors={['rgba(255,255,255,0.10)', 'rgba(255,255,255,0.02)', 'rgba(0,0,0,0.28)']} locations={[0, 0.45, 1]} style={[StyleSheet.absoluteFill, { borderRadius: 13 }]} pointerEvents="none" />
      <View style={st.padInset} pointerEvents="none" />
      <View style={[st.padLed, { backgroundColor: lit ? '#fff' : c, opacity: empty ? 0.35 : 1, shadowColor: c, shadowOpacity: empty ? 0 : 0.9, shadowRadius: 4 }]} />
      <Text style={[st.padLabel, empty && { color: SX.faint }]} numberOfLines={2}>{empty ? tr('addSample') : pad.label}</Text>
      <Text style={st.padNum}>{String(index + 1).padStart(2, '0')}</Text>
    </Pressable>
  )
}

// ---- Steps --------------------------------------------------------------------------------
function StepsView({ project, playStep, bar, setBar, onToggle, selPad, setSelPad }) {
  const t = useT(strings)
  const { width } = useWindowDimensions()
  const bars = project.steps / 16
  const offset = bar * 16
  const labelW = 74
  const cellW = Math.max(16, Math.floor((Math.min(width, 720) - 32 - labelW - 15 * 3) / 16))
  return (
    <View style={{ gap: 10 }}>
      {bars > 1 ? (
        <Seg small options={Array.from({ length: bars }, (_, b) => ({ key: b, label: t('barN', { n: b + 1 }) }))} value={bar} onChange={setBar} />
      ) : null}
      <Panel style={{ paddingHorizontal: 8, gap: 6 }}>
        {project.pads.map((pad, i) => {
          if (!pad.src && i >= 8 && !project.pattern[i]?.some(Boolean)) return null
          return (
            <View key={i} style={st.stepRow}>
              <Pressable onPress={() => setSelPad(i)} style={[st.stepLabel, { width: labelW }]}>
                <View style={[st.dot, { backgroundColor: pad.src ? pad.color : SX.faint }]} />
                <Text style={[st.stepLabelText, selPad === i && { color: SX.text }]} numberOfLines={1}>{pad.label}</Text>
              </Pressable>
              {Array.from({ length: 16 }, (_, k) => {
                const s = offset + k
                const v = project.pattern[i]?.[s]
                const head = playStep === s
                return (
                  <Pressable
                    key={k}
                    onPress={() => onToggle(i, s, false)}
                    onLongPress={() => onToggle(i, s, true)}
                    delayLongPress={280}
                    style={[
                      st.cell,
                      { width: cellW, height: cellW + 6 },
                      k % 4 === 0 && { marginLeft: k ? 3 : 0 },
                      { backgroundColor: v ? withAlpha(pad.color, v === 2 ? 1 : 0.75) : k % 8 < 4 ? '#1d222b' : '#171b22' },
                      head && { borderColor: '#fff', borderWidth: 1.5 },
                    ]}
                    accessibilityLabel={t(v ? 'stepA11yOn' : 'stepA11y', { pad: pad.label, n: s + 1 })}
                  />
                )
              })}
            </View>
          )
        })}
      </Panel>
      <Text style={[sxType.small, { textAlign: 'center' }]}>{t('stepsHint')}</Text>
    </View>
  )
}

// ---- Sampler ------------------------------------------------------------------------------
function SamplerView({ project, setProject, selPad }) {
  const t = useT(strings)
  const [busy, setBusy] = useState(false)
  const [sampleIdx, setSampleIdx] = useState(0)
  const [buf, setBuf] = useState(null)
  const [count, setCount] = useState(8)
  const [mode, setMode] = useState('transients')
  const [slices, setSlices] = useState([])
  const [sel, setSel] = useState(-1)
  const stopRef = useRef(null)
  const sample = project.samples?.[sampleIdx]
  // Record your voice (or anything) with the mic straight into the sampler.
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY)
  const [recAt, setRecAt] = useState(0) // > 0 while recording (start time)
  const [recNow, setRecNow] = useState(0)
  const recTimer = useRef(null)
  const MAX_REC_S = 30
  useEffect(() => () => { clearInterval(recTimer.current); try { recorder.stop() } catch {} }, [])

  useEffect(() => {
    let alive = true
    setBuf(null)
    setSlices([])
    if (!sample) return
    loadSource({ kind: 'uri', uri: sample.uri })
      .then((b) => {
        if (!alive || !b) return
        setBuf(b)
        setSlices(chop(b, count, mode))
      })
      .catch(() => Alert.alert(t('openFailTitle'), t('openFailMsg')))
    return () => { alive = false }
  }, [sample?.uri])

  useEffect(() => { if (buf) setSlices(chop(buf, count, mode)) }, [count, mode])
  useEffect(() => () => stopRef.current?.(), [])

  const peaks = useMemo(() => (buf ? getPeaks(buf, 160) : []), [buf])

  const importAudio = async () => {
    try {
      const DocumentPicker = require('expo-document-picker')
      const res = await DocumentPicker.getDocumentAsync({ type: 'audio/*', copyToCacheDirectory: true, multiple: false })
      if (res.canceled || !res.assets?.length) return
      setBusy(true)
      const a = res.assets[0]
      await addSample(a.uri, a.name || 'Sample')
    } catch (e) {
      Alert.alert(t('importFailed'), e?.message || t('tryAnotherFile'))
    } finally {
      setBusy(false)
    }
  }

  const addSample = async (srcUri, name) => {
    const uri = await keepFile(srcUri, name)
    const b = await loadSource({ kind: 'uri', uri })
    const entry = { id: `s${Date.now().toString(36)}`, name: name.replace(/\.[^.]+$/, '').slice(0, 40), uri, duration: b?.duration || 0 }
    setProject((p) => ({ ...p, samples: [...(p.samples || []), entry] }))
    setSampleIdx((project.samples || []).length)
  }

  const stopVoice = async () => {
    clearInterval(recTimer.current)
    setRecAt(0)
    try {
      await recorder.stop()
      await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }).catch(() => {})
      const uri = recorder.uri
      if (!uri) throw new Error(t('nothingRecorded'))
      setBusy(true)
      const n = (project.samples || []).filter((x) => /^Voice/.test(x.name)).length + 1
      await addSample(uri, `Voice ${n}.m4a`)
    } catch (e) {
      Alert.alert(t('recordFailed'), e?.message || t('tryAgain'))
    } finally {
      setBusy(false)
    }
  }

  const recordVoice = async () => {
    if (recAt) { stopVoice(); return }
    try {
      const perm = await requestRecordingPermissionsAsync()
      if (!perm?.granted) { Alert.alert(t('micNeeded'), t('micNeededBody')); return }
      stopRef.current?.()
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true })
      await recorder.prepareToRecordAsync()
      recorder.record()
      const start = Date.now()
      setRecAt(start)
      setRecNow(start)
      recTimer.current = setInterval(() => {
        const now = Date.now()
        setRecNow(now)
        if (now - start >= MAX_REC_S * 1000) stopVoice()
      }, 200)
    } catch (e) {
      setRecAt(0)
      Alert.alert(t('recordFailed'), e?.message || t('tryAgain'))
    }
  }

  const audition = (k) => {
    if (!buf || !slices[k]) return
    stopRef.current?.()
    setSel(k)
    stopRef.current = playRegion(buf, slices[k].start, slices[k].end)
  }

  const assign = (startPad = 8, list = slices, quiet = false) => {
    if (!sample || !list.length) return
    tap()
    setProject((p) => {
      const pads = p.pads.map((pd, i) => {
        const k = i - startPad
        if (k < 0 || k >= 8 || !list[k]) return pd
        return { ...pd, label: `${sample.name.slice(0, 10)} ${k + 1}`, src: { kind: 'uri', uri: sample.uri, start: list[k].start, end: list[k].end }, color: PAD_COLORS[(k + 3) % PAD_COLORS.length], vol: 0.85, pitch: 0 }
      })
      return { ...p, pads }
    })
    if (!quiet) Alert.alert(t('chopsTitle'), t('chopsMsg'))
  }

  const autoSample = () => {
    if (!buf) return
    const s8 = chop(buf, 8, 'transients')
    setMode('transients')
    setCount(8)
    setSlices(s8)
    setTimeout(() => {
      assign(8, s8)
      setProject((p) => generateBeat(p, styleForKit(p.kit), { keepTempo: false }))
    }, 50)
  }

  // Jersey Club auto-sampler: 8 chops on the hits, Jersey Club kit, kick bounce + stutters.
  const jerseyFlip = () => {
    if (!buf) return
    const s8 = chop(buf, 8, 'transients')
    setMode('transients')
    setCount(8)
    setSlices(s8)
    setTimeout(() => {
      assign(8, s8, true)
      setProject((p) => generateBeat(p.kit === 'jersey' ? p : withKit(p, 'jersey'), 'jersey'))
    }, 50)
  }

  return (
    <View style={{ gap: 12 }}>
      <Panel style={{ gap: 10 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Text style={[sxType.title, { flex: 1 }]}>{t('sampler')}</Text>
          <HwButton label={busy ? t('opening') : t('importAudio')} icon={<Ionicons name="musical-notes-outline" size={14} color={SX.text} />} onPress={importAudio} disabled={busy || !!recAt} />
        </View>
        <Pressable onPress={recordVoice} disabled={busy} style={[st.voiceBtn, recAt ? st.voiceBtnOn : null]} accessibilityRole="button" accessibilityLabel={recAt ? t('stopRecording') : t('recordVoice')}>
          <View style={[st.voiceDot, recAt ? { borderRadius: 3, backgroundColor: '#fff' } : null]} />
          <Text style={st.voiceText}>{recAt ? `${t('stopRecording')} · ${Math.floor((recNow - recAt) / 1000)}s / ${MAX_REC_S}s` : t('recordVoice')}</Text>
          {!recAt ? <Ionicons name="mic" size={16} color={SX.rec} /> : null}
        </Pressable>
        <Text style={sxType.small}>{t('samplerIntro')}</Text>
        {project.samples?.length ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
            {project.samples.map((smp, k) => (
              <HwButton key={smp.id} label={smp.name} active={k === sampleIdx} color={SX.cool} onPress={() => setSampleIdx(k)} />
            ))}
          </ScrollView>
        ) : null}
      </Panel>

      {sample ? (
        <Panel style={{ gap: 12 }}>
          {buf ? (
            <Waveform peaks={peaks} duration={buf.duration} slices={slices} selected={sel} onTapTime={(tm) => { const k = slices.findIndex((sl) => tm >= sl.start && tm < sl.end); if (k >= 0) audition(k) }} />
          ) : (
            <View style={{ height: 120, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator color={SX.cool} /></View>
          )}
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Seg small style={{ flex: 1 }} options={[{ key: 4, label: '4' }, { key: 8, label: '8' }, { key: 16, label: '16' }]} value={count} onChange={setCount} />
            <Seg small style={{ flex: 1.4 }} options={[{ key: 'transients', label: t('hits') }, { key: 'even', label: t('even') }]} value={mode} onChange={setMode} />
          </View>
          <View style={st.sliceGrid}>
            {slices.map((sl, k) => (
              <Pressable key={k} onPressIn={() => audition(k)} style={[st.slice, sel === k && { borderColor: SX.accent, backgroundColor: withAlpha(SX.accent, 0.15) }]}>
                <Text style={st.sliceNum}>{k + 1}</Text>
                <Text style={sxType.small}>{(sl.end - sl.start).toFixed(2)}s</Text>
              </Pressable>
            ))}
          </View>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <HwButton label={t('chopsToPads')} style={{ flex: 1 }} onPress={() => assign(8)} />
            <HwButton label={t('autoSample')} active color={SX.hot} icon={<Ionicons name="sparkles" size={14} color={SX.hot} />} onPress={autoSample} />
          </View>
          <HwButton label={t('jerseyFlip')} active color={SX.cool} icon={<Ionicons name="flash" size={14} color={SX.cool} />} onPress={jerseyFlip} style={{ height: 44 }} />
          <Text style={sxType.small}>{t('jerseyInfo')}</Text>
        </Panel>
      ) : (
        <Panel style={{ alignItems: 'center', gap: 8, paddingVertical: 26 }}>
          <Ionicons name="pulse-outline" size={30} color={SX.muted} />
          <Text style={sxType.body}>{t('noSample')}</Text>
          <Text style={[sxType.small, { textAlign: 'center' }]}>{t('noSampleBody')}</Text>
        </Panel>
      )}
    </View>
  )
}

// ---- Mixer --------------------------------------------------------------------------------
function MixView({ project, onUpdatePad }) {
  return (
    <Panel style={{ gap: 4 }}>
      {project.pads.map((p, i) => (p.src ? (
        <View key={i} style={st.mixRow}>
          <View style={[st.dot, { backgroundColor: p.color }]} />
          <Text style={st.mixLabel} numberOfLines={1}>{p.label}</Text>
          <Fader value={p.vol ?? 0.85} onChange={(v) => onUpdatePad(i, { vol: v })} color={p.color} style={{ flex: 1 }} />
          <Pressable onPress={() => onUpdatePad(i, { mute: !p.mute })} style={[st.ms, p.mute && { backgroundColor: SX.rec, borderColor: SX.rec }]}><Text style={st.msText}>M</Text></Pressable>
          <Pressable onPress={() => onUpdatePad(i, { solo: !p.solo })} style={[st.ms, p.solo && { backgroundColor: SX.ok, borderColor: SX.ok }]}><Text style={[st.msText, p.solo && { color: SX.bg }]}>S</Text></Pressable>
        </View>
      ) : null))}
    </Panel>
  )
}

// ---- Sheets -------------------------------------------------------------------------------
function Sheet({ visible, onClose, title, children }) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={st.backdrop} onPress={onClose} />
      <View style={st.sheet}>
        <View style={st.grabber} />
        <Text style={[sxType.title, { marginBottom: 12 }]}>{title}</Text>
        {children}
      </View>
    </Modal>
  )
}

function AutoSheet({ visible, onClose, onPick }) {
  const t = useT(strings)
  return (
    <Sheet visible={visible} onClose={onClose} title={t('autoTitle')}>
      <Text style={[sxType.small, { marginBottom: 12 }]}>{t('autoBody')}</Text>
      <View style={st.styleGrid}>
        {STYLES.map((s) => (
          <Pressable key={s.id} onPress={() => onPick(s.id)} style={st.styleTile}>
            <Ionicons name="sparkles" size={16} color={SX.hot} />
            <Text style={sxType.title}>{s.name}</Text>
            <Text style={sxType.small}>{s.bpm[0]}–{s.bpm[1]} BPM{s.kit ? t('ownKit') : ''}</Text>
          </Pressable>
        ))}
      </View>
    </Sheet>
  )
}

function RenameSheet({ visible, name, onClose, onSave }) {
  const t = useT(strings)
  const [v, setV] = useState(name)
  useEffect(() => { if (visible) setV(name) }, [visible])
  return (
    <Sheet visible={visible} onClose={onClose} title={t('nameBeat')}>
      <TextInput value={v} onChangeText={setV} style={st.input} maxLength={60} autoFocus placeholder={t('untitledBeat')} placeholderTextColor={SX.faint} />
      <HwButton label={t('saveName')} active onPress={() => onSave(v.trim() || t('untitledBeat'))} style={{ marginTop: 12, height: 46 }} />
    </Sheet>
  )
}

function ExportSheet({ visible, project, onClose, onSaved, navigation }) {
  const t = useT(strings)
  const [title, setTitle] = useState(project.name)
  const [loops, setLoops] = useState(2)
  const [vis, setVis] = useState('private')
  const [busy, setBusy] = useState('')
  const [tags, setTags] = useState([])
  useEffect(() => { if (visible) { setTitle(project.name); setBusy(''); if (!tags.length && project.style) setTags([project.style]) } }, [visible])
  const bars = (project.steps / 16) * loops
  const secs = (bars * 16 * 60) / project.bpm / 4

  const doExport = async () => {
    try {
      setBusy(t('rendering'))
      await prepareProject(project)
      await new Promise((r) => setTimeout(r, 30))
      const out = renderProject(project, loops)
      const wav = encodeWav(out)
      setBusy(vis === 'public' ? t('uploadingChecking') : t('uploading'))
      const sound = await publishSound({ wav, title, visibility: vis, durationS: Math.round(out.duration * 10) / 10, bpm: project.bpm, kind: 'beat', projectId: project.id, tags })
      await onSaved?.()
      setBusy('')
      onClose()
      const status = sound?.status
      Alert.alert(
        status === 'blocked' ? t('keptPrivate') : t('exported'),
        status === 'blocked'
          ? t('exportBlocked')
          : status === 'public'
            ? t('exportPublic')
            : t('exportPrivate'),
        [{ text: t('ok') }, { text: t('mySounds'), onPress: () => navigation.navigate('MySounds') }],
      )
    } catch (e) {
      setBusy('')
      Alert.alert(t('exportFailed'), e?.message || t('tryAgain'))
    }
  }

  return (
    <Sheet visible={visible} onClose={busy ? () => {} : onClose} title={t('exportSound')}>
      <Text style={sxType.label}>{t('title')}</Text>
      <TextInput value={title} onChangeText={setTitle} style={st.input} maxLength={60} placeholderTextColor={SX.faint} />
      <Text style={[sxType.label, { marginTop: 14 }]}>{t('length')}</Text>
      <Seg small options={[{ key: 1, label: '1×' }, { key: 2, label: '2×' }, { key: 4, label: '4×' }]} value={loops} onChange={setLoops} />
      <Text style={[sxType.small, { marginTop: 6 }]}>{t(bars === 1 ? 'barsAboutOne' : 'barsAboutMany', { bars, s: Math.round(secs) })}</Text>
      <Text style={[sxType.label, { marginTop: 14 }]}>{t('whoCanUse')}</Text>
      <Seg small options={[{ key: 'private', label: t('onlyMe') }, { key: 'public', label: t('public') }]} value={vis} onChange={setVis} />
      <Text style={[sxType.small, { marginTop: 6 }]}>
        {vis === 'public' ? t('publicInfo') : t('privateInfo')}
      </Text>
      <Text style={[sxType.label, { marginTop: 14 }]}>{t('tags')}</Text>
      <TagPicker value={tags} onChange={setTags} colors={{ text: SX.text, muted: SX.muted, line: SX.lineStrong, panel: SX.panel2, accent: SX.accent || '#ff4fa3' }} />
      <HwButton label={busy || t('export')} active disabled={!!busy} onPress={doExport} style={{ marginTop: 16, height: 48 }} />
    </Sheet>
  )
}

const st = StyleSheet.create({
  voiceBtn: { flexDirection: 'row', alignItems: 'center', gap: 10, height: 44, borderRadius: 12, borderWidth: 1, borderColor: withAlpha(SX.rec, 0.45), backgroundColor: withAlpha(SX.rec, 0.08), paddingHorizontal: 14 },
  voiceBtnOn: { backgroundColor: SX.rec, borderColor: SX.rec },
  voiceDot: { width: 12, height: 12, borderRadius: 6, backgroundColor: SX.rec },
  voiceText: { flex: 1, fontFamily: FONT.ui, fontSize: 13, letterSpacing: 1, color: SX.text, textTransform: 'uppercase' },
  screen: { flex: 1, backgroundColor: SX.bg },
  wrap: { width: '100%', alignSelf: 'center', paddingHorizontal: 16 },
  content: { width: '100%', alignSelf: 'center', paddingHorizontal: 16, paddingTop: 12 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  iconBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  transport: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 10, gap: 6 },
  deck: { padding: 10, gap: 10 },
  lcd: { backgroundColor: '#0b0d08', borderRadius: 10, borderWidth: 1, borderColor: 'rgba(255,178,30,0.22)', paddingHorizontal: 12, paddingVertical: 10, gap: 6, shadowColor: SX.accent, shadowOpacity: 0.12, shadowRadius: 12 },
  lcdRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  lcdSmall: { fontFamily: FONT.ui, fontSize: 11, letterSpacing: 1.4, color: withAlpha(SX.accent, 0.75), flexShrink: 1 },
  lcdMain: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' },
  lcdBlock: { gap: 2 },
  lcdBtns: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  lcdBtn: { width: 26, height: 26, borderRadius: 6, borderWidth: 1, borderColor: 'rgba(255,178,30,0.3)', alignItems: 'center', justifyContent: 'center' },
  lcdBig: { fontFamily: FONT.display, fontSize: 40, lineHeight: 44, color: SX.accent, fontVariant: ['tabular-nums'], includeFontPadding: false, textShadowColor: 'rgba(255,178,30,0.55)', textShadowRadius: 10, minWidth: 74, textAlign: 'center' },
  lcdMid: { fontFamily: FONT.display, fontSize: 24, color: SX.accent, fontVariant: ['tabular-nums'], includeFontPadding: false, textShadowColor: 'rgba(255,178,30,0.45)', textShadowRadius: 8, minWidth: 52, textAlign: 'center' },
  lcdLabel: { fontFamily: FONT.ui, fontSize: 9, letterSpacing: 1.6, color: withAlpha(SX.accent, 0.5) },
  leds: { flexDirection: 'row', gap: 4, marginTop: 4 },
  led: { flex: 1, height: 5, borderRadius: 2, backgroundColor: 'rgba(255,178,30,0.12)' },
  ledBeat: { backgroundColor: 'rgba(255,178,30,0.26)' },
  ledOn: { backgroundColor: SX.accent, shadowColor: SX.accent, shadowOpacity: 1, shadowRadius: 6 },
  transportRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  play: { width: 54, height: 54, borderRadius: 27, backgroundColor: SX.panel2, borderWidth: 1, borderColor: SX.lineStrong, alignItems: 'center', justifyContent: 'center' },
  recBtn: { width: 34, height: 34, borderRadius: 17, borderWidth: 1, borderColor: SX.lineStrong, alignItems: 'center', justifyContent: 'center', backgroundColor: SX.panel2 },
  recDot: { width: 12, height: 12, borderRadius: 6, backgroundColor: 'rgba(255,61,82,0.5)' },
  miniBtn: { minHeight: 28, paddingHorizontal: 8 },
  kitRow: { gap: 8, paddingTop: 10 },
  padGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  pad: {
    borderRadius: 14, borderWidth: 1.5, backgroundColor: '#14171e', padding: 9, justifyContent: 'space-between',
    shadowColor: '#000', shadowOpacity: 0.5, shadowRadius: 6, shadowOffset: { width: 0, height: 3 }, elevation: 3,
  },
  padInset: { position: 'absolute', left: 5, right: 5, top: 5, bottom: 5, borderRadius: 10, borderWidth: 1, borderColor: 'rgba(255,255,255,0.04)' },
  padLed: { width: 18, height: 4, borderRadius: 2 },
  padLabel: { fontFamily: FONT.ui, fontSize: 12, letterSpacing: 0.6, color: SX.text, textTransform: 'uppercase' },
  padNum: { position: 'absolute', right: 8, top: 6, fontFamily: FONT.display, fontSize: 10, color: SX.faint },
  dot: { width: 8, height: 8, borderRadius: 4 },
  stepRow: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  stepLabel: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingRight: 4 },
  stepLabelText: { fontFamily: FONT.uiSemi, fontSize: 11, color: SX.muted, flexShrink: 1 },
  cell: { borderRadius: 4, borderWidth: 1, borderColor: 'transparent' },
  sliceGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  slice: { width: '23%', paddingVertical: 10, borderRadius: 10, borderWidth: 1, borderColor: SX.lineStrong, backgroundColor: SX.panel2, alignItems: 'center', gap: 2 },
  sliceNum: { fontFamily: FONT.display, fontSize: 16, color: SX.text },
  mixRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 4 },
  mixLabel: { width: 84, fontFamily: FONT.uiSemi, fontSize: 12, color: SX.text },
  ms: { width: 28, height: 28, borderRadius: 6, borderWidth: 1, borderColor: SX.lineStrong, alignItems: 'center', justifyContent: 'center' },
  msText: { fontFamily: FONT.ui, fontSize: 12, color: SX.text },
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.5)' },
  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: SX.panel, borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 20, paddingBottom: 36, borderWidth: 1, borderColor: SX.line, maxWidth: 720, alignSelf: 'center', width: '100%' },
  grabber: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: SX.lineStrong, marginBottom: 14 },
  styleGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  styleTile: { width: '48%', padding: 14, borderRadius: 14, backgroundColor: SX.panel2, borderWidth: 1, borderColor: SX.lineStrong, gap: 4 },
  input: { backgroundColor: SX.panel2, borderRadius: 10, borderWidth: 1, borderColor: SX.lineStrong, color: SX.text, paddingHorizontal: 12, paddingVertical: 11, fontFamily: FONT.uiSemi, fontSize: 16, marginTop: 6 },
})
