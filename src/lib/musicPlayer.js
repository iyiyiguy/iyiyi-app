// App-wide music player: one queue (a playlist, your songs, someone's sounds), keeps playing
// while you move around the app. Plays through the phone's current audio output (speaker,
// Bluetooth, AirPlay, headphones). UI: <MiniPlayer /> (src/components/MiniPlayer.js).
import { useSyncExternalStore } from 'react'
import { createAudioPlayer, setAudioModeAsync } from 'expo-audio'
import { recordPlay, soundPlayable } from './sounds'

let state = { queue: [], index: -1, playing: false, position: 0, duration: 0, repeat: false }
const listeners = new Set()
let player = null
let sub = null

const emit = (patch) => {
  state = { ...state, ...patch }
  listeners.forEach((l) => l())
}

function release() {
  try { sub?.remove?.() } catch {}
  sub = null
  try { player?.pause(); player?.remove() } catch {}
  player = null
}

function load(index) {
  release()
  const track = state.queue[index]
  if (!track) { emit({ index: -1, playing: false, position: 0, duration: 0 }); return }
  setAudioModeAsync({ playsInSilentMode: true, shouldPlayInBackground: false }).catch(() => {})
  try {
    const p = createAudioPlayer({ uri: track.audio_url }, { updateInterval: 500 })
    player = p
    sub = p.addListener?.('playbackStatusUpdate', (s) => {
      if (!s) return
      if (s.didJustFinish) { next(true); return }
      emit({ position: s.currentTime || 0, duration: s.duration || track.duration_s || 0, playing: !!s.playing })
    })
    p.play()
    recordPlay(track.id)
    emit({ index, playing: true, position: 0, duration: track.duration_s || 0 })
  } catch (e) {
    console.warn('Music player failed', e)
    emit({ index, playing: false })
  }
}

/** Plays `tracks` starting at `start` (sound rows from lib/sounds). */
export function playQueue(tracks, start = 0) {
  const queue = (tracks || []).filter(soundPlayable)
  const first = Math.max(0, queue.findIndex((t) => t.id === tracks?.[start]?.id))
  emit({ queue })
  load(queue.length ? first : -1)
}

export function toggle() {
  if (!player) { if (state.queue.length) load(Math.max(0, state.index)); return }
  try {
    if (state.playing) { player.pause(); emit({ playing: false }) } else { player.play(); emit({ playing: true }) }
  } catch {}
}

export function next(auto = false) {
  if (!state.queue.length) return
  let i = state.index + 1
  if (i >= state.queue.length) {
    if (auto && !state.repeat) { release(); emit({ playing: false, position: 0 }); return }
    i = 0
  }
  load(i)
}

export function prev() {
  if (!state.queue.length) return
  if (state.position > 3 && player) { try { player.seekTo(0) } catch {}; return }
  load(state.index <= 0 ? state.queue.length - 1 : state.index - 1)
}

export function seek(seconds) {
  try { player?.seekTo(Math.max(0, seconds)); emit({ position: seconds }) } catch {}
}

export function setRepeat(on) { emit({ repeat: !!on }) }

export function stopMusic() {
  release()
  emit({ queue: [], index: -1, playing: false, position: 0, duration: 0 })
}

/** Pauses the music (e.g. when the camera or Studio needs the speaker). */
export function pauseMusic() {
  if (player && state.playing) { try { player.pause() } catch {}; emit({ playing: false }) }
}

const subscribe = (l) => { listeners.add(l); return () => listeners.delete(l) }
const snapshot = () => state

export function useMusic() {
  const s = useSyncExternalStore(subscribe, snapshot, snapshot)
  return { ...s, current: s.queue[s.index] || null }
}
