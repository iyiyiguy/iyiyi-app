// 1:1 video call for online games, using WebRTC inside a WebView (react-native-webview).
//
// Signalling rides on the game room's realtime channel: room.send('rtc', data, { to }) and
// room.onMessage('rtc'). Flow: caller sends 'ring' (repeated until answered, 30 s timeout),
// the other phone shows Accept / Decline; on accept both mount the WebView, which grabs the
// camera + mic (getUserMedia) and reports 'ready'; the callee tells the caller it is ready,
// the caller's page creates the offer, and offer / answer / ICE candidates are relayed
// WebView -> postMessage -> room -> injectJavaScript -> other WebView.
//
// Only public STUN servers are used (no TURN relay is available), so two phones behind
// strict / symmetric NATs (some carrier networks, corporate Wi-Fi) may fail to connect;
// that case is detected and reported as "couldn't connect video".
//
// The WebView is mounted only while a call is connecting or live.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Alert, Animated, AppState, Linking, Modal, PanResponder, Pressable, StyleSheet, Text, View } from 'react-native'
import { WebView } from 'react-native-webview'
import { Ionicons } from '@expo/vector-icons'
import { LinearGradient } from 'expo-linear-gradient'
import { AC } from '../games/arcadeUI'
import { Avatar } from '../games/MultiplayerUI'
import { font } from '../theme'

const RING_TIMEOUT_MS = 30000
const RING_REPEAT_MS = 2500
const CONNECT_TIMEOUT_MS = 30000
const PEER_GONE_MS = 8000
const DISCONNECT_GRACE_MS = 10000

const newId = () => `${Date.now().toString(36)}${Math.floor(Math.random() * 1e9).toString(36)}`

