// Plays a post's video with its edits (trim loop, crop, captions) and its sound.
// Used by the feed, the viewer and the video editor preview. If the item didn't arrive with its
// edit/sound fields (older API responses), they're fetched once by media id (mediaMeta).
import { useEffect, useRef, useState } from 'react'
import { View, StyleSheet } from 'react-native'
import { VideoView, useVideoPlayer } from 'expo-video'
import { createAudioPlayer } from 'expo-audio'
import { CaptionLayer, aspectRatioOf, useCaptionFonts } from '../lib/videoEdit'
import { useMediaMeta } from '../lib/mediaMeta'
import { soundPlayable } from '../lib/sounds'

export default function EditedVideo({
  uri, mediaId, edit: editProp, sound: soundProp, active = true, muted = false, contentFit = 'cover', nativeControls = false, style, onDuration, onTime,
}) {
  useCaptionFonts()
  const meta = useMediaMeta(editProp === undefined ? mediaId : null)
  const edit = editProp !== undefined ? editProp : meta?.edit
  const sound = soundProp !== undefined ? soundProp : meta?.sound
  const trim = edit?.trim
  const soundOk = soundPlayable(sound)
  const origVol = edit?.originalVolume ?? (soundOk ? 0 : 1)
  const player = useVideoPlayer(uri, (p) => {
    p.loop = !trim
    p.muted = muted || origVol === 0
    p.volume = origVol
    p.timeUpdateEventInterval = 0.1
  })
  const audio = useRef(null)
  const [box, setBox] = useState({ w: 0, h: 0 })
  const editRef = useRef(edit)
  editRef.current = edit

  // keep player settings in sync with edits / mute
  useEffect(() => {
    try {
      player.loop = !trim
      player.muted = muted || origVol === 0
      player.volume = origVol
    } catch {}
  }, [player, trim?.start, trim?.end, muted, origVol])

  // the sound track
  useEffect(() => {
    if (!soundOk) return undefined
    let p = null
    try {
      p = createAudioPlayer({ uri: sound.audio_url })
      p.loop = true
      p.volume = edit?.soundVolume ?? 1
      audio.current = p
    } catch {}
    return () => {
      try { p?.pause(); p?.remove() } catch {}
      audio.current = null
    }
  }, [soundOk, sound?.audio_url])

  useEffect(() => {
    const a = audio.current
    if (!a) return
    try {
      a.volume = edit?.soundVolume ?? 1
      a.muted = !!muted
    } catch {}
  }, [edit?.soundVolume, muted, soundOk])

  // play / pause with the active state; start at the trim point
  useEffect(() => {
    try {
      if (active) {
        if (trim && (player.currentTime < trim.start || player.currentTime >= trim.end)) player.currentTime = trim.start
        player.play()
        if (audio.current) {
          audio.current.seekTo?.(editRef.current?.soundStart || 0)
          audio.current.play()
        }
      } else {
        player.pause()
        audio.current?.pause()
      }
    } catch {}
  }, [active, player, soundOk])

  // trim loop + duration reporting
  useEffect(() => {
    const subs = []
    subs.push(player.addListener('timeUpdate', ({ currentTime }) => {
      onTime?.(currentTime)
      const t = editRef.current?.trim
      if (t && currentTime >= t.end - 0.05) {
        try {
          player.currentTime = t.start
          if (audio.current) audio.current.seekTo?.(editRef.current?.soundStart || 0)
        } catch {}
      }
    }))
    subs.push(player.addListener('sourceLoad', ({ duration }) => { if (duration) onDuration?.(duration) }))
    subs.push(player.addListener('playToEnd', () => {
      // natural end without trim and no loop shouldn't happen; restart the sound with the loop
      if (audio.current) { try { audio.current.seekTo?.(editRef.current?.soundStart || 0) } catch {} }
    }))
    return () => subs.forEach((s) => { try { s.remove() } catch {} })
  }, [player])

  const crop = edit?.crop
  const ar = aspectRatioOf(crop?.aspect)
  const zoom = crop?.zoom || 1
  // pan range: at zoom z the frame can move (z-1)/2 of its size each way
  const tx = ((zoom - 1) / 2) * (crop?.x || 0) * box.w
  const ty = ((zoom - 1) / 2) * (crop?.y || 0) * box.h

  return (
    <View style={[styles.outer, style]}>
      <View
        style={[ar ? { aspectRatio: ar, maxWidth: '100%', maxHeight: '100%', width: ar >= 1 ? '100%' : undefined, height: ar < 1 ? '100%' : undefined } : StyleSheet.absoluteFill, styles.clip]}
        onLayout={(e) => setBox({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}
      >
        <VideoView
          player={player}
          style={[StyleSheet.absoluteFill, (zoom !== 1 || tx || ty) && { transform: [{ translateX: tx }, { translateY: ty }, { scale: zoom }] }]}
          contentFit={ar ? 'cover' : contentFit}
          nativeControls={nativeControls}
        />
        <CaptionLayer texts={edit?.texts} w={box.w} h={box.h} />
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  outer: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden', backgroundColor: '#000' },
  clip: { overflow: 'hidden' },
})
