// Lab sessions: make a song together. The host invites friends (or shares the J-code); friends
// open the same beat on their own phone, can video call, and record their part. Each take is
// recorded on the friend's phone over their own copy of the beat (so it lines up exactly, no
// network lag in the recording), uploaded, and lands on the host's song as that friend's lane.
//
// Rides the multiplayer Room (realtime channel): the host publishes the shareable beat as room
// state (sample/vocal files uploaded to profile-media/<uid>/lab/<code>/), friends receive it.
// Messages: lab:take_req (host -> friend), lab:take_state + lab:take (friend -> host).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Platform } from 'react-native'
import { openRoom, useRoomSnapshot } from '../lib/multiplayer'
import { useVideoCall } from '../components/VideoCall'
import { supabase } from '../lib/supabase'
import { encodeWav } from './wav'
import { getSong, newTrackId } from './song'
import { prepareProject } from './engine'

const BUCKET = 'profile-media'
const DEFAULT_TUNE = { on: false, key: 'auto', scale: 'major', style: 'hard' }
const TYPES = { wav: 'audio/wav', m4a: 'audio/mp4', mp4: 'audio/mp4', mp3: 'audio/mpeg', aac: 'audio/aac', caf: 'audio/x-caf', ogg: 'audio/ogg' }

async function readBytes(uri) {
  if (Platform.OS === 'web' || /^(blob:|https?:)/.test(uri)) return new Uint8Array(await (await fetch(uri)).arrayBuffer())
  const { File } = require('expo-file-system')
  return await new File(uri).bytes()
}

async function uploadBytes(path, bytes, contentType) {
  const { error } = await supabase.storage.from(BUCKET).upload(path, bytes, { contentType, upsert: true })
  if (error) throw error
  return supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl
}

const shortHash = (s) => {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return (h >>> 0).toString(36)
}

/**
 * useLabSession({ joinCode, project, setProject, onTakeRequested })
 * joinCode: open as a guest of that session (from an invite / typed code); otherwise you can
 * host one with start(). onTakeRequested(): the host asked you (guest) to record your part.
 */