function callHtml(role) {
  return `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<style>
html,body{margin:0;padding:0;height:100%;background:#070914;overflow:hidden;-webkit-user-select:none;user-select:none}
#remote{position:absolute;left:0;top:0;width:100%;height:100%;object-fit:cover;background:#0a0e24}
#local{position:absolute;right:6px;bottom:6px;width:30%;height:30%;object-fit:cover;border-radius:8px;border:1px solid rgba(255,255,255,.45);background:#1a1e33;transform:scaleX(-1)}
#local.back{transform:none}
#local.off{opacity:.15}
#msg{position:absolute;left:8px;right:8px;top:42%;text-align:center;color:#a3abc8;font:600 12px -apple-system,system-ui,sans-serif}
</style></head><body>
<video id="remote" autoplay playsinline></video>
<video id="local" autoplay playsinline muted></video>
<div id="msg">Starting camera…</div>
<script>
(function(){
  var ROLE=${JSON.stringify(role)};
  var ICE=[{urls:['stun:stun.l.google.com:19302','stun:stun1.l.google.com:19302']}];
  var pc=null, stream=null, facing='user', pendingIce=[], remoteSet=false, offered=false, closed=false;
  var remoteEl=document.getElementById('remote'), localEl=document.getElementById('local'), msgEl=document.getElementById('msg');
  function post(o){try{window.ReactNativeWebView.postMessage(JSON.stringify(o))}catch(e){}}
  function say(t){msgEl.textContent=t||'';msgEl.style.display=t?'block':'none'}
  function err(e,where){post({t:'error',where:where,name:(e&&e.name)||'Error',message:String((e&&e.message)||e)})}
  function makePc(){
    pc=new RTCPeerConnection({iceServers:ICE});
    stream.getTracks().forEach(function(tr){pc.addTrack(tr,stream)});
    pc.onicecandidate=function(ev){if(ev.candidate){post({t:'sig',sig:{ice:ev.candidate.toJSON?ev.candidate.toJSON():{candidate:ev.candidate.candidate,sdpMid:ev.candidate.sdpMid,sdpMLineIndex:ev.candidate.sdpMLineIndex}}})}};
    pc.ontrack=function(ev){
      var s=(ev.streams&&ev.streams[0])||null;
      if(!s){s=remoteEl.srcObject||new MediaStream();s.addTrack(ev.track)}
      remoteEl.srcObject=s; var p=remoteEl.play(); if(p&&p.catch)p.catch(function(){});
      say('');
    };
    var report=function(){var st=pc.connectionState||pc.iceConnectionState;post({t:'state',s:st});if(st==='connected'||st==='completed')say('')};
    pc.onconnectionstatechange=report; pc.oniceconnectionstatechange=report;
  }
  function flushIce(){var l=pendingIce;pendingIce=[];l.forEach(function(c){pc.addIceCandidate(c).catch(function(){})})}
  async function start(){
    try{
      stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true},video:{facingMode:'user',width:{ideal:480},height:{ideal:640}}});
    }catch(e){err(e,'media');say('Camera unavailable');return}
    if(closed){stream.getTracks().forEach(function(t){t.stop()});return}
    localEl.srcObject=stream; var lp=localEl.play(); if(lp&&lp.catch)lp.catch(function(){});
    try{makePc()}catch(e){err(e,'pc');return}
    say('Connecting…');
    post({t:'ready'});
  }
  async function offer(){
    if(!pc||offered)return; offered=true;
    try{var o=await pc.createOffer();await pc.setLocalDescription(o);post({t:'sig',sig:{sdp:{type:pc.localDescription.type,sdp:pc.localDescription.sdp}}})}catch(e){err(e,'offer')}
  }
  async function onSignal(sig){
    if(!pc||!sig)return;
    try{
      if(sig.sdp){
        await pc.setRemoteDescription(sig.sdp); remoteSet=true; flushIce();
        if(sig.sdp.type==='offer'){var a=await pc.createAnswer();await pc.setLocalDescription(a);post({t:'sig',sig:{sdp:{type:pc.localDescription.type,sdp:pc.localDescription.sdp}}})}
      }else if(sig.ice){
        if(remoteSet)pc.addIceCandidate(sig.ice).catch(function(){}); else pendingIce.push(sig.ice);
      }
    }catch(e){err(e,'signal')}
  }
  async function flip(){
    if(!stream)return;
    var next=facing==='user'?'environment':'user';
    try{
      var s=await navigator.mediaDevices.getUserMedia({video:{facingMode:next,width:{ideal:480},height:{ideal:640}}});
      var nt=s.getVideoTracks()[0]; var old=stream.getVideoTracks()[0];
      if(old){nt.enabled=old.enabled;stream.removeTrack(old);old.stop()}
      stream.addTrack(nt);
      if(pc){var snd=pc.getSenders().find(function(x){return x.track&&x.track.kind==='video'})||pc.getSenders().find(function(x){return !x.track});if(snd)await snd.replaceTrack(nt)}
      facing=next; localEl.className=next==='user'?'':'back';
      localEl.srcObject=stream;
    }catch(e){post({t:'log',m:'flip failed '+(e&&e.message)})}
  }
  function stop(){
    closed=true;
    try{if(pc)pc.close()}catch(e){}
    try{if(stream)stream.getTracks().forEach(function(t){t.stop()})}catch(e){}
  }
  window.__rn=function(m){
    try{
      if(!m)return;
      if(m.t==='offer')offer();
      else if(m.t==='sig')onSignal(m.sig);
      else if(m.t==='mute'){if(stream)stream.getAudioTracks().forEach(function(t){t.enabled=!m.on})}
      else if(m.t==='cam'){if(stream)stream.getVideoTracks().forEach(function(t){t.enabled=!m.off});localEl.className=(m.off?'off ':'')+(facing==='user'?'':'back')}
      else if(m.t==='flip')flip();
      else if(m.t==='stop')stop();
    }catch(e){err(e,'cmd')}
  };
  window.addEventListener('pagehide',stop);
  if(!navigator.mediaDevices||!navigator.mediaDevices.getUserMedia||!window.RTCPeerConnection){err({name:'NotSupportedError',message:'WebRTC unavailable'},'init');say('Video not supported');return}
  start();
})();
</script></body></html>`
}

/**
 * Call state machine for one peer. Returns a controller for <VideoCallLayer />.
 * room: multiplayer Room; peer: { id, name, avatar } | null; peerPresent: boolean.
 */
