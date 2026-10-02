// Short on-phone puzzles for Beside Them task stations.
import React, { useEffect, useRef, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { buzz } from '../../lib/gamePrefs'
import { shuffled } from '../../lib/multiplayer'
import { colors, radii, type } from '../../theme'

export const PUZZLES = {
  wires: 'Connect the wires',
  memory: 'Repeat the sequence',
  lock: 'Crack the lock',
  tiles: 'Align the tiles',
  pattern: 'Trace the pattern',
}
export const PUZZLE_KINDS = Object.keys(PUZZLES)

export function Puzzle({ kind, onDone }) {
  const done = useRef(false)
  const finish = () => {
    if (done.current) return
    done.current = true
    buzz('success')
    onDone()
  }
  switch (kind) {
    case 'wires': return <Wires onDone={finish} />
    case 'memory': return <Memory onDone={finish} />
    case 'lock': return <Lock onDone={finish} />
    case 'tiles': return <Tiles onDone={finish} />
    default: return <Pattern onDone={finish} />
  }
}

const WIRE_COLORS = [colors.danger, colors.gold, colors.success, colors.violet]

function Wires({ onDone }) {
  const [right] = useState(() => shuffled([0, 1, 2, 3]))
  const [picked, setPicked] = useState(null)
  const [linked, setLinked] = useState([])
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
      setPicked(null)
    }
  }
  return (
    <View>
      <Text style={[type.caption, { marginBottom: 10 }]}>Tap a wire on the left, then the matching color on the right.</Text>
      <View style={styles.wires}>
        <View style={styles.wireCol}>
          {[0, 1, 2, 3].map((c) => (
            <Pressable key={c} onPress={() => !linked.includes(c) && setPicked(c)} style={[styles.wire, { backgroundColor: WIRE_COLORS[c], opacity: linked.includes(c) ? 0.35 : 1 }, picked === c && styles.wirePicked]} accessibilityRole="button" accessibilityLabel={`Left wire ${c + 1}`} />
          ))}
        </View>
        <View style={styles.wireCol}>
          {right.map((c) => (
            <Pressable key={c} onPress={() => !linked.includes(c) && tapRight(c)} style={[styles.wire, { backgroundColor: WIRE_COLORS[c], opacity: linked.includes(c) ? 0.35 : 1 }]} accessibilityRole="button" accessibilityLabel={`Right socket ${c + 1}`} />
          ))}
        </View>
      </View>
      <Text style={[type.caption, { textAlign: 'center', marginTop: 8 }]}>{linked.length}/4 connected</Text>
    </View>
  )
}

function Memory({ onDone }) {
  const [seq, setSeq] = useState(() => Array.from({ length: 4 }, () => Math.floor(Math.random() * 9)))
  const [lit, setLit] = useState(null)
  const [showing, setShowing] = useState(true)
  const [pos, setPos] = useState(0)
  const timers = useRef([])
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
      setSeq(Array.from({ length: 4 }, () => Math.floor(Math.random() * 9)))
    }
  }
  return (
    <View>
      <Text style={[type.caption, { marginBottom: 10 }]}>{showing ? 'Watch the lights…' : `Repeat it: ${pos}/${seq.length}`}</Text>
      <View style={styles.grid}>
        {Array.from({ length: 9 }, (_, i) => (
          <Pressable key={i} onPress={() => tap(i)} style={[styles.cell, lit === i && { backgroundColor: colors.magenta }]} accessibilityRole="button" accessibilityLabel={`Light ${i + 1}`} />
        ))}
      </View>
    </View>
  )
}