export function useLabSession({ joinCode, project, setProject, onTakeRequested }) {
  const [room, setRoom] = useState(null)
  const [error, setError] = useState(null)
  const snap = useRoomSnapshot(room)
  const [takeStatus, setTakeStatus] = useState({}) // friendId -> asked | recording | uploading | failed
  const [callPeerId, setCallPeerId] = useState(null)
  const uploads = useRef(new Map()) // local uri -> public url
  const projRef = useRef(project)
  projRef.current = project
  const onReqRef = useRef(onTakeRequested)
  onReqRef.current = onTakeRequested
  const guest = !!joinCode
  const me = snap?.me || room?.me || null
  const isHost = !!snap?.isHost && !guest
  const roster = snap?.roster || []
  const hostId = snap?.hostId || null
  const host = roster.find((p) => p.id === hostId) || null
  const friends = roster.filter((p) => p.id !== me?.id)

  // ---- open / close
  useEffect(() => {
    if (!joinCode) return undefined
    let alive = true
    let r = null
    openRoom({ gameId: 'lab', code: joinCode, mode: 'join' })
      .then((x) => { r = x; if (alive) setRoom(x); else x.leave() })
      .catch((e) => alive && setError(e?.message || 'Could not join'))
    return () => { alive = false; r?.leave() }
  }, [joinCode])
  useEffect(() => () => { if (!joinCode) room?.leave() }, [room, joinCode])

  const start = useCallback(async () => {
    if (room) return room
    setError(null)
    const r = await openRoom({ gameId: 'lab', mode: 'host' })
    setRoom(r)
    return r
  }, [room])
  const leave = useCallback(() => { room?.leave(); setRoom(null); setTakeStatus({}); setCallPeerId(null) }, [room])

  // ---- host: share the beat (uploads local samples / vocals once, then publishes room state)
  const upload = useCallback(async (uri, code, uid) => {
    if (!uri || /^https?:/.test(uri)) return uri
    if (uploads.current.has(uri)) return uploads.current.get(uri)
    const ext = (uri.split('?')[0].split('.').pop() || 'wav').toLowerCase().slice(0, 5)
    const bytes = await readBytes(uri)
    const url = await uploadBytes(`${uid}/lab/${code}/${shortHash(uri)}.${ext}`, bytes, TYPES[ext] || 'application/octet-stream')
    uploads.current.set(uri, url)
    return url
  }, [])

  const publishing = useRef(false)
  const publishAgain = useRef(false)
  const publish = useCallback(async () => {
    if (!room || !isHost) return
    if (publishing.current) { publishAgain.current = true; return }
    publishing.current = true
    try {
      const p = projRef.current
      const uid = room.me.id
      const pads = []
      for (const pad of p.pads) {
        if (pad.src?.kind === 'uri') {
          try { pads.push({ ...pad, src: { ...pad.src, uri: await upload(pad.src.uri, room.code, uid) } }) } catch { pads.push({ ...pad, src: null }) }
        } else pads.push(pad)
      }
      const song = getSong(p)
      const vocals = []
      for (const v of song.vocals) {
        try {
          vocals.push({ ...v, uri: await upload(v.uri, room.code, uid), owner: v.owner === 'me' ? uid : v.owner, name: v.owner === 'me' ? `@${room.me.username}` : v.name })
        } catch {}
      }
      room.publishState({
        beat: { name: p.name, bpm: p.bpm, swing: p.swing || 0, steps: p.steps, kit: p.kit, pads, pattern: p.pattern, song: { ...song, vocals } },
        v: Date.now(),
      })
    } finally {
      publishing.current = false
      if (publishAgain.current) { publishAgain.current = false; publish() }
    }
  }, [room, isHost, upload])

  // republish (debounced) whenever the beat changes while hosting
  const beatSig = useMemo(() => {
    if (!project) return ''
    const s = getSong(project)
    return JSON.stringify([project.bpm, project.swing, project.steps, project.kit, project.pattern, project.pads.map((p) => [p.src?.uri || p.src?.pad, p.vol, p.pitch, p.mute]), s.bars, s.hits, s.beatMute, s.beatVol, s.vocals.map((v) => [v.uri, v.vol, v.mute, v.nudgeMs, v.base, v.tune, v.pan, v.fx, v.shift, v.trimIn, v.trimOut])])
  }, [project])
  useEffect(() => {
    if (!isHost || snap?.status !== 'connected') return undefined
    const tm = setTimeout(() => publish().catch(() => {}), 900)
    return () => clearTimeout(tm)
  }, [beatSig, isHost, snap?.status, friends.length, publish])

  // ---- guest: take the host's beat
  const beatV = snap?.state?.v
  useEffect(() => {
    if (!guest || !snap?.state?.beat) return
    const b = snap.state.beat
    const myId = me?.id
    const next = {
      id: `lab-${joinCode}`,
      name: b.name,
      kit: b.kit,
      bpm: b.bpm,
      swing: b.swing,
      steps: b.steps,
      metronome: false,
      pads: b.pads,
      pattern: b.pattern,
      samples: [],
      song: { ...b.song, vocals: (b.song?.vocals || []).map((v) => (v.owner === myId ? { ...v, owner: 'me' } : v)) },
      guestOf: joinCode,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    prepareProject(next).catch(() => {})
    setProject(next, { markDirty: false })
  }, [beatV, guest]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (guest && room && snap?.status === 'connected' && !snap?.state) room.requestState()
  }, [guest, room, snap?.status, !!snap?.state]) // eslint-disable-line react-hooks/exhaustive-deps

  // ---- takes
  useEffect(() => {
    if (!room) return undefined
    const offs = [
      room.onMessage('lab:take_req', (_, from) => { if (guest && from === room.hostId) onReqRef.current?.() }),
      room.onMessage('lab:take_state', (data, from) => { if (isHost) setTakeStatus((s) => ({ ...s, [from]: data?.state || null })) }),
      room.onMessage('lab:take', (data, from) => {
        if (!isHost || !data?.url) return
        const who = (room.roster || []).find((p) => p.id === from)
        setTakeStatus((s) => ({ ...s, [from]: null }))
        setProject((p) => {
          const s = getSong(p)
          const prev = s.vocals.find((v) => v.owner === from)
          const track = {
            id: prev?.id || newTrackId(), owner: from, name: `@${who?.username || 'friend'}`, uri: data.url,
            duration: data.duration || 0, base: data.base || 0, nudgeMs: data.nudgeMs || 0, vol: prev?.vol ?? 0.9, mute: false,
            tune: { ...DEFAULT_TUNE, ...(prev?.tune || {}), detected: null },
          }
          const vocals = prev ? s.vocals.map((v) => (v.owner === from ? track : v)) : [...s.vocals, track]
          return { ...p, song: { ...s, vocals } }
        })
      }),
      // a friend calling the host becomes the host's call peer
      room.onMessage('rtc', (data, from) => { if (data?.k === 'ring') setCallPeerId((cur) => cur || from) }),
    ]
    return () => offs.forEach((o) => o?.())
  }, [room, guest, isHost, setProject])

  const requestTake = useCallback((friendId) => {
    if (!room || !isHost) return
    setTakeStatus((s) => ({ ...s, [friendId]: 'asked' }))
    room.send('lab:take_req', {}, { to: friendId })
  }, [room, isHost])

  const reportTake = useCallback((state) => { if (room && hostId && !isHost) room.send('lab:take_state', { state }, { to: hostId }) }, [room, hostId, isHost])

  /** Guest: upload a finished take ({ data, sampleRate, base, nudgeMs }) and hand it to the host. */
  const sendTake = useCallback(async ({ data, sampleRate, base, nudgeMs }) => {
    if (!room || !hostId) return
    reportTake('uploading')
    try {
      const wav = encodeWav({ sampleRate, channels: [data] })
      const url = await uploadBytes(`${room.me.id}/lab/${room.code}/take-${Date.now().toString(36)}.wav`, new Uint8Array(wav), 'audio/wav')
      room.send('lab:take', { url, base, nudgeMs: nudgeMs || 0, duration: data.length / sampleRate }, { to: hostId })
    } catch (e) {
      reportTake('failed')
      throw e
    }
  }, [room, hostId, reportTake])

  // ---- video call (1:1: the host picks which friend; a friend always calls the host)
  const peerId = guest ? hostId : (callPeerId && friends.some((f) => f.id === callPeerId) ? callPeerId : friends[0]?.id || null)
  const peerP = roster.find((p) => p.id === peerId)
  const peer = useMemo(() => (peerP ? { id: peerP.id, name: peerP.username, avatar: peerP.avatar } : null), [peerP?.id, peerP?.username]) // eslint-disable-line react-hooks/exhaustive-deps
  const call = useVideoCall(room, peer, !!peerP)
  const callRef = useRef(call)
  callRef.current = call
  const callFriend = useCallback((id) => {
    if (callRef.current.status !== 'idle') { callRef.current.hangup(); return }
    setCallPeerId(id)
    // start once the hook has re-rendered with the new peer
    setTimeout(() => callRef.current.start(), 120)
  }, [])

  return {
    room, active: !!room, guest, isHost, code: room?.code || joinCode || null, status: snap?.status || (joinCode ? 'connecting' : 'idle'),
    error: error || snap?.error || null, me, host, friends, hostLeft: guest && snap?.status === 'connected' && !!snap?.state && !host,
    ready: !guest || !!snap?.state?.beat,
    start, leave, publish, requestTake, reportTake, sendTake, takeStatus,
    call, callFriend, callPeerId: peerId,
  }
}
