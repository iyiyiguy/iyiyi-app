// One-at-a-time sound preview (sound picker, Studio "My sounds", profile Sounds tab).
import { useCallback, useEffect, useRef, useState } from 'react'
import { createAudioPlayer, setAudioModeAsync } from 'expo-audio'

export function useSoundPreview() {
  const player = useRef(null)
  const sub = useRef(null)
  const [playingId, setPlayingId] = useState(null)

  const stop = useCallback(() => {
    try { sub.current?.remove?.() } catch {}
    sub.current = null
    try { player.current?.pause(); player.current?.remove() } catch {}
    player.current = null
    setPlayingId(null)
  }, [])

  const play = useCallback((sound) => {
    stop()
    if (!sound?.audio_url) return
    setAudioModeAsync({ playsInSilentMode: true }).catch(() => {})
    try {
      const p = createAudioPlayer({ uri: sound.audio_url })
      player.current = p
      sub.current = p.addListener?.('playbackStatusUpdate', (s) => { if (s?.didJustFinish) stop() })
      p.play()
      setPlayingId(sound.id)
    } catch (e) {
      console.warn('Sound preview failed', e)
      stop()
    }
  }, [stop])

  const toggle = useCallback((sound) => {
    if (playingId && playingId === sound?.id) stop()
    else play(sound)
  }, [playingId, play, stop])

  useEffect(() => stop, [stop])
  return { playingId, play, stop, toggle }
}