function Lock({ onDone }) {
  const [code] = useState(() => Array.from({ length: 3 }, () => Math.floor(Math.random() * 10)))
  const [dials, setDials] = useState(() => code.map((c) => (c + 3 + Math.floor(Math.random() * 5)) % 10))
  const turn = (i, d) => {
    buzz('select')
    const next = dials.map((v, j) => (j === i ? (v + d + 10) % 10 : v))
    setDials(next)
    if (next.every((v, j) => v === code[j])) onDone()
  }
  return (
    <View>
      <Text style={[type.caption, { marginBottom: 10 }]}>The code on the sticky note is {code.join(' ')}. Turn the dials to match.</Text>
      <View style={styles.dials}>
        {dials.map((v, i) => (
          <View key={i} style={styles.dial}>
            <Pressable onPress={() => turn(i, 1)} style={styles.dialBtn} accessibilityRole="button" accessibilityLabel={`Dial ${i + 1} up`}><Text style={type.title}>▲</Text></Pressable>
            <Text style={[type.display, { color: v === code[i] ? colors.success : colors.text }]}>{v}</Text>
            <Pressable onPress={() => turn(i, -1)} style={styles.dialBtn} accessibilityRole="button" accessibilityLabel={`Dial ${i + 1} down`}><Text style={type.title}>▼</Text></Pressable>
          </View>
        ))}
      </View>
    </View>
  )
}

function Tiles({ onDone }) {
  const [rot, setRot] = useState(() => {
    const r = Array.from({ length: 9 }, () => Math.floor(Math.random() * 4))
    if (r.every((x) => x === 0)) r[4] = 2
    return r
  })
  const tap = (i) => {
    buzz('select')
    const next = rot.map((v, j) => (j === i ? (v + 1) % 4 : v))
    setRot(next)
    if (next.every((x) => x === 0)) onDone()
  }
  return (
    <View>
      <Text style={[type.caption, { marginBottom: 10 }]}>Tap tiles to rotate them until every arrow points up.</Text>
      <View style={styles.grid}>
        {rot.map((r, i) => (
          <Pressable key={i} onPress={() => tap(i)} style={[styles.cell, r === 0 && { borderColor: colors.success }]} accessibilityRole="button" accessibilityLabel={`Tile ${i + 1}`}>
            <Text style={[styles.arrow, { transform: [{ rotate: `${r * 90}deg` }], color: r === 0 ? colors.success : colors.text }]}>↑</Text>
          </Pressable>
        ))}
      </View>
    </View>
  )
}

function Pattern({ onDone }) {
  const [pattern, setPattern] = useState(() => shuffled([0, 1, 2, 3, 4, 5, 6, 7, 8]).slice(0, 5))
  const [pos, setPos] = useState(0)
  const tap = (i) => {
    if (i === pattern[pos]) {
      buzz('select')
      if (pos + 1 === pattern.length) onDone()
      else setPos(pos + 1)
    } else if (!pattern.slice(0, pos).includes(i)) {
      buzz('error')
      setPattern(shuffled([0, 1, 2, 3, 4, 5, 6, 7, 8]).slice(0, 5))
      setPos(0)
    }
  }
  return (
    <View>
      <Text style={[type.caption, { marginBottom: 10 }]}>Trace the pattern: tap the dots in number order.</Text>
      <View style={styles.grid}>
        {Array.from({ length: 9 }, (_, i) => {
          const order = pattern.indexOf(i)
          const doneDot = order >= 0 && order < pos
          return (
            <Pressable key={i} onPress={() => tap(i)} style={[styles.cell, styles.dotCell]} accessibilityRole="button" accessibilityLabel={`Dot ${i + 1}`}>
              <View style={[styles.dot, doneDot && { backgroundColor: colors.success }, order === pos && { backgroundColor: colors.magenta }]}>
                {order >= 0 && <Text style={[type.caption, { color: colors.onBrand }]}>{order + 1}</Text>}
              </View>
            </Pressable>
          )
        })}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  wires: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 10 },
  wireCol: { gap: 14 },
  wire: { width: 90, height: 26, borderRadius: radii.sm },
  wirePicked: { borderWidth: 3, borderColor: colors.text },
  grid: { flexDirection: 'row', flexWrap: 'wrap', width: 234, alignSelf: 'center', gap: 9 },
  cell: { width: 72, height: 72, borderRadius: radii.sm, borderWidth: 1.5, borderColor: colors.hairline, backgroundColor: colors.glassFill, alignItems: 'center', justifyContent: 'center' },
  arrow: { fontSize: 34, fontWeight: '800' },
  dials: { flexDirection: 'row', justifyContent: 'center', gap: 20 },
  dial: { alignItems: 'center', gap: 4 },
  dialBtn: { padding: 8 },
  dotCell: { backgroundColor: 'transparent', borderWidth: 0 },
  dot: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.violet, alignItems: 'center', justifyContent: 'center' },
})
