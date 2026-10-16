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

const TABS = [
  { key: 'pads', label: 'Pads' },
  { key: 'steps', label: 'Steps' },
  { key: 'sampler', label: 'Sampler' },
  { key: 'mix', label: 'Mix' },
]
const tap = () => { if (Platform.OS !== 'web') Haptics.selectionAsync().catch(() => {}) }

export default function StudioScreen({ navigation, route }) {
  useStudioFonts()
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
    if (!quiet) Alert.alert('Saved', `"${saved.name}" is in your Studio beats.`)
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
    Alert.alert('Clear the pattern?', 'All steps on every pad will be removed.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Clear', style: 'destructive', onPress: () => setProject((prev) => ({ ...prev, pattern: prev.pattern.map((r) => r.map(() => 0)) })) },
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
        <Text style={[sxType.small, { marginTop: 10 }]}>Loading Studio…</Text>
      </View>
    )
  }

  const maxW = Math.min(width, 720)
  return (
    <View style={st.screen}>
      <View style={[st.wrap, { paddingTop: insets.top + 6, maxWidth: maxW }]}>
        {/* header */}
        <View style={st.header}>
          <Pressable onPress={() => { stopRef.current?.(); if (dirty) save(true).catch(() => {}); navigation.goBack() }} hitSlop={10} style={st.iconBtn} accessibilityLabel="Back">
            <Ionicons name="chevron-back" size={22} color={SX.text} />
          </Pressable>
          <Pressable onPress={() => setRenameOpen(true)} style={{ flex: 1 }} accessibilityLabel="Rename beat">
            <Text style={sxType.label}>Studio{dirty ? ' · unsaved' : ''}</Text>
            <Text style={sxType.title} numberOfLines={1}>{project.name}</Text>
          </Pressable>
          <HwButton icon={<Ionicons name="save-outline" size={16} color={SX.text} />} onPress={() => save()} accessibilityLabel="Save beat" style={{ paddingHorizontal: 10 }} />
          <HwButton label="Export" active color={SX.accent} onPress={() => { stopRef.current?.(); stopRef.current = null; setPlaying(false); setExportOpen(true) }} icon={<Ionicons name="share-outline" size={15} color={SX.accent} />} />
        </View>

        {/* transport */}
        <Panel style={st.transport}>
          <Pressable onPress={togglePlay} style={[st.play, playing && { backgroundColor: SX.accent }]} accessibilityLabel={playing ? 'Stop' : 'Play'}>
            <Ionicons name={playing ? 'stop' : 'play'} size={26} color={playing ? SX.bg : SX.text} style={!playing && { marginLeft: 3 }} />
          </Pressable>
          <Pressable onPress={() => { tap(); setRec((r) => !r) }} style={[st.recBtn, rec && { backgroundColor: withAlpha(SX.rec, 0.2), borderColor: SX.rec }]} accessibilityLabel="Record pads into the pattern">
            <View style={[st.recDot, rec && { backgroundColor: SX.rec }]} />
          </Pressable>
          <Stepper label="BPM" value={project.bpm} min={60} max={190} onChange={(bpm) => setProject((p) => ({ ...p, bpm }))} onPressValue={tapTempo} />
          <Stepper label="Swing" value={Math.round((project.swing || 0) * 100)} min={0} max={60} step={5} format={(v) => `${v}%`} onChange={(v) => setProject((p) => ({ ...p, swing: v / 100 }))} />
          <View style={{ gap: 6 }}>
            <HwButton label={`${project.steps}`} onPress={() => { tap(); setProject((p) => setSteps(p, p.steps === 16 ? 32 : 16)); setBar(0) }} accessibilityLabel="Pattern length" style={st.miniBtn} />
            <HwButton icon={<Ionicons name="pulse" size={14} color={project.metronome ? SX.cool : SX.muted} />} active={project.metronome} color={SX.cool} onPress={() => setProject((p) => ({ ...p, metronome: !p.metronome }))} accessibilityLabel="Metronome" style={st.miniBtn} />
          </View>
        </Panel>

        {/* kit + auto */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={st.kitRow}>
          <HwButton label="Auto" active color={SX.hot} icon={<Ionicons name="sparkles" size={14} color={SX.hot} />} onPress={() => setAutoOpen(true)} />
          {KITS.map((k) => (
            <HwButton key={k.id} label={k.name} active={project.kit === k.id} onPress={() => changeKit(k.id)} />
          ))}
          <HwButton icon={<Ionicons name="trash-outline" size={14} color={SX.muted} />} onPress={clearPattern} accessibilityLabel="Clear pattern" />
        </ScrollView>

        <Seg options={TABS} value={tab} onChange={(t) => { tap(); setTab(t) }} style={{ marginTop: 10 }} />
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
  const pad = project.pads[selPad]
  const { width } = useWindowDimensions()
  const padW = Math.floor((Math.min(width, 720) - 32 - 24) / 4)
  return (
    <View style={{ gap: 12 }}>
      {rec ? <Text style={[sxType.small, { color: playing ? SX.rec : SX.muted, textAlign: 'center' }]}>{playing ? 'Recording: pads you tap go into the pattern' : 'Press play to record pads into the pattern'}</Text> : null}
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
            <Text style={[sxType.small, { marginLeft: 'auto' }]}>Pad {selPad + 1}</Text>
          </View>
          <View>
            <Text style={sxType.label}>Volume</Text>
            <Fader value={pad.vol ?? 0.85} onChange={(v) => onUpdatePad(selPad, { vol: v })} color={pad.color} />
          </View>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Stepper label="Pitch" value={pad.pitch || 0} min={-12} max={12} format={(v) => (v > 0 ? `+${v}` : `${v}`)} onChange={(v) => onUpdatePad(selPad, { pitch: v })} />
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
                <Stepper label="Chop start" step={0.01} value={st0} min={0} max={Math.max(0, en0 - 0.03)} format={(v) => `${v.toFixed(2)}s`} onChange={(v) => setRegion({ start: Math.round(v * 1000) / 1000 })} />
                <Stepper label="Chop end" step={0.01} value={en0} min={st0 + 0.03} max={len} format={(v) => `${v.toFixed(2)}s`} onChange={(v) => setRegion({ end: Math.round(v * 1000) / 1000 })} />
              </View>
            )
          })() : null}
        </Panel>
      ) : null}
    </View>
  )
}