export function useVideoCall(room, peer, peerPresent) {
  const [status, setStatus] = useState('idle') // idle | outgoing | incoming | connecting | live
  const [notice, setNotice] = useState(null)
  const [role, setRole] = useState(null) // caller | callee
  const [callId, setCallId] = useState(null)
  const [muted, setMuted] = useState(false)
  const [camOff, setCamOff] = useState(false)
  const st = useRef({ status: 'idle', callId: null, role: null, webReady: false, peerReady: false, offered: false, queue: [] })
  const webRef = useRef(null)
  const timers = useRef({})
  const peerId = peer?.id || null
  const peerRef = useRef(peer)
  peerRef.current = peer

  const clearTimer = (k) => { if (timers.current[k]) { clearTimeout(timers.current[k]); clearInterval(timers.current[k]); delete timers.current[k] } }
  const clearAll = () => { for (const k of Object.keys(timers.current)) clearTimer(k) }

  const send = useCallback((data) => {
    if (!room || !peerId) return
    try { room.send('rtc', data, { to: peerId }) } catch { /* ignore */ }
  }, [room, peerId])

  const inject = useCallback((msg) => {
    try { webRef.current?.injectJavaScript(`window.__rn&&window.__rn(${JSON.stringify(msg)});true;`) } catch { /* ignore */ }
  }, [])

  const set = useCallback((patch) => {
    Object.assign(st.current, patch)
    if ('status' in patch) setStatus(patch.status)
    if ('role' in patch) setRole(patch.role)
    if ('callId' in patch) setCallId(patch.callId)
  }, [])

  const showNotice = useCallback((text) => {
    setNotice(text)
    clearTimer('notice')
    if (text) timers.current.notice = setTimeout(() => setNotice(null), 4000)
  }, [])

  const ended = useRef([])
  const reset = useCallback((note) => {
    if (st.current.callId) ended.current = [...ended.current.slice(-19), st.current.callId]
    if (st.current.status === 'connecting' || st.current.status === 'live') inject({ t: 'stop' })
    clearTimer('ring'); clearTimer('ringRepeat'); clearTimer('incoming'); clearTimer('connect'); clearTimer('disc'); clearTimer('peerGone')
    set({ status: 'idle', callId: null, role: null, webReady: false, peerReady: false, offered: false, queue: [] })
    setMuted(false)
    setCamOff(false)
    if (note) showNotice(note)
  }, [inject, set, showNotice])

  const beginMedia = useCallback((asRole, id) => {
    clearTimer('ring'); clearTimer('ringRepeat'); clearTimer('incoming')
    set({ status: 'connecting', role: asRole, callId: id, webReady: false, peerReady: false, offered: false, queue: [] })
    clearTimer('connect')
    timers.current.connect = setTimeout(() => {
      if (st.current.status !== 'connecting') return
      send({ k: 'hangup', id })
      reset('Couldn’t connect video. Your networks may block direct calls — try Wi-Fi.')
    }, CONNECT_TIMEOUT_MS)
  }, [set, send, reset])

  const maybeOffer = useCallback(() => {
    const s = st.current
    if (s.role === 'caller' && s.webReady && s.peerReady && !s.offered) {
      s.offered = true
      inject({ t: 'offer' })
    }
  }, [inject])

  // ---- actions ----
  const start = useCallback(() => {
    if (!room || !peerId || st.current.status !== 'idle') return
    if (!peerPresent) { showNotice(`${peerRef.current?.name || 'Your opponent'} isn’t connected right now.`); return }
    const id = newId()
    set({ status: 'outgoing', callId: id, role: 'caller' })
    const ring = () => send({ k: 'ring', id })
    ring()
    timers.current.ringRepeat = setInterval(ring, RING_REPEAT_MS)
    timers.current.ring = setTimeout(() => {
      if (st.current.status !== 'outgoing') return
      send({ k: 'cancel', id })
      reset('No answer.')
    }, RING_TIMEOUT_MS)
  }, [room, peerId, peerPresent, send, set, reset, showNotice])

  const accept = useCallback(() => {
    const s = st.current
    if (s.status !== 'incoming' || !s.callId) return
    send({ k: 'accept', id: s.callId })
    beginMedia('callee', s.callId)
  }, [send, beginMedia])

  const decline = useCallback(() => {
    const s = st.current
    if (s.status !== 'incoming') return
    send({ k: 'decline', id: s.callId })
    reset(null)
  }, [send, reset])

  const hangup = useCallback(() => {
    const s = st.current
    if (s.status === 'idle') return
    send({ k: s.status === 'outgoing' ? 'cancel' : 'hangup', id: s.callId })
    reset(s.status === 'outgoing' ? null : 'Call ended.')
  }, [send, reset])

  const toggleMute = useCallback(() => setMuted((m) => { inject({ t: 'mute', on: !m }); return !m }), [inject])
  const toggleCam = useCallback(() => setCamOff((c) => { inject({ t: 'cam', off: !c }); return !c }), [inject])
  const flip = useCallback(() => inject({ t: 'flip' }), [inject])

  // ---- signalling from the peer ----
  useEffect(() => {
    if (!room || !peerId) return undefined
    const off = room.onMessage('rtc', (data, from) => {
      try {
        if (!data || from !== peerId) return
        const s = st.current
        const sameCall = data.id && data.id === s.callId
        switch (data.k) {
          case 'ring':
            if (ended.current.includes(data.id)) return // late repeat of a finished call
            if (s.status === 'idle') {
              set({ status: 'incoming', callId: data.id, role: 'callee' })
              clearTimer('incoming')
              timers.current.incoming = setTimeout(() => { if (st.current.status === 'incoming') reset('Missed video call.') }, RING_TIMEOUT_MS + 5000)
            } else if (s.status === 'outgoing' && !sameCall) {
              // Both called at once: the larger id gives way and answers the other call.
              const myId = room.me?.id || ''
              if (myId > from) { send({ k: 'accept', id: data.id }); beginMedia('callee', data.id) }
            } else if (!sameCall && (s.status === 'connecting' || s.status === 'live')) {
              // They restarted the call (e.g. reconnected): switch to the new one.
              inject({ t: 'stop' })
              set({ status: 'incoming', callId: data.id, role: 'callee', webReady: false })
            }
            return
          case 'cancel':
            if (sameCall && s.status === 'incoming') reset('Missed video call.')
            return
          case 'accept':
            if (sameCall && s.status === 'outgoing') beginMedia('caller', s.callId)
            return
          case 'decline':
            if (sameCall && s.status === 'outgoing') reset(`${peerRef.current?.name || 'Opponent'} declined the call.`)
            return
          case 'busy':
            if (sameCall && s.status === 'outgoing') reset(`${peerRef.current?.name || 'Opponent'} is busy.`)
            return
          case 'ready':
            if (sameCall && s.role === 'caller') { s.peerReady = true; maybeOffer() }
            return
          case 'sig':
            if (!sameCall || !(s.status === 'connecting' || s.status === 'live')) return
            if (s.webReady) inject({ t: 'sig', sig: data.sig })
            else if (s.queue.length < 200) s.queue.push(data.sig)
            return
          case 'hangup':
            if (sameCall && s.status !== 'idle') reset(data.reason === 'failed' ? `${peerRef.current?.name || 'Opponent'} couldn’t start their camera.` : 'Call ended.')
            return
          default:
        }
      } catch (e) {
        console.warn('video call signal failed', e?.message ?? e)
      }
    })
    return () => { try { off?.() } catch { /* ignore */ } }
  }, [room, peerId, set, reset, send, beginMedia, maybeOffer, inject])

  // ---- messages from the WebView ----
  const onWebMessage = useCallback((e) => {
    let m = null
    try { m = JSON.parse(e?.nativeEvent?.data || 'null') } catch { return }
    if (!m) return
    const s = st.current
    if (s.status !== 'connecting' && s.status !== 'live') return
    switch (m.t) {
      case 'ready': {
        s.webReady = true
        const q = s.queue
        s.queue = []
        for (const sig of q) inject({ t: 'sig', sig })
        if (s.role === 'callee') send({ k: 'ready', id: s.callId })
        maybeOffer()
        return
      }
      case 'sig':
        send({ k: 'sig', id: s.callId, sig: m.sig })
        return
      case 'state':
        if (m.s === 'connected' || m.s === 'completed') {
          clearTimer('connect'); clearTimer('disc')
          if (s.status !== 'live') set({ status: 'live' })
        } else if (m.s === 'failed') {
          send({ k: 'hangup', id: s.callId })
          reset('Couldn’t connect video. Your networks may block direct calls — try Wi-Fi.')
        } else if (m.s === 'disconnected' && s.status === 'live') {
          clearTimer('disc')
          timers.current.disc = setTimeout(() => {
            if (st.current.status === 'live') { send({ k: 'hangup', id: st.current.callId }); reset('Video connection lost.') }
          }, DISCONNECT_GRACE_MS)
        }
        return
      case 'error':
        if (m.where === 'media' || m.where === 'init') {
          send({ k: 'hangup', id: s.callId, reason: 'failed' })
          reset(null)
          const denied = m.name === 'NotAllowedError' || m.name === 'SecurityError'
          Alert.alert(
            denied ? 'Camera access needed' : 'Video unavailable',
            denied
              ? 'Allow camera and microphone access for iYiYi in Settings to video call.'
              : 'Your camera or microphone couldn’t be started.',
            denied
              ? [{ text: 'Not now', style: 'cancel' }, { text: 'Open Settings', onPress: () => { Linking.openSettings().catch(() => {}) } }]
              : [{ text: 'OK' }],
          )
        } else {
          console.warn('video call', m.where, m.message)
        }
        return
      default:
    }
  }, [inject, send, set, reset, maybeOffer])

  // Peer left the room for a while: end the call.
  useEffect(() => {
    if (status === 'idle') { clearTimer('peerGone'); return undefined }
    if (peerPresent) { clearTimer('peerGone'); return undefined }
    if (!timers.current.peerGone) {
      timers.current.peerGone = setTimeout(() => {
        delete timers.current.peerGone
        if (st.current.status !== 'idle') reset(`${peerRef.current?.name || 'Opponent'} left the call.`)
      }, PEER_GONE_MS)
    }
    return undefined
  }, [peerPresent, status, reset])

  // Backgrounding stops the camera on iOS anyway: hang up cleanly.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'background' && st.current.status !== 'idle') {
        const s = st.current
        send({ k: s.status === 'outgoing' ? 'cancel' : s.status === 'incoming' ? 'decline' : 'hangup', id: s.callId })
        reset(null)
      }
    })
    return () => sub?.remove?.()
  }, [send, reset])

  // Unmount: tell the peer and clear timers.
  const sendRef = useRef(send)
  sendRef.current = send
  useEffect(() => () => {
    const s = st.current
    if (s.status !== 'idle') {
      try { sendRef.current({ k: s.status === 'outgoing' ? 'cancel' : s.status === 'incoming' ? 'decline' : 'hangup', id: s.callId }) } catch { /* ignore */ }
    }
    clearAll()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return {
    status, notice, role, callId, muted, camOff, peer,
    start, accept, decline, hangup, toggleMute, toggleCam, flip,
    webRef, onWebMessage,
    active: status === 'connecting' || status === 'live',
  }
}

/**
 * Overlay for a call: ring prompt, "calling…" pill, notices, and the draggable picture-in-
 * picture video panel. bounds: { width, height } of the area the panel may be dragged in.
 */
export function VideoCallLayer({ call, bounds }) {
  if (!call) return null
  const peerName = call.peer?.name || 'Opponent'
  return (
    <>
      {call.active && call.role && call.callId ? <VideoPanel key={call.callId} call={call} bounds={bounds} /> : null}

      {call.status === 'outgoing' && (
        <View style={styles.pillWrap} pointerEvents="box-none">
          <View style={styles.pill}>
            <Ionicons name="videocam" size={15} color={AC.live} />
            <Text style={styles.pillText} numberOfLines={1}>Calling {peerName}…</Text>
            <Pressable onPress={call.hangup} hitSlop={8} style={styles.pillEnd} accessibilityRole="button" accessibilityLabel="Cancel call">
              <Ionicons name="close" size={14} color="#fff" />
            </Pressable>
          </View>
        </View>
      )}

      {call.notice && call.status === 'idle' ? (
        <View style={styles.pillWrap} pointerEvents="none">
          <View style={styles.pill}><Text style={styles.pillText} numberOfLines={2}>{call.notice}</Text></View>
        </View>
      ) : null}

      <Modal visible={call.status === 'incoming'} transparent animationType="fade" onRequestClose={call.decline}>
        <View style={styles.ringOverlay}>
          <View style={styles.ringCard}>
            <View style={styles.ringAvatar}><Avatar uri={call.peer?.avatar} name={peerName} size={76} /></View>
            <Text style={styles.ringName} numberOfLines={1}>{peerName}</Text>
            <Text style={styles.ringSub}>wants to video call</Text>
            <View style={styles.ringRow}>
              <Pressable onPress={call.decline} style={({ pressed }) => [styles.ringBtn, { backgroundColor: AC.danger }, pressed && styles.pressed]} accessibilityRole="button" accessibilityLabel="Decline call">
                <Ionicons name="call" size={26} color="#fff" style={{ transform: [{ rotate: '135deg' }] }} />
              </Pressable>
              <Pressable onPress={call.accept} style={({ pressed }) => [styles.ringBtn, { backgroundColor: AC.live }, pressed && styles.pressed]} accessibilityRole="button" accessibilityLabel="Accept call">
                <Ionicons name="videocam" size={26} color="#fff" />
              </Pressable>
            </View>
            <View style={styles.ringLabels}>
              <Text style={styles.ringLabel}>Decline</Text>
              <Text style={styles.ringLabel}>Accept</Text>
            </View>
          </View>
        </View>
      </Modal>
    </>
  )
}

const SMALL = { w: 128, h: 172 }
const LARGE = { w: 200, h: 268 }
const BAR_H = 40

function VideoPanel({ call, bounds }) {
  const html = useMemo(() => callHtml(call.role === 'caller' ? 'caller' : 'callee'), [call.role])
  const [large, setLarge] = useState(false)
  const size = large ? LARGE : SMALL
  const W = Math.max(200, bounds?.width || 360)
  const H = Math.max(300, bounds?.height || 600)
  const pos = useRef(new Animated.ValueXY({ x: W - SMALL.w - 12, y: 12 })).current
  const last = useRef({ x: W - SMALL.w - 12, y: 12 })
  const dims = useRef({ W, H, size })
  dims.current = { W, H, size }

  const clamp = (x, y) => {
    const d = dims.current
    return {
      x: Math.min(Math.max(6, x), Math.max(6, d.W - d.size.w - 6)),
      y: Math.min(Math.max(6, y), Math.max(6, d.H - d.size.h - BAR_H - 6)),
    }
  }

  const responder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => false,
    onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) + Math.abs(g.dy) > 6,
    onMoveShouldSetPanResponderCapture: (_, g) => Math.abs(g.dx) + Math.abs(g.dy) > 10,
    onPanResponderMove: (_, g) => { pos.setValue({ x: last.current.x + g.dx, y: last.current.y + g.dy }) },
    onPanResponderRelease: (_, g) => {
      const p = clamp(last.current.x + g.dx, last.current.y + g.dy)
      last.current = p
      Animated.spring(pos, { toValue: p, useNativeDriver: false, friction: 7 }).start()
    },
    onPanResponderTerminate: () => {
      Animated.spring(pos, { toValue: last.current, useNativeDriver: false }).start()
    },
  }), []) // eslint-disable-line react-hooks/exhaustive-deps

  // Keep the panel on screen after a resize / size toggle.
  useEffect(() => {
    const p = clamp(last.current.x, last.current.y)
    last.current = p
    pos.setValue(p)
  }, [W, H, large]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Animated.View style={[styles.panel, { width: size.w, transform: pos.getTranslateTransform() }]} {...responder.panHandlers}>
      <Pressable onPress={() => setLarge((v) => !v)} style={styles.grip} accessibilityRole="button" accessibilityLabel={large ? 'Shrink video' : 'Enlarge video'}>
        <View style={styles.gripBar} />
        {call.status !== 'live' ? <Text style={styles.gripText}>Connecting…</Text> : null}
      </Pressable>
      <View style={{ width: size.w, height: size.h, backgroundColor: '#070914' }}>
        <WebView
          ref={call.webRef}
          originWhitelist={['*']}
          source={{ html, baseUrl: 'https://iyiyi.xyz' }}
          onMessage={call.onWebMessage}
          javaScriptEnabled
          allowsInlineMediaPlayback
          mediaPlaybackRequiresUserAction={false}
          mediaCapturePermissionGrantType="grant"
          allowsPictureInPictureMediaPlayback={false}
          scrollEnabled={false}
          bounces={false}
          overScrollMode="never"
          automaticallyAdjustContentInsets={false}
          contentInsetAdjustmentBehavior="never"
          style={styles.web}
          containerStyle={styles.web}
          onError={() => call.hangup()}
          onContentProcessDidTerminate={() => call.hangup()}
        />
      </View>
      <View style={styles.bar}>
        <PanelBtn icon={call.muted ? 'mic-off' : 'mic'} on={call.muted} onPress={call.toggleMute} label={call.muted ? 'Unmute' : 'Mute'} />
        <PanelBtn icon={call.camOff ? 'videocam-off' : 'videocam'} on={call.camOff} onPress={call.toggleCam} label={call.camOff ? 'Camera on' : 'Camera off'} />
        <PanelBtn icon="camera-reverse" onPress={call.flip} label="Flip camera" />
        <PanelBtn icon="call" danger onPress={call.hangup} label="Hang up" />
      </View>
    </Animated.View>
  )
}

