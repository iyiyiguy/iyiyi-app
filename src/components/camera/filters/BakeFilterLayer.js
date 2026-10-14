import React, { useEffect, useRef } from 'react'
import { StyleSheet, View } from 'react-native'
import { OVERLAY_BOX } from '../../../lib/cameraFilters'
import { LensArt } from './LensArt'
import { placeLens } from './lenses'

// Still version of the AR filter, drawn over a captured photo inside the hidden "bake" view so
// react-native-view-shot stamps it into the saved / posted image. `heads` are already in the
// bake view's pixels, each optionally with its own `name` (matched iYiYi user). Calls onReady once every overlay has drawn (or after a short timeout).
// `filter` is the lens id (lenses.js); `myHandle` + `platforms` put your linked platforms on the
// Follow me card when it's on you.
export default function BakeFilterLayer({ filter, heads, name, onReady, myHandle, platforms }) {
  const list = Array.isArray(heads) ? heads.filter((h) => h && Number.isFinite(h.cx) && Number.isFinite(h.top)) : []
  const pending = useRef(list.length)
  const fired = useRef(false)
  const fire = () => {
    if (fired.current) return
    fired.current = true
    try { onReady?.() } catch {}
  }
  const one = () => {
    pending.current -= 1
    if (pending.current <= 0) fire()
  }
  useEffect(() => {
    if (!list.length) fire()
    const t = setTimeout(fire, 1200)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {list.map((h, i) => {
        const { s, anchorY, anchorX } = placeLens(filter, h, 6) // same placement as live
        const roll = Number(h?.pose?.roll)
        const rollDeg = Number.isFinite(roll) ? (-roll * 180) / Math.PI : 0
        return (
          <View
            // eslint-disable-next-line react/no-array-index-key
            key={i}
            style={[
              styles.slot,
              {
                transform: [
                  { translateX: anchorX - OVERLAY_BOX / 2 },
                  { translateY: anchorY - OVERLAY_BOX },
                  { rotate: `${rollDeg}deg` },
                  { scale: s },
                ],
              },
            ]}
          >
            <LensArt
              lens={filter}
              name={h.name || name || '@iyiyi'}
              platforms={myHandle && (h.name || name) === myHandle ? platforms : null}
              pose={h.pose}
              live={false}
              onReady={one}
            />
          </View>
        )
      })}
    </View>
  )
}

const styles = StyleSheet.create({
  // Scale and roll pivot on the bottom-center (the point above the head), as in the live layer.
  slot: { position: 'absolute', left: 0, top: 0, width: OVERLAY_BOX, height: OVERLAY_BOX, transformOrigin: '50% 100%' },
})