function Pad({ pad, index, size, selected, flashAt, onPress }) {
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
      style={[st.pad, { width: size, height: size, borderColor: selected ? c : SX.line }, lit && { backgroundColor: withAlpha(c, 0.55) }, !lit && !empty && { backgroundColor: withAlpha(c, 0.12) }]}
      accessibilityRole="button"
      accessibilityLabel={empty ? `Empty pad ${index + 1}` : pad.label}
    >
      <View style={[st.padLed, { backgroundColor: lit ? '#fff' : c, opacity: empty ? 0.4 : 1 }]} />
      <Text style={[st.padLabel, empty && { color: SX.faint }]} numberOfLines={2}>{empty ? '+ Sample' : pad.label}</Text>
      <Text style={st.padNum}>{index + 1}</Text>
    </Pressable>
  )
}

// ---- Steps --------------------------------------------------------------------------------
function StepsView({ project, playStep, bar, setBar, onToggle, selPad, setSelPad }) {
  const { width } = useWindowDimensions()
  const bars = project.steps / 16
  const offset = bar * 16
  const labelW = 74
  const cellW = Math.max(16, Math.floor((Math.min(width, 720) - 32 - labelW - 15 * 3) / 16))
  return (
    <View style={{ gap: 10 }}>
      {bars > 1 ? (
        <Seg small options={Array.from({ length: bars }, (_, b) => ({ key: b, label: `Bar ${b + 1}` }))} value={bar} onChange={setBar} />
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
                    accessibilityLabel={`${pad.label} step ${s + 1}${v ? ' on' : ''}`}
                  />
                )
              })}
            </View>
          )
        })}
      </Panel>
      <Text style={[sxType.small, { textAlign: 'center' }]}>Tap a step to place a hit · hold for an accent</Text>
    </View>
  )
}

