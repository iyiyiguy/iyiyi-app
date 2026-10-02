// The three.js scene that runs inside Logo3D's WebView (as plain ES5 source, injected after
// three.min.js). Builds a glossy extruded, bevelled iY from the traced shape, textured on its
// faces with the logo art, lit by a soft studio environment + coloured lights, with a glow
// below. It follows the head pose the app sends (window.__iyPose) and holds still otherwise.
// Talks back through ReactNativeWebView.postMessage: 'ready' after the first frame, 'error:...'.
export default String.raw`
(function () {
  var post = function (m) { try { window.ReactNativeWebView && window.ReactNativeWebView.postMessage(m) } catch (e) {} }
  window.onerror = function (msg) { post('error:' + msg); return true }
  try {
    var SHAPE = window.__IY_SHAPE
    var W = window.innerWidth || 300, H = window.innerHeight || 280
    var canvas = document.createElement('canvas')
    var gl = canvas.getContext('webgl', { alpha: true, antialias: true, premultipliedAlpha: true }) || canvas.getContext('experimental-webgl')
    if (!gl) { post('error:no-webgl'); return }
    var renderer = new THREE.WebGLRenderer({ canvas: canvas, context: gl, alpha: true, antialias: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    renderer.setSize(W, H)
    renderer.setClearColor(0x000000, 0)
    renderer.outputEncoding = THREE.sRGBEncoding
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 0.95
    document.body.appendChild(canvas)

    var scene = new THREE.Scene()
    var camera = new THREE.PerspectiveCamera(30, W / H, 0.1, 50)
    camera.position.set(0, 0.55, 5.2)
    camera.lookAt(0, -0.12, 0)

    // Studio environment for reflections: a gradient dome with a few bright softboxes.
    var env = new THREE.Scene()
    var domeGeo = new THREE.SphereGeometry(10, 32, 16)
    var cols = []
    var pos = domeGeo.attributes.position
    for (var i = 0; i < pos.count; i++) {
      var t = (pos.getY(i) / 10 + 1) / 2
      var c = new THREE.Color(0x12031c).lerp(new THREE.Color(0xffe8f8), Math.pow(t, 2.2))
      cols.push(c.r, c.g, c.b)
    }
    domeGeo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3))
    env.add(new THREE.Mesh(domeGeo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide })))
    var box = function (color, x, y, z, w, h) {
      var m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: color, side: THREE.DoubleSide }))
      m.position.set(x, y, z); m.lookAt(0, 0, 0); env.add(m)
    }
    box(0xffffff, -4, 6, 5, 6, 3)
    box(0xff3fd8, -7, 0, 2, 3, 6)
    box(0x2fe6ff, 7, 1, -1, 3, 6)
    box(0xffffff, 3, 3, 7, 3, 2)
    var pmrem = new THREE.PMREMGenerator(renderer)
    scene.environment = pmrem.fromScene(env, 0.03).texture

    scene.add(new THREE.HemisphereLight(0xffe6fb, 0x2a0033, 0.4))
    var key = new THREE.DirectionalLight(0xffffff, 1.3); key.position.set(-3, 4, 5); scene.add(key)
    var pink = new THREE.PointLight(0xff2bd6, 2.0, 20); pink.position.set(3, -1.2, 3); scene.add(pink)
    var cyan = new THREE.PointLight(0x19e3ff, 1.6, 20); cyan.position.set(-3, 1.5, -2.5); scene.add(cyan)

    // Extruded, bevelled iY.
    var toShape = function (pts, Ctor) {
      var s = new Ctor()
      s.moveTo(pts[0][0], pts[0][1])
      for (var k = 1; k < pts.length; k++) s.lineTo(pts[k][0], pts[k][1])
      s.closePath()
      return s
    }
    var shapes = (SHAPE.shapes || []).map(function (d) {
      var s = toShape(d.outer, THREE.Shape)
      ;(d.holes || []).forEach(function (h) { s.holes.push(toShape(h, THREE.Path)) })
      return s
    })
    var DEPTH = 0.42
    var geo = new THREE.ExtrudeGeometry(shapes, {
      depth: DEPTH, bevelEnabled: true, bevelThickness: 0.08, bevelSize: 0.05, bevelSegments: 5, curveSegments: 6, steps: 1,
    })
    geo.computeBoundingBox()
    var bb = geo.boundingBox
    geo.translate(-(bb.min.x + bb.max.x) / 2, -(bb.min.y + bb.max.y) / 2, -(bb.min.z + bb.max.z) / 2)
    geo.computeBoundingBox()
    bb = geo.boundingBox
    // Faces map the logo art across the shape's bounds.
    var uv = geo.attributes.uv, p = geo.attributes.position
    var bw = bb.max.x - bb.min.x, bh = bb.max.y - bb.min.y
    for (var j = 0; j < p.count; j++) uv.setXY(j, (p.getX(j) - bb.min.x) / bw, (p.getY(j) - bb.min.y) / bh)
    uv.needsUpdate = true
    geo.computeVertexNormals()

    var faceMat = new THREE.MeshPhysicalMaterial({
      color: 0xffffff, metalness: 0.12, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.05,
      emissive: 0x2a0022, envMapIntensity: 1.25,
    })
    var sideMat = new THREE.MeshPhysicalMaterial({
      color: 0x8e0a78, metalness: 0.78, roughness: 0.2, clearcoat: 1, clearcoatRoughness: 0.06, envMapIntensity: 1.1,
    })
    if (window.__IY_TEX) {
      new THREE.TextureLoader().load(window.__IY_TEX, function (tex) {
        tex.encoding = THREE.sRGBEncoding
        tex.anisotropy = 4
        tex.generateMipmaps = false // keep the art's full resolution (no power-of-two resize)
        tex.minFilter = THREE.LinearFilter
        faceMat.map = tex
        faceMat.needsUpdate = true
      })
    } else {
      faceMat.color.set(0xff3fc8)
    }
    var mesh = new THREE.Mesh(geo, [faceMat, sideMat])
    var pivot = new THREE.Group(); pivot.add(mesh)
    var float = new THREE.Group(); float.add(pivot); scene.add(float)

    // Soft glow + contact shadow below.
    var glowTex = (function () {
      var c = document.createElement('canvas'); c.width = c.height = 128
      var g = c.getContext('2d')
      var gr = g.createRadialGradient(64, 64, 4, 64, 64, 64)
      gr.addColorStop(0, 'rgba(255,60,210,0.85)'); gr.addColorStop(0.45, 'rgba(255,43,214,0.35)'); gr.addColorStop(1, 'rgba(255,43,214,0)')
      g.fillStyle = gr; g.fillRect(0, 0, 128, 128)
      return new THREE.CanvasTexture(c)
    })()
    var glow = new THREE.Mesh(new THREE.PlaneGeometry(2.8, 2.8), new THREE.MeshBasicMaterial({ map: glowTex, transparent: true, depthWrite: false, toneMapped: false }))
    glow.rotation.x = -Math.PI / 2
    glow.position.y = -(bh / 2) - 0.32
    scene.add(glow)

    // Pose in: yaw/pitch/roll (radians, screen space, from the face). No pose -> hold the last
    // one (no idle spin, no auto-rotation: it only turns when the head turns).
    var euler = new THREE.Euler(0, 0, 0, 'YXZ')
    var tgt = { yaw: 0, pitch: 0, roll: 0 }, cur = { yaw: 0, pitch: 0, roll: 0 }, vel = { yaw: 0, pitch: 0, roll: 0 }
    var paused = false
    var clamp = function (v, a) { return Math.max(-a, Math.min(a, +v || 0)) }
    window.__iyPose = function (yaw, pitch, roll, has) {
      if (!has) return
      tgt.yaw = clamp(yaw, 1.1); tgt.pitch = clamp(pitch, 0.6); tgt.roll = clamp(roll, 0.8)
    }
    window.__iyPause = function (v) { paused = !!v }

    // Critically damped spring per axis: follows the head with no overshoot and no jitter.
    var OMEGA = 10
    var step = function (k, dt) {
      var a = OMEGA * OMEGA * (tgt[k] - cur[k]) - 2 * OMEGA * vel[k]
      vel[k] += a * dt
      cur[k] += vel[k] * dt
    }
    var last = 0, t0 = performance.now(), sentReady = false
    var frame = function (now) {
      requestAnimationFrame(frame)
      if (paused || now - last < 32) return // <= 30 fps
      var dt = Math.min(0.05, (now - (last || now)) / 1000)
      last = now
      var t = (now - t0) / 1000
      var sub = 2 // two half-steps keep the spring stable at 30 fps
      for (var n = 0; n < sub; n++) { step('yaw', dt / sub); step('pitch', dt / sub); step('roll', dt / sub) }
      euler.set(cur.pitch + 0.06, cur.yaw, cur.roll, 'YXZ')
      pivot.quaternion.setFromEuler(euler)
      float.position.y = Math.sin(t * 2.0) * 0.035 // gentle float only, no rotation
      glow.material.opacity = 0.8 + Math.sin(t * 2.0) * 0.1
      renderer.render(scene, camera)
      if (!sentReady) { sentReady = true; post('ready') }
    }
    requestAnimationFrame(frame)
    canvas.addEventListener('webglcontextlost', function (e) { e.preventDefault(); post('error:context-lost') })
  } catch (e) {
    post('error:' + (e && e.message))
  }
})();
`
