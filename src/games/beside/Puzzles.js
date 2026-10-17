// Short on-phone puzzles for Beside Them task stations, dressed as terminal modules
// (circuit panel, data blocks, keypad, matrix grid). The rules and onDone behaviour are
// unchanged; onProgress(0..1) and onError() are optional, display-only callbacks the task
// screen uses for its decrypt bar and ACCESS DENIED flash.
import React, { useEffect, useRef, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { buzz } from '../../lib/gamePrefs'
import { shuffled } from '../../lib/multiplayer'
import { Ionicons } from '@expo/vector-icons'
import { ST, stType, withAlpha } from '../studio'
import { MONO, termType } from './terminal'
import { useT } from '../../i18n'
import B from '../../i18n/strings/besideThem'
import { bt } from './text'

export const PUZZLES = {
  get wires() { return bt('pz_wires') },
  get memory() { return bt('pz_memory') },
  get lock() { return bt('pz_lock') },
  get tiles() { return bt('pz_tiles') },
  get pattern() { return bt('pz_pattern') },
}
export const PUZZLE_KINDS = Object.keys(PUZZLES)

/** Terminal module name per puzzle (display only). */
export const PUZZLE_MODULES = {
  get wires() { return bt('mod_wires') },
  get memory() { return bt('mod_memory') },
  get lock() { return bt('mod_lock') },
  get tiles() { return bt('mod_tiles') },
  get pattern() { return bt('mod_pattern') },
}

const noop = () => {}

export function Puzzle({ kind, onDone, onProgress, onError }) {
  const done = useRef(false)
  const finish = () => {
    if (done.current) return
    done.current = true
    buzz('success')
    onDone()
  }
  const progress = onProgress || noop
  const error = onError || noop
  switch (kind) {
    case 'wires': return <Wires onDone={finish} onProgress={progress} onError={error} />
    case 'memory': return <Memory onDone={finish} onProgress={progress} onError={error} />
    case 'lock': return <Lock onDone={finish} onProgress={progress} />
    case 'tiles': return <Tiles onDone={finish} onProgress={progress} />
    default: return <Pattern onDone={finish} onProgress={progress} onError={error} />
  }
}

const WIRE_COLORS = [ST.enemy, ST.objective, ST.health, ST.friendly]
const LIVE = ST.health

function Hint({ children }) {
  return (
    <Text style={[termType.mono, { marginBottom: 12 }]}>
      <Text style={{ color: ST.friendly }}>&gt; </Text>{children}
    </Text>
  )
}

function Wires({ onDone, onProgress, onError }) {
  const t = useT(B)
  const [right] = useState(() => shuffled([0, 1, 2, 3]))
  const [picked, setPicked] = useState(null)
  const [linked, setLinked] = useState([])
  useEffect(() => { onProgress(linked.length / 4) }, [linked.length]) // eslint-disable-line react-hooks/exhaustive-deps
  const tapRight = (c) => {
    if (picked == null) return
    if (c === picked) {
      buzz('select')
      const next = [...linked, c]
      setLinked(next)
      setPicked(null)
      if (next.length === 4) onDone()
    } else {
      buzz('error')
      onError()
      setPicked(null)
    }
  }
  return (
    <View>
      <Hint>{t('hint_wires')}</Hint>
      <View style={styles.wires}>
        <View style={styles.wireCol}>
          {[0, 1, 2, 3].map((c) => {
            const on = linked.includes(c)
            return (
              <Pressable key={c} onPress={() => !on && setPicked(c)} style={[styles.wireRow, picked === c && styles.wirePicked]} accessibilityRole="button" accessibilityLabel={t('left_wire', { n: c + 1 })}>
                <Text style={styles.pin}>A{c + 1}</Text>
                <View style={[styles.wire, { backgroundColor: WIRE_COLORS[c], opacity: on ? 0.35 : 1 }]} />
                <View style={[styles.node, { borderColor: WIRE_COLORS[c] }, on && { backgroundColor: LIVE, borderColor: LIVE }]} />
              </Pressable>
            )
          })}
        </View>
        <View style={styles.bus}>
          {[0, 1, 2, 3].map((i) => {
            const c = linked[i]
            return (
              <View key={i} style={styles.traceSlot}>
                <View style={[styles.trace, c != null && { backgroundColor: WIRE_COLORS[c], height: 3 }]} />
              </View>
            )
          })}
        </View>
        <View style={styles.wireCol}>
          {right.map((c, i) => {
            const on = linked.includes(c)
            return (
              <Pressable key={c} onPress={() => !on && tapRight(c)} style={styles.wireRow} accessibilityRole="button" accessibilityLabel={t('right_socket', { n: c + 1 })}>
                <View style={[styles.node, { borderColor: WIRE_COLORS[c] }, on && { backgroundColor: LIVE, borderColor: LIVE }]} />
                <View style={[styles.wire, { backgroundColor: WIRE_COLORS[c], opacity: on ? 0.35 : 1 }]} />
                <Text style={styles.pin}>B{i + 1}</Text>
              </Pressable>
            )
          })}
        </View>
      </View>
      <Text style={[termType.mono, { textAlign: 'center', marginTop: 12 }]}>{t('circuits_linked', { n: linked.length, total: 4 })}</Text>
    </View>
  )
}

const ADDR = ['0x0A', '0x1F', '0x2C', '0x3B', '0x4E', '0x5D', '0x6A', '0x7F', '0x8C']

function Memory({ onDone, onProgress, onError }) {
  const t = useT(B)
  const [seq, setSeq] = useState(() => Array.from({ length: 4 }, () => Math.floor(Math.random() * 9)))
  const [lit, setLit] = useState(null)
  const [showing, setShowing] = useState(true)
  const [pos, setPos] = useState(0)
  const timers = useRef([])
  useEffect(() => { onProgress(pos / seq.length) }, [pos, seq.length]) // eslint-disable-line react-hooks/exhaustive-deps
  const play = (s) => {
    timers.current.forEach(clearTimeout)
    timers.current = []
    setShowing(true)
    setPos(0)
    s.forEach((cell, i) => {
      timers.current.push(setTimeout(() => setLit(cell), 500 + i * 700))
      timers.current.push(setTimeout(() => setLit(null), 500 + i * 700 + 450))
    })
    timers.current.push(setTimeout(() => setShowing(false), 500 + s.length * 700))
  }
  useEffect(() => {
    play(seq)
    return () => timers.current.forEach(clearTimeout)
  }, [seq]) // eslint-disable-line react-hooks/exhaustive-deps
  const tap = (cell) => {
    if (showing) return
    if (cell === seq[pos]) {
      buzz('select')
      if (pos + 1 === seq.length) onDone()
      else setPos(pos + 1)
    } else {
      buzz('error')
      onError()
      setSeq(Array.from({ length: 4 }, () => Math.floor(Math.random() * 9)))
    }
  }
  return (
    <View>
      <Hint>{showing ? t('watch_lights') : t('repeat_it', { n: pos, total: seq.length })}</Hint>
      <View style={styles.grid}>
        {Array.from({ length: 9 }, (_, i) => (
          <Pressable key={i} onPress={() => tap(i)} style={[styles.cell, styles.block, lit === i && styles.blockLit]} accessibilityRole="button" accessibilityLabel={`Light ${i + 1}`}>
            <Text style={[styles.addr, lit === i && { color: ST.ink }]}>{ADDR[i]}</Text>
            <View style={styles.blockBars}>
              {[0, 1, 2].map((b) => <View key={b} style={[styles.blockBar, { width: 14 + ((i + b * 3) % 4) * 8 }, lit === i && { backgroundColor: withAlpha(ST.ink, 0.5) }]} />)}
            </View>
          </Pressable>
        ))}
      </View>
    </View>
  )
}

function Lock({ onDone, onProgress }) {
  const t = useT(B)
  const [code] = useState(() => Array.from({ length: 3 }, () => Math.floor(Math.random() * 10)))
  const [dials, setDials] = useState(() => code.map((c) => (c + 3 + Math.floor(Math.random() * 5)) % 10))
  useEffect(() => { onProgress(dials.filter((v, j) => v === code[j]).length / 3) }, [dials]) // eslint-disable-line react-hooks/exhaustive-deps
  const turn = (i, d) => {
    buzz('select')
    const next = dials.map((v, j) => (j === i ? (v + d + 10) % 10 : v))
    setDials(next)
    if (next.every((v, j) => v === code[j])) onDone()
  }
  return (
    <View>
      <Hint>{t('hint_lock', { code: code.join(' ') })}</Hint>
      <View style={styles.dials}>
        {dials.map((v, i) => {
          const ok = v === code[i]
          return (
            <View key={i} style={styles.dial}>
              <View style={[styles.led, { backgroundColor: ok ? ST.health : ST.objective, boxShadow: `0 0 8px ${ok ? ST.health : ST.objective}` }]} />
              <Pressable onPress={() => turn(i, 1)} style={({ pressed }) => [styles.key, pressed && styles.keyDown]} accessibilityRole="button" accessibilityLabel={`Dial ${i + 1} up`}><Ionicons name="chevron-up" size={24} color={ST.objective} /></Pressable>
              <View style={[styles.digitWin, ok && { borderColor: ST.health }]}>
                <Text style={[stType.num, { fontSize: 42, color: ok ? ST.health : ST.objective }]}>{v}</Text>
              </View>
              <Pressable onPress={() => turn(i, -1)} style={({ pressed }) => [styles.key, pressed && styles.keyDown]} accessibilityRole="button" accessibilityLabel={`Dial ${i + 1} down`}><Ionicons name="chevron-down" size={24} color={ST.objective} /></Pressable>
              <Text style={styles.pin}>CH{i + 1}</Text>
            </View>
          )
        })}
      </View>
    </View>
  )
}

const COORD = (i) => `${'ABC'[Math.floor(i / 3)]}${(i % 3) + 1}`

function Tiles({ onDone, onProgress }) {
  const t = useT(B)
  const [rot, setRot] = useState(() => {
    const r = Array.from({ length: 9 }, () => Math.floor(Math.random() * 4))
    if (r.every((x) => x === 0)) r[4] = 2
    return r
  })
  useEffect(() => { onProgress(rot.filter((x) => x === 0).length / 9) }, [rot]) // eslint-disable-line react-hooks/exhaustive-deps
  const tap = (i) => {
    buzz('select')
    const next = rot.map((v, j) => (j === i ? (v + 1) % 4 : v))
    setRot(next)
    if (next.every((x) => x === 0)) onDone()
  }
  return (
    <View>
      <Hint>{t('hint_tiles')}</Hint>
      <View style={styles.grid}>
        {rot.map((r, i) => (
          <Pressable key={i} onPress={() => tap(i)} style={[styles.cell, r === 0 && styles.cellOk]} accessibilityRole="button" accessibilityLabel={`Tile ${i + 1}`}>
            <Text style={styles.coord}>{COORD(i)}</Text>
            <Ionicons name="arrow-up" size={34} color={r === 0 ? ST.health : ST.friendly} style={{ transform: [{ rotate: `${r * 90}deg` }] }} />
          </Pressable>
        ))}
      </View>
    </View>
  )
}

function Pattern({ onDone, onProgress, onError }) {
  const t = useT(B)
  const [pattern, setPattern] = useState(() => shuffled([0, 1, 2, 3, 4, 5, 6, 7, 8]).slice(0, 5))
  const [pos, setPos] = useState(0)
  useEffect(() => { onProgress(pos / pattern.length) }, [pos, pattern.length]) // eslint-disable-line react-hooks/exhaustive-deps
  const tap = (i) => {
    if (i === pattern[pos]) {
      buzz('select')
      if (pos + 1 === pattern.length) onDone()
      else setPos(pos + 1)
    } else if (!pattern.slice(0, pos).includes(i)) {
      buzz('error')
      onError()
      setPattern(shuffled([0, 1, 2, 3, 4, 5, 6, 7, 8]).slice(0, 5))
      setPos(0)
    }
  }
  return (
    <View>
      <Hint>{t('hint_pattern')}</Hint>
      <View style={styles.grid}>
        {Array.from({ length: 9 }, (_, i) => {
          const order = pattern.indexOf(i)
          const doneDot = order >= 0 && order < pos
          return (
            <Pressable key={i} onPress={() => tap(i)} style={[styles.cell, styles.dotCell]} accessibilityRole="button" accessibilityLabel={`Dot ${i + 1}`}>
              <Text style={styles.coord}>{COORD(i)}</Text>
              <View style={styles.crossH} />
              <View style={styles.crossV} />
              <View style={[styles.dot, doneDot && { backgroundColor: ST.health, borderColor: ST.health }, order === pos && { backgroundColor: ST.friendly, borderColor: ST.friendly }]}>
                {order >= 0 && <Text style={[stType.num, { fontSize: 14, color: doneDot || order === pos ? ST.ink : ST.text }]}>{order + 1}</Text>}
              </View>
            </Pressable>
          )
        })}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  wires: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  wireCol: { gap: 12 },
  wireRow: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 40, paddingHorizontal: 4, borderWidth: 1, borderColor: 'transparent', borderRadius: ST.radius },
  wirePicked: { borderColor: ST.text, backgroundColor: 'rgba(255,255,255,0.08)' },
  wire: { width: 58, height: 14, borderRadius: 1 },
  node: { width: 14, height: 14, borderWidth: 2, backgroundColor: '#05080b' },
  pin: { fontFamily: MONO, fontSize: 10, color: ST.faint, width: 20, textAlign: 'center' },
  bus: { flex: 1, gap: 12, paddingHorizontal: 6 },
  traceSlot: { height: 40, justifyContent: 'center' },
  trace: { height: 1, backgroundColor: 'rgba(57,213,255,0.18)' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', width: 234, alignSelf: 'center', gap: 9 },
  cell: { width: 72, height: 72, borderRadius: ST.radius, borderWidth: 1, borderColor: 'rgba(57,213,255,0.28)', backgroundColor: 'rgba(57,213,255,0.05)', alignItems: 'center', justifyContent: 'center' },
  cellOk: { borderColor: ST.health, backgroundColor: 'rgba(92,242,160,0.08)' },
  coord: { position: 'absolute', top: 3, left: 4, fontFamily: MONO, fontSize: 8, color: ST.faint },
  block: { alignItems: 'flex-start', justifyContent: 'flex-end', padding: 7 },
  blockLit: { backgroundColor: ST.friendly, borderColor: ST.friendly, boxShadow: `0 0 14px ${ST.friendly}` },
  addr: { position: 'absolute', top: 5, left: 6, fontFamily: MONO, fontSize: 10, color: withAlpha(ST.friendly, 0.8) },
  blockBars: { gap: 3 },
  blockBar: { height: 3, backgroundColor: 'rgba(57,213,255,0.22)' },
  dials: { flexDirection: 'row', justifyContent: 'center', gap: 14 },
  dial: { alignItems: 'center', gap: 6, padding: 8, borderWidth: 1, borderColor: 'rgba(255,178,30,0.28)', backgroundColor: 'rgba(255,178,30,0.04)', borderRadius: ST.radius },
  led: { width: 8, height: 8, borderRadius: 4 },
  key: { width: 56, height: 36, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(255,178,30,0.45)', backgroundColor: 'rgba(255,178,30,0.08)', borderRadius: ST.radius },
  keyDown: { backgroundColor: 'rgba(255,178,30,0.25)' },
  digitWin: { width: 56, height: 60, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(255,178,30,0.35)', backgroundColor: '#05080b' },
  dotCell: { backgroundColor: 'transparent', borderColor: 'rgba(57,213,255,0.14)' },
  crossH: { position: 'absolute', left: 8, right: 8, top: 35.5, height: 1, backgroundColor: 'rgba(57,213,255,0.12)' },
  crossV: { position: 'absolute', top: 8, bottom: 8, left: 35.5, width: 1, backgroundColor: 'rgba(57,213,255,0.12)' },
  dot: { width: 34, height: 34, borderRadius: 17, backgroundColor: '#0d1a22', borderWidth: 1.5, borderColor: 'rgba(57,213,255,0.45)', alignItems: 'center', justifyContent: 'center' },
})