// ---- Sampler ------------------------------------------------------------------------------
function SamplerView({ project, setProject, selPad }) {
  const [busy, setBusy] = useState(false)
  const [sampleIdx, setSampleIdx] = useState(0)
  const [buf, setBuf] = useState(null)
  const [count, setCount] = useState(8)
  const [mode, setMode] = useState('transients')
  const [slices, setSlices] = useState([])
  const [sel, setSel] = useState(-1)
  const stopRef = useRef(null)
  const sample = project.samples?.[sampleIdx]

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
      .catch(() => Alert.alert('Couldn’t open that audio', 'Try a different file (mp3, m4a, wav).'))
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
      const uri = await keepFile(a.uri, a.name)
      const b = await loadSource({ kind: 'uri', uri })
      const entry = { id: `s${Date.now().toString(36)}`, name: (a.name || 'Sample').replace(/\.[^.]+$/, '').slice(0, 40), uri, duration: b?.duration || 0 }
      setProject((p) => ({ ...p, samples: [...(p.samples || []), entry] }))
      setSampleIdx((project.samples || []).length)
    } catch (e) {
      Alert.alert('Import failed', e?.message || 'Try another file.')
    } finally {
      setBusy(false)
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
    if (!quiet) Alert.alert('Chops on pads 9–16', 'Play them on the Pads tab, sequence them, or press Auto for a beat around them.')
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
          <Text style={[sxType.title, { flex: 1 }]}>Sampler</Text>
          <HwButton label={busy ? 'Opening…' : 'Import audio'} icon={<Ionicons name="musical-notes-outline" size={14} color={SX.text} />} onPress={importAudio} disabled={busy} />
        </View>
        <Text style={sxType.small}>Bring in a song, a voice memo or any sound. Use audio you made or have the rights to; public exports are checked for copyrighted music.</Text>
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
            <Waveform peaks={peaks} duration={buf.duration} slices={slices} selected={sel} onTapTime={(t) => { const k = slices.findIndex((sl) => t >= sl.start && t < sl.end); if (k >= 0) audition(k) }} />
          ) : (
            <View style={{ height: 120, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator color={SX.cool} /></View>
          )}
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Seg small style={{ flex: 1 }} options={[{ key: 4, label: '4' }, { key: 8, label: '8' }, { key: 16, label: '16' }]} value={count} onChange={setCount} />
            <Seg small style={{ flex: 1.4 }} options={[{ key: 'transients', label: 'Hits' }, { key: 'even', label: 'Even' }]} value={mode} onChange={setMode} />
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
            <HwButton label="Chops → Pads 9-16" style={{ flex: 1 }} onPress={() => assign(8)} />
            <HwButton label="Auto-sample" active color={SX.hot} icon={<Ionicons name="sparkles" size={14} color={SX.hot} />} onPress={autoSample} />
          </View>
          <HwButton label="Jersey Club flip" active color={SX.cool} icon={<Ionicons name="flash" size={14} color={SX.cool} />} onPress={jerseyFlip} style={{ height: 44 }} />
          <Text style={sxType.small}>Jersey Club flip chops your sample, loads the Jersey Club kit and writes the kick bounce with stuttered chops at 140 BPM. Press again for a new variation.</Text>
        </Panel>
      ) : (
        <Panel style={{ alignItems: 'center', gap: 8, paddingVertical: 26 }}>
          <Ionicons name="pulse-outline" size={30} color={SX.muted} />
          <Text style={sxType.body}>No sample yet</Text>
          <Text style={[sxType.small, { textAlign: 'center' }]}>Import audio, then chop it into pads automatically or press Auto-sample for an instant beat.</Text>
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
  return (
    <Sheet visible={visible} onClose={onClose} title="Auto: make me a beat">
      <Text style={[sxType.small, { marginBottom: 12 }]}>Pick a style. Every press writes a new variation for the current kit (and your sampler chops); ATL, Church Keys and Jersey Club load their own kit. It replaces the current pattern.</Text>
      <View style={st.styleGrid}>
        {STYLES.map((s) => (
          <Pressable key={s.id} onPress={() => onPick(s.id)} style={st.styleTile}>
            <Ionicons name="sparkles" size={16} color={SX.hot} />
            <Text style={sxType.title}>{s.name}</Text>
            <Text style={sxType.small}>{s.bpm[0]}–{s.bpm[1]} BPM{s.kit ? ' · own kit' : ''}</Text>
          </Pressable>
        ))}
      </View>
    </Sheet>
  )
}

function RenameSheet({ visible, name, onClose, onSave }) {
  const [v, setV] = useState(name)
  useEffect(() => { if (visible) setV(name) }, [visible])
  return (
    <Sheet visible={visible} onClose={onClose} title="Name your beat">
      <TextInput value={v} onChangeText={setV} style={st.input} maxLength={60} autoFocus placeholder="Untitled beat" placeholderTextColor={SX.faint} />
      <HwButton label="Save name" active onPress={() => onSave(v.trim() || 'Untitled beat')} style={{ marginTop: 12, height: 46 }} />
    </Sheet>
  )
}