function PanelBtn({ icon, onPress, label, on, danger }) {
  return (
    <Pressable onPress={onPress} hitSlop={4} accessibilityRole="button" accessibilityLabel={label} style={({ pressed }) => [styles.pbtn, on && styles.pbtnOn, danger && styles.pbtnDanger, pressed && styles.pressed]}>
      <Ionicons name={icon} size={15} color="#fff" style={danger ? { transform: [{ rotate: '135deg' }] } : null} />
    </Pressable>
  )
}

// Small round "video call" action used by the opponent card.
export function VideoCallButton({ call, disabled }) {
  const busy = call?.status && call.status !== 'idle'
  return (
    <Pressable
      onPress={busy ? call.hangup : call?.start}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={busy ? 'End video call' : 'Video call'}
      style={({ pressed }) => [{ opacity: disabled ? 0.4 : 1 }, pressed && styles.pressed]}
    >
      <LinearGradient colors={busy ? [AC.danger, '#c23a4a'] : ['#2fdc8f', '#1aa86b']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.vbtn}>
        <Ionicons name={busy ? 'videocam-off' : 'videocam'} size={17} color="#fff" />
      </LinearGradient>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  pressed: { transform: [{ scale: 0.92 }] },
  panel: {
    position: 'absolute', left: 0, top: 0, zIndex: 50, elevation: 12,
    borderRadius: 16, overflow: 'hidden', backgroundColor: 'rgba(10,12,28,0.96)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)',
    shadowColor: '#000', shadowOpacity: 0.5, shadowRadius: 16, shadowOffset: { width: 0, height: 8 },
  },
  grip: { height: 18, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 6 },
  gripBar: { width: 32, height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.35)' },
  gripText: { fontSize: 9, ...font.bold, color: AC.muted },
  web: { flex: 1, backgroundColor: '#070914' },
  bar: { height: BAR_H, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-evenly', paddingHorizontal: 4 },
  pbtn: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.14)' },
  pbtnOn: { backgroundColor: 'rgba(255,255,255,0.4)' },
  pbtnDanger: { backgroundColor: AC.danger },
  pillWrap: { position: 'absolute', top: 8, left: 0, right: 0, alignItems: 'center', zIndex: 60 },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 8, maxWidth: '90%', paddingHorizontal: 14, paddingVertical: 9, borderRadius: 999, backgroundColor: 'rgba(10,12,28,0.92)', borderWidth: 1, borderColor: AC.border },
  pillText: { fontSize: 13, ...font.semibold, color: AC.text, flexShrink: 1 },
  pillEnd: { width: 22, height: 22, borderRadius: 11, backgroundColor: AC.danger, alignItems: 'center', justifyContent: 'center' },
  ringOverlay: { flex: 1, backgroundColor: 'rgba(2,3,10,0.72)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  ringCard: { width: '100%', maxWidth: 320, alignItems: 'center', paddingVertical: 28, paddingHorizontal: 20, borderRadius: 28, backgroundColor: '#0d1126', borderWidth: 1, borderColor: AC.border },
  ringAvatar: { padding: 4, borderRadius: 50, borderWidth: 2, borderColor: AC.live, marginBottom: 14 },
  ringName: { fontSize: 22, ...font.heavy, color: AC.text, letterSpacing: -0.3 },
  ringSub: { fontSize: 14, ...font.regular, color: AC.muted, marginTop: 4 },
  ringRow: { flexDirection: 'row', gap: 56, marginTop: 26 },
  ringBtn: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center' },
  ringLabels: { flexDirection: 'row', gap: 56, marginTop: 8 },
  ringLabel: { width: 64, textAlign: 'center', fontSize: 12, ...font.semibold, color: AC.muted },
  vbtn: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
})
