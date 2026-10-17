// Web version of the video call's page host: the same WebRTC page in a same-origin iframe, so
// calls work on app.iyiyi.xyz too and connect to phones. Mirrors the bits of the WebView API the
// call uses: injectJavaScript(code) and onMessage({ nativeEvent: { data } }).
import React, { forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from 'react'
import { StyleSheet } from 'react-native'

const BRIDGE = '<script>window.ReactNativeWebView={postMessage:function(s){try{parent.postMessage({__vcall:s},"*")}catch(e){}}};</script>'

const CallFrame = forwardRef(function CallFrame({ source, onMessage, style, onError }, ref) {
  const frame = useRef(null)
  const onMsgRef = useRef(onMessage)
  onMsgRef.current = onMessage
  useImperativeHandle(ref, () => ({
    injectJavaScript(code) {
      try { frame.current?.contentWindow?.eval(code) } catch (e) { /* page not ready yet */ }
    },
  }), [])
  useEffect(() => {
    const onMsg = (e) => {
      if (!frame.current || e.source !== frame.current.contentWindow) return
      const d = e.data
      if (d && typeof d === 'object' && '__vcall' in d) onMsgRef.current?.({ nativeEvent: { data: d.__vcall } })
    }
    window.addEventListener('message', onMsg)
    return () => window.removeEventListener('message', onMsg)
  }, [])
  const html = useMemo(() => {
    const h = source?.html || ''
    return h.includes('<head>') ? h.replace('<head>', `<head>${BRIDGE}`) : BRIDGE + h
  }, [source?.html])
  const flat = StyleSheet.flatten(style) || {}
  return React.createElement('iframe', {
    ref: frame,
    srcDoc: html,
    title: 'video call',
    allow: 'camera; microphone; autoplay; fullscreen',
    onError,
    style: { border: 0, display: 'block', width: '100%', height: '100%', background: '#070914', ...flat },
  })
})

export default CallFrame
