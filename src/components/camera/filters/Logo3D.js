import React, { useEffect, useRef, useState } from 'react'
import { StyleSheet, TurboModuleRegistry, View } from 'react-native'
import THREE_SOURCE from './logo3d/threeSource'
import SHAPE from './logo3d/shape'
import LOGO_TEXTURE from './logo3d/logoTexture'
import SCENE_SOURCE from './logo3d/scene'

// Real-time 3D iY: a transparent WebView running three.js (inlined, works offline) with an
// ExtrudeGeometry traced from the logo, glossy clearcoat materials and studio lighting (see
// logo3d/scene.js). The head pose (yaw / pitch / roll, radians, screen space) is pushed in with
// setPose(); with no head it holds its last pose (no spin). Rendered at 2x its layout size and scaled
// down so it stays crisp when the overlay is scaled up over a close face.
//
// Until the scene reports 'ready' (and forever if WebGL / the WebView fails) `fallback` is shown
// instead, so there's always a logo on screen.

export const LOGO3D_W = 150
export const LOGO3D_H = 140
const RENDER_SCALE = 2

let cachedHtml = null
function sceneHtml() {
  if (cachedHtml) return cachedHtml
  cachedHtml = '<!doctype html><html><head><meta charset="utf-8">'
    + '<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">'
    + '<style>html,body{margin:0;padding:0;background:transparent;overflow:hidden}canvas{display:block}</style>'
    + '</head><body>'
    + `<script>${THREE_SOURCE}</script>`
    + `<script>window.__IY_SHAPE=${JSON.stringify(SHAPE)};window.__IY_TEX=${JSON.stringify(LOGO_TEXTURE)};</script>`
    + `<script>${SCENE_SOURCE}</script>`
    + '</body></html>'
  return cachedHtml
}

// react-native-webview's JS throws at import time if the native module isn't in this binary,
// so it's only required (once) after checking the module is there.
let WebViewComp
function getWebView() {
  if (WebViewComp !== undefined) return WebViewComp
  WebViewComp = null
  try {
    if (TurboModuleRegistry.get('RNCWebViewModule')) {
      // eslint-disable-next-line global-require
      WebViewComp = require('react-native-webview').WebView || null
    }
  } catch {
    WebViewComp = null
  }
  return WebViewComp
}

// Any render error inside the WebView subtree -> show the PNG logo instead of crashing.
class Guard extends React.Component {
  constructor(props) {
    super(props)
    this.state = { bad: false }
  }

  static getDerivedStateFromError() { return { bad: true } }

  componentDidCatch(e) { console.warn('Logo3D crashed, using the 2D logo', e?.message ?? e) }

  render() { return this.state.bad ? (this.props.fallback ?? null) : this.props.children }
}

const r3 = (v) => Math.round((Number.isFinite(v) ? v : 0) * 1000) / 1000

export default function Logo3D(props) {
  const WebView = getWebView()
  if (!WebView) return <View style={styles.wrap} pointerEvents="none">{props.fallback ?? null}</View>
  return (
    <Guard fallback={<View style={styles.wrap} pointerEvents="none">{props.fallback ?? null}</View>}>
      <Logo3DInner {...props} WebView={WebView} />
    </Guard>
  )
}

function Logo3DInner({ registerPose, fallback, paused = false, WebView }) {
  const web = useRef(null)
  const [ready, setReady] = useState(false)
  const [failed, setFailed] = useState(false)
  const lastSent = useRef('')
  const lastPoseJs = useRef('') // re-sent once the scene is up (poses before that are lost)

  // Hand the parent a function that forwards head poses into the scene.
  useEffect(() => {
    if (typeof registerPose !== 'function') return undefined
    registerPose((pose) => {
      try {
        if (!web.current) return
        const js = pose
          ? `window.__iyPose&&window.__iyPose(${r3(pose.yaw)},${r3(pose.pitch)},${r3(pose.roll)},1);true;`
          : 'window.__iyPose&&window.__iyPose(0,0,0,0);true;'
        if (js === lastSent.current) return
        lastSent.current = js
        if (pose) lastPoseJs.current = js
        web.current.injectJavaScript(js)
      } catch {}
    })
    return () => { try { registerPose(null) } catch {} }
  }, [registerPose])

  useEffect(() => {
    try { web.current?.injectJavaScript(`window.__iyPause&&window.__iyPause(${paused ? 1 : 0});true;`) } catch {}
  }, [paused, ready])

  const onMessage = (e) => {
    const m = String(e?.nativeEvent?.data ?? '')
    if (m === 'ready') {
      setReady(true)
      try { if (lastPoseJs.current) web.current?.injectJavaScript(lastPoseJs.current) } catch {}
    }
    else if (m.startsWith('error')) {
      console.warn('Logo3D:', m)
      setFailed(true)
    }
  }

  return (
    <View style={styles.wrap} pointerEvents="none">
      {!failed && (
        <View style={[styles.webWrap, { opacity: ready ? 1 : 0.01 }]} pointerEvents="none">
          <WebView
            ref={web}
            originWhitelist={['*']}
            source={{ html: sceneHtml() }}
            style={styles.web}
            containerStyle={styles.webContainer}
            opaque={false}
            backgroundColor="transparent"
            scrollEnabled={false}
            bounces={false}
            overScrollMode="never"
            showsHorizontalScrollIndicator={false}
            showsVerticalScrollIndicator={false}
            javaScriptEnabled
            allowsInlineMediaPlayback
            automaticallyAdjustContentInsets={false}
            contentInsetAdjustmentBehavior="never"
            setSupportMultipleWindows={false}
            onMessage={onMessage}
            onError={() => setFailed(true)}
            onContentProcessDidTerminate={() => setFailed(true)}
            onRenderProcessGone={() => setFailed(true)}
          />
        </View>
      )}
      {(!ready || failed) && fallback ? <View style={StyleSheet.absoluteFill} pointerEvents="none">{fallback}</View> : null}
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { width: LOGO3D_W, height: LOGO3D_H, alignItems: 'center', justifyContent: 'center' },
  webWrap: {
    position: 'absolute',
    width: LOGO3D_W * RENDER_SCALE,
    height: LOGO3D_H * RENDER_SCALE,
    left: (LOGO3D_W - LOGO3D_W * RENDER_SCALE) / 2,
    top: (LOGO3D_H - LOGO3D_H * RENDER_SCALE) / 2,
    transform: [{ scale: 1 / RENDER_SCALE }],
  },
  webContainer: { backgroundColor: 'transparent', flex: 1 },
  web: { backgroundColor: 'transparent', flex: 1 },
})