function ExportSheet({ visible, project, onClose, onSaved, navigation }) {
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
      setBusy('Rendering…')
      await prepareProject(project)
      await new Promise((r) => setTimeout(r, 30))
      const out = renderProject(project, loops)
      const wav = encodeWav(out)
      setBusy(vis === 'public' ? 'Uploading & checking for copyright…' : 'Uploading…')
      const sound = await publishSound({ wav, title, visibility: vis, durationS: Math.round(out.duration * 10) / 10, bpm: project.bpm, kind: 'beat', projectId: project.id, tags })
      await onSaved?.()
      setBusy('')
      onClose()
      const status = sound?.status
      Alert.alert(
        status === 'blocked' ? 'Kept private' : 'Exported',
        status === 'blocked'
          ? 'It matched a copyrighted song, so it stays private. You can still use it in your own drafts.'
          : status === 'public'
            ? 'Your sound is public: anyone can add it to their videos. Find it on your profile under Sounds.'
            : 'Saved to your sounds (private). Make it public anytime from your profile.',
        [{ text: 'OK' }, { text: 'My sounds', onPress: () => navigation.navigate('MySounds') }],
      )
    } catch (e) {
      setBusy('')
      Alert.alert('Export failed', e?.message || 'Please try again.')
    }
  }

  return (
    <Sheet visible={visible} onClose={busy ? () => {} : onClose} title="Export sound">
      <Text style={sxType.label}>Title</Text>
      <TextInput value={title} onChangeText={setTitle} style={st.input} maxLength={60} placeholderTextColor={SX.faint} />
      <Text style={[sxType.label, { marginTop: 14 }]}>Length</Text>
      <Seg small options={[{ key: 1, label: '1×' }, { key: 2, label: '2×' }, { key: 4, label: '4×' }]} value={loops} onChange={setLoops} />
      <Text style={[sxType.small, { marginTop: 6 }]}>{bars} bar{bars === 1 ? '' : 's'} · about {Math.round(secs)} s</Text>
      <Text style={[sxType.label, { marginTop: 14 }]}>Who can use it</Text>
      <Seg small options={[{ key: 'private', label: 'Only me' }, { key: 'public', label: 'Public' }]} value={vis} onChange={setVis} />
      <Text style={[sxType.small, { marginTop: 6 }]}>
        {vis === 'public' ? 'Public sounds show on your profile and anyone can add them to videos. We check them for copyrighted music first.' : 'Private sounds are only for you: use them on your own videos or keep them for later.'}
      </Text>
      <Text style={[sxType.label, { marginTop: 14 }]}>Tags</Text>
      <TagPicker value={tags} onChange={setTags} colors={{ text: SX.text, muted: SX.muted, line: SX.lineStrong, panel: SX.panel2, accent: SX.accent || '#ff4fa3' }} />
      <HwButton label={busy || 'Export'} active disabled={!!busy} onPress={doExport} style={{ marginTop: 16, height: 48 }} />
    </Sheet>
  )
}

const st = StyleSheet.create({
  screen: { flex: 1, backgroundColor: SX.bg },
  wrap: { width: '100%', alignSelf: 'center', paddingHorizontal: 16 },
  content: { width: '100%', alignSelf: 'center', paddingHorizontal: 16, paddingTop: 12 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  iconBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  transport: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 10, gap: 6 },
  play: { width: 54, height: 54, borderRadius: 27, backgroundColor: SX.panel2, borderWidth: 1, borderColor: SX.lineStrong, alignItems: 'center', justifyContent: 'center' },
  recBtn: { width: 34, height: 34, borderRadius: 17, borderWidth: 1, borderColor: SX.lineStrong, alignItems: 'center', justifyContent: 'center', backgroundColor: SX.panel2 },
  recDot: { width: 12, height: 12, borderRadius: 6, backgroundColor: 'rgba(255,61,82,0.5)' },
  miniBtn: { minHeight: 28, paddingHorizontal: 8 },
  kitRow: { gap: 8, paddingTop: 10 },
  padGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  pad: {
    borderRadius: 14, borderWidth: 1.5, backgroundColor: SX.panel, padding: 8, justifyContent: 'space-between',
  },
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
