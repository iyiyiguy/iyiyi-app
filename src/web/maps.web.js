// Web stand-in for react-native-maps (aliased in metro.config.js for platform "web" only).
// Leaflet with a dark CARTO basemap; implements the props, children and ref methods the app
// uses: initialRegion / initialCamera, onRegionChangeComplete, onPress / onLongPress,
// animateToRegion, animateCamera, setCamera, getCamera, fitToCoordinates, getMapBoundaries,
// <Marker> (custom React children rendered into the marker via a portal, or a default pin),
// <Circle>, <Polygon>, <Polyline>, <Callout>.
import { createContext, forwardRef, useContext, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { View } from 'react-native'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

const MapCtx = createContext(null)

const TILE_URL = 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
const TILE_ATTR = '&copy; OpenStreetMap contributors &copy; CARTO'

const clampZoom = (z) => Math.max(2, Math.min(19, z))
const zoomForDelta = (latDelta) => clampZoom(Math.round(Math.log2(360 / Math.max(latDelta || 0.05, 0.0005))))
const deltaForZoom = (z) => 360 / 2 ** z
const zoomForAltitude = (alt) => clampZoom(Math.round(Math.log2(40000000 / Math.max(alt || 1000, 50))))

function regionOf(map) {
  const c = map.getCenter()
  const b = map.getBounds()
  return {
    latitude: c.lat,
    longitude: c.lng,
    latitudeDelta: Math.abs(b.getNorth() - b.getSouth()),
    longitudeDelta: Math.abs(b.getEast() - b.getWest()),
  }
}

const coordEvent = (latlng, extra) => ({
  nativeEvent: { coordinate: { latitude: latlng.lat, longitude: latlng.lng }, ...extra },
  stopPropagation() {},
  preventDefault() {},
})

const MapView = forwardRef(function MapView(props, ref) {
  const {
    style, children, initialRegion, region, initialCamera, camera,
    onRegionChangeComplete, onPress, onLongPress, onMapReady,
    scrollEnabled = true, zoomEnabled = true,
  } = props
  const holder = useRef(null)
  const [map, setMap] = useState(null)
  const latest = useRef(props)
  latest.current = props

  useEffect(() => {
    const node = holder.current
    if (!node) return undefined
    const el = node instanceof HTMLElement ? node : node?.getNode?.() || null
    if (!el) return undefined
    const m = L.map(el, {
      zoomControl: false,
      attributionControl: true,
      dragging: scrollEnabled !== false,
      scrollWheelZoom: zoomEnabled !== false,
      doubleClickZoom: zoomEnabled !== false,
      touchZoom: zoomEnabled !== false,
      worldCopyJump: true,
    })
    L.tileLayer(TILE_URL, { attribution: TILE_ATTR, subdomains: 'abcd', maxZoom: 20 }).addTo(m)
    const r = region || initialRegion
    const cam = camera || initialCamera
    if (cam?.center) {
      m.setView([cam.center.latitude, cam.center.longitude], cam.zoom ?? zoomForAltitude(cam.altitude))
    } else if (r) {
      m.setView([r.latitude, r.longitude], zoomForDelta(r.latitudeDelta))
    } else {
      m.setView([39.5, -98.35], 4)
    }
    m.on('moveend', () => latest.current.onRegionChangeComplete?.(regionOf(m), { isGesture: true }))
    m.on('click', (e) => latest.current.onPress?.(coordEvent(e.latlng, { action: 'press' })))
    m.on('contextmenu', (e) => latest.current.onLongPress?.(coordEvent(e.latlng)))
    // The holder may be laid out after mount (flex); keep Leaflet's size in sync.
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => m.invalidateSize()) : null
    ro?.observe(el)
    setTimeout(() => m.invalidateSize(), 0)
    setMap(m)
    latest.current.onMapReady?.()
    return () => {
      ro?.disconnect()
      m.remove()
      setMap(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Controlled `region` prop.
  useEffect(() => {
    if (map && region) map.setView([region.latitude, region.longitude], zoomForDelta(region.latitudeDelta))
  }, [map, region?.latitude, region?.longitude, region?.latitudeDelta]) // eslint-disable-line react-hooks/exhaustive-deps

  useImperativeHandle(ref, () => ({
    animateToRegion(r, duration = 500) {
      if (map && r) map.flyTo([r.latitude, r.longitude], zoomForDelta(r.latitudeDelta), { duration: duration / 1000 })
    },
    animateCamera(c, opts) {
      if (!map || !c) return
      const center = c.center ? [c.center.latitude, c.center.longitude] : map.getCenter()
      const zoom = c.zoom ?? (c.altitude ? zoomForAltitude(c.altitude) : map.getZoom())
      map.flyTo(center, zoom, { duration: (opts?.duration ?? 500) / 1000 })
    },
    setCamera(c) {
      if (!map || !c) return
      const center = c.center ? [c.center.latitude, c.center.longitude] : map.getCenter()
      map.setView(center, c.zoom ?? (c.altitude ? zoomForAltitude(c.altitude) : map.getZoom()))
    },
    getCamera() {
      if (!map) return Promise.resolve(null)
      const c = map.getCenter()
      const z = map.getZoom()
      return Promise.resolve({ center: { latitude: c.lat, longitude: c.lng }, zoom: z, altitude: 40000000 / 2 ** z, heading: 0, pitch: 0 })
    },
    fitToCoordinates(coords, opts) {
      if (!map || !coords?.length) return
      const p = opts?.edgePadding || {}
      map.fitBounds(coords.map((c) => [c.latitude, c.longitude]), {
        paddingTopLeft: [p.left || 20, p.top || 20],
        paddingBottomRight: [p.right || 20, p.bottom || 20],
        animate: opts?.animated !== false,
      })
    },
    fitToElements() {},
    fitToSuppliedMarkers() {},
    getMapBoundaries() {
      if (!map) return Promise.resolve(null)
      const b = map.getBounds()
      return Promise.resolve({
        northEast: { latitude: b.getNorth(), longitude: b.getEast() },
        southWest: { latitude: b.getSouth(), longitude: b.getWest() },
      })
    },
    pointForCoordinate(c) {
      if (!map) return Promise.resolve({ x: 0, y: 0 })
      const p = map.latLngToContainerPoint([c.latitude, c.longitude])
      return Promise.resolve({ x: p.x, y: p.y })
    },
    coordinateForPoint(pt) {
      if (!map) return Promise.resolve({ latitude: 0, longitude: 0 })
      const ll = map.containerPointToLatLng([pt.x, pt.y])
      return Promise.resolve({ latitude: ll.lat, longitude: ll.lng })
    },
  }), [map])

  return (
    <View style={[{ overflow: 'hidden', backgroundColor: '#0d0b14' }, style]}>
      <View ref={holder} style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 }} />
      <MapCtx.Provider value={map}>{map ? children : null}</MapCtx.Provider>
    </View>
  )
})

export default MapView

export function Marker({ coordinate, children, title, description, pinColor, onPress, onCalloutPress, anchor, zIndex }) {
  const map = useContext(MapCtx)
  const [el, setEl] = useState(null)
  const markerRef = useRef(null)
  const cb = useRef({ onPress, onCalloutPress })
  cb.current = { onPress, onCalloutPress }
  const hasChildren = children != null && children !== false
  const ax = anchor?.x ?? 0.5
  const ay = anchor?.y ?? (hasChildren ? 0.5 : 1)

  useEffect(() => {
    if (!map || !coordinate) return undefined
    const div = document.createElement('div')
    div.style.cssText = `position:absolute;transform:translate(${-ax * 100}%,${-ay * 100}%);cursor:pointer;`
    if (!hasChildren) {
      const c = pinColor || '#e83e8c'
      div.innerHTML = `<div style="width:18px;height:18px;border-radius:50%;background:${c};border:3px solid rgba(255,255,255,0.9);box-shadow:0 2px 10px rgba(0,0,0,0.5)"></div>`
    }
    const icon = L.divIcon({ html: div, className: '', iconSize: null })
    const m = L.marker([coordinate.latitude, coordinate.longitude], { icon, zIndexOffset: zIndex || 0 }).addTo(map)
    if (title) m.bindTooltip(`<b>${String(title).replace(/</g, '&lt;')}</b>${description ? `<br/>${String(description).replace(/</g, '&lt;')}` : ''}`, { direction: 'top', offset: [0, -14] })
    m.on('click', (e) => {
      L.DomEvent.stopPropagation(e)
      const ev = coordEvent(e.latlng)
      if (cb.current.onPress) cb.current.onPress(ev)
      else cb.current.onCalloutPress?.(ev)
    })
    markerRef.current = m
    setEl(div)
    return () => {
      m.remove()
      markerRef.current = null
      setEl(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, hasChildren, pinColor, title, description])

  useEffect(() => {
    if (markerRef.current && coordinate) markerRef.current.setLatLng([coordinate.latitude, coordinate.longitude])
  }, [coordinate?.latitude, coordinate?.longitude]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    markerRef.current?.setZIndexOffset(zIndex || 0)
  }, [zIndex])

  return el && hasChildren ? createPortal(children, el) : null
}

function useLayer(make, deps) {
  const map = useContext(MapCtx)
  useEffect(() => {
    if (!map) return undefined
    const layer = make()
    if (!layer) return undefined
    layer.addTo(map)
    return () => layer.remove()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, ...deps])
  return null
}

export function Circle({ center, radius, strokeColor, strokeWidth, fillColor }) {
  return useLayer(
    () => (center && radius > 0
      ? L.circle([center.latitude, center.longitude], {
        radius,
        color: strokeColor || '#e83e8c',
        weight: strokeWidth ?? 1,
        fillColor: fillColor || 'rgba(232,62,140,0.15)',
        fillOpacity: 1,
        interactive: false,
      })
      : null),
    [center?.latitude, center?.longitude, radius, strokeColor, strokeWidth, fillColor],
  )
}

export function Polygon({ coordinates, strokeColor, strokeWidth, fillColor }) {
  return useLayer(
    () => (coordinates?.length
      ? L.polygon(coordinates.map((c) => [c.latitude, c.longitude]), {
        color: strokeColor || '#e83e8c', weight: strokeWidth ?? 1, fillColor: fillColor || 'rgba(232,62,140,0.15)', fillOpacity: 1, interactive: false,
      })
      : null),
    [JSON.stringify(coordinates), strokeColor, strokeWidth, fillColor],
  )
}

export function Polyline({ coordinates, strokeColor, strokeWidth }) {
  return useLayer(
    () => (coordinates?.length
      ? L.polyline(coordinates.map((c) => [c.latitude, c.longitude]), { color: strokeColor || '#e83e8c', weight: strokeWidth ?? 2, interactive: false })
      : null),
    [JSON.stringify(coordinates), strokeColor, strokeWidth],
  )
}

export const Callout = () => null
export const UrlTile = () => null
export const Overlay = () => null
export const Heatmap = () => null
export const PROVIDER_GOOGLE = 'google'
export const PROVIDER_DEFAULT = null
export const MAP_TYPES = { STANDARD: 'standard', SATELLITE: 'satellite', HYBRID: 'hybrid', TERRAIN: 'terrain' }
export const AnimatedRegion = class {
  constructor(v) { Object.assign(this, v) }
}
