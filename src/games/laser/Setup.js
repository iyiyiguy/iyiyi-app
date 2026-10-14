// Lobby setup for Laser Tag: the play area (boundary presets on a map), teams
// (auto-balance, switch, lock) for team modes, and Search & Destroy bomb sites, which
// are generated automatically on a street or sidewalk inside the play area. The host can
// also walk to a spot and tap "Set A here" (GPS), or tap the map in Place A / Place B.
import React, { useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, Switch, Text, View } from 'react-native'
import * as Location from 'expo-location'
import { Avatar } from '../MultiplayerUI'
import { AC, ArcadeBox as Card, ArcadeBtn as Btn, arcadeType } from '../arcadeUI'
import { GameMap, isValidCoord } from '../GameMap'
import { AREA_PRESETS, TEAMS, distanceMeters, formatDistance } from '../../lib/multiplayer'
import { buzz } from '../../lib/gamePrefs'
import { MIN_SITE_GAP_M, SITE_RADIUS_M, balanceTeams } from './engine'
import { generateBombSites } from './bombSites'
import { colors as themeColors } from '../../theme'
import { HUD } from './HudPro'
import { withAlpha } from '../GameMap'
import { FONT, ST, useStudioFonts } from '../studio'

// Lobby panels use the always-dark arcade look.
const type = arcadeType
const colors = { ...themeColors, text: AC.text, textMuted: AC.muted, textFaint: AC.faint, hairline: AC.border }

const DEFAULT_AREA = '150ft'

export const areaKey = (a) => (a && isValidCoord(a.lat, a.lng) ? `${a.lat.toFixed(5)},${a.lng.toFixed(5)},${Math.round(a.r || 0)}` : '')

export function laserCanStart(info, roster) {
  const mode = info.settings?.mode || 'ffa'
  if (mode === 'ffa') return { ok: true }
  const teams = info.teams || {}
  const count = { A: 0, B: 0 }
  for (const p of roster) if (teams[p.id]) count[teams[p.id]] += 1
  if (roster.length >= 2 && (count.A === 0 || count.B === 0)) return { ok: false, reason: 'Both teams need at least one player.' }
  const sites = (info.settings?.sites || []).filter((x) => x && isValidCoord(x.lat, x.lng))
  if (mode === 'snd' && !sites.length) return { ok: false, reason: 'Waiting for a bomb site — set the play area, tap "Set A here", or tap the map to drop one.' }
  if (mode === 'snd' && sites.length >= 2 && distanceMeters(sites[0], sites[1]) < MIN_SITE_GAP_M) return { ok: false, reason: `Bomb sites A and B overlap — move one at least ${formatDistance(MIN_SITE_GAP_M)} away.` }
  return { ok: true }
}

export function LaserTagSetup({ room, snap }) {
  useStudioFonts()
  const info = snap.info
  const settings = info.settings || {}
  const mode = settings.mode || 'ffa'
  const isHost = snap.isHost
  const meId = snap.me.id
  const teams = info.teams || {}
  const locked = !!info.teamsLocked
  const area = settings.area && isValidCoord(settings.area.lat, settings.area.lng) ? settings.area : null
  const sites = Array.isArray(settings.sites) ? settings.sites.filter((x) => x && isValidCoord(x.lat, x.lng)) : []
  const [tapMode, setTapMode] = useState('area') // area | A | B
  const [generating, setGenerating] = useState(false)
  const [siteSource, setSiteSource] = useState(null)
  const [locError, setLocError] = useState(false)
  const [placing, setPlacing] = useState(null) // 'A' | 'B' while reading GPS for "Set here"
  const [siteMsg, setSiteMsg] = useState(null) // { text, bad }
  const genToken = useRef(0)

  // Always write on top of the latest room settings (several async writers).
  const patchSettings = (patch) => room.setInfo({ settings: { ...(room.info.settings || {}), ...patch } })

  // Host: start the play area at their location.
  useEffect(() => {
    if (!isHost || area) return undefined
    let cancelled = false
    ;(async () => {
      try {
        const perm = await Location.requestForegroundPermissionsAsync()
        if (perm.status !== 'granted') { if (!cancelled) setLocError(true); return }
        const last = await Location.getLastKnownPositionAsync().catch(() => null)
        const pos = last || (await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }))
        const lat = pos?.coords?.latitude
        const lng = pos?.coords?.longitude
        if (cancelled || !isValidCoord(lat, lng) || room.info.settings?.area) return
        patchSettings({ area: { preset: DEFAULT_AREA, lat, lng, r: AREA_PRESETS[DEFAULT_AREA].r } })
      } catch {
        if (!cancelled) setLocError(true)
      }
    })()
    return () => { cancelled = true }
  }, [isHost, !!area]) // eslint-disable-line react-hooks/exhaustive-deps

  const regenerate = async (forArea) => {
    const a = forArea || area
    if (!a) return
    const token = ++genToken.current
    const key = areaKey(a)
    setGenerating(true)
    try {
      const res = await generateBombSites(a)
      if (token !== genToken.current || room.left || !room.isHost()) return
      // Ignore if the host moved the area while we were looking.
      if (areaKey(room.info.settings?.area) !== key) return
      setSiteSource(res.source)
      patchSettings({ sites: res.sites, sitesFor: key })
      buzz(res.source === 'streets' ? 'success' : 'warning')
    } finally {
      if (token === genToken.current) setGenerating(false)
    }
  }

  // Host: Search & Destroy sites follow the play area automatically.
  const currentKey = areaKey(area)
  useEffect(() => {
    if (!isHost || mode !== 'snd' || !area) return
    if (settings.sitesFor === currentKey && sites.length) return
    regenerate(area)
  }, [isHost, mode, currentKey]) // eslint-disable-line react-hooks/exhaustive-deps

  // Host keeps every player on a team (new joiners go to the smaller side).
  const rosterKey = snap.roster.map((p) => p.id).join(',')
  useEffect(() => {
    if (!isHost || mode === 'ffa') return
    const ids = snap.roster.map((p) => p.id)
    const kept = {}
    for (const id of ids) if (teams[id]) kept[id] = teams[id]
    const next = balanceTeams(ids, kept)
    if (JSON.stringify(next) !== JSON.stringify(teams)) room.setInfo({ teams: next })
  }, [isHost, mode, rosterKey]) // eslint-disable-line react-hooks/exhaustive-deps

  // Host handles players' team switch requests.
  useEffect(() => {
    if (!isHost) return undefined
    return room.onRequest((kind, data, from) => {
      if (kind !== 'team' || room.info.teamsLocked) return
      if (data?.team !== 'A' && data?.team !== 'B') return
      room.setInfo({ teams: { ...(room.info.teams || {}), [from]: data.team } })
    })
  }, [room, isHost])

  useEffect(() => { if (mode !== 'snd' && tapMode !== 'area') setTapMode('area') }, [mode]) // eslint-disable-line react-hooks/exhaustive-deps

  const setPreset = (id) => {
    if (!isHost) return
    const p = AREA_PRESETS[id]
    if (!p) return
    buzz('select')
    if (area) patchSettings({ area: { ...area, preset: id, r: p.r } })
  }

  const pick = (coord) => {
    if (!isHost || !isValidCoord(coord?.lat, coord?.lng)) return
    buzz('light')
    if (tapMode === 'area') {
      const preset = area?.preset || DEFAULT_AREA
      patchSettings({ area: { preset, lat: coord.lat, lng: coord.lng, r: AREA_PRESETS[preset]?.r || area?.r || 45.72 } })
      return
    }
    if (placeSite(tapMode, coord) && tapMode === 'A' && !sites.some((x) => x.id === 'B')) setTapMode('B')
  }

  // Put site `id` at `coord` (map tap or the host's GPS). Refuses a spot that would overlap
  // the other site; warns when it's outside the play area.
  const placeSite = (id, coord, acc) => {
    const cur = (room.info.settings?.sites || []).filter((x) => x && isValidCoord(x.lat, x.lng))
    const other = cur.find((x) => x.id !== id)
    const gap = other ? distanceMeters(other, coord) : Infinity
    if (gap < MIN_SITE_GAP_M) {
      buzz('error')
      setSiteMsg({ text: `Too close to site ${other.id} (${formatDistance(gap)}). Sites must be at least ${formatDistance(MIN_SITE_GAP_M)} apart.`, bad: true })
      return false
    }
    genToken.current += 1 // a street lookup still running must not overwrite this
    setGenerating(false)
    const next = [...cur.filter((x) => x.id !== id), { id, lat: coord.lat, lng: coord.lng, r: SITE_RADIUS_M }].sort((a, b) => a.id.localeCompare(b.id))
    patchSettings({ sites: next })
    setSiteSource('manual')
    const outside = area && distanceMeters(area, coord) > area.r
    const weak = Number.isFinite(acc) && acc > 25
    setSiteMsg({
      text: `Site ${id} set${Number.isFinite(acc) ? ` (GPS ±${formatDistance(acc)})` : ''}.${outside ? ' It’s outside the play area.' : ''}${weak ? ' GPS is weak here — the marker may be off; check it on the map.' : ''}`,
      bad: !!(outside || weak),
    })
    buzz('success')
    return true
  }

  // "Set A here": the host stands on the spot and uses a fresh GPS fix.
  const setHere = async (id) => {
    if (!isHost || placing) return
    setPlacing(id)
    setSiteMsg(null)
    buzz('medium')
    try {
      const perm = await Location.requestForegroundPermissionsAsync()
      if (perm.status !== 'granted') { setSiteMsg({ text: 'Turn on location to set a site where you stand, or tap the map.', bad: true }); return }
      let timer = null
      const pos = await Promise.race([
        Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Highest }),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), 12000) }),
      ])
        .catch(() => Location.getLastKnownPositionAsync({ maxAge: 30000, requiredAccuracy: 40 }).catch(() => null))
        .finally(() => clearTimeout(timer))
      const lat = pos?.coords?.latitude
      const lng = pos?.coords?.longitude
      if (!isValidCoord(lat, lng)) {
        buzz('error')
        setSiteMsg({ text: 'No GPS fix yet — step into the open, wait a few seconds and try again, or tap the map.', bad: true })
        return
      }
      placeSite(id, { lat, lng }, pos.coords.accuracy)
    } finally {
      setPlacing(null)
    }
  }

  const move = (id, team) => {
    if (isHost) room.setInfo({ teams: { ...teams, [id]: team } })
    else room.request('team', { team })
  }

  const circles = []
  if (area) circles.push({ id: 'area', lat: area.lat, lng: area.lng, radius: area.r, color: HUD.accent })
  if (mode === 'snd') for (const x of sites) circles.push({ id: `site-${x.id}`, lat: x.lat, lng: x.lng, radius: x.r || SITE_RADIUS_M, color: HUD.gold })
  const markers = mode === 'snd' ? sites.map((x) => ({ id: x.id, lat: x.lat, lng: x.lng, label: `SITE ${x.id}`, color: HUD.gold })) : []
  const mapCenter = area || sites[0] || null
  const hint = !isHost ? null : tapMode === 'area' ? 'Tap the map to move the play area' : `Tap the map to place site ${tapMode}`
  const siteA = sites.find((x) => x.id === 'A')
  const siteB = sites.find((x) => x.id === 'B')
  const siteGap = siteA && siteB ? distanceMeters(siteA, siteB) : null

  return (
    <>
      <Card>
        <View style={styles.headRow}>
          <Text style={type.label}>Play area</Text>
          {area && <Text style={type.caption}>{AREA_PRESETS[area.preset]?.label || formatDistance(area.r)} radius</Text>}
        </View>
        <View style={styles.chipRow}>
          {Object.values(AREA_PRESETS).map((p) => {
            const on = area?.preset === p.id
            return (
              <Pressable
                key={p.id}
                disabled={!isHost || !area}
                onPress={() => setPreset(p.id)}
                style={[styles.chip, on && styles.chipOn, (!isHost || !area) && !on && { opacity: 0.55 }]}
                accessibilityRole="button"
                accessibilityState={{ selected: on, disabled: !isHost }}
              >
                <Text style={[styles.chipText, on && { color: HUD.bg }]}>{p.label}</Text>
              </Pressable>
            )
          })}
        </View>
        {isHost && mode === 'snd' && (
          <View style={[styles.chipRow, { marginTop: 0 }]}>
            {[['area', 'Move area'], ['A', 'Tap map: A'], ['B', 'Tap map: B']].map(([id, label]) => (
              <Pressable key={id} onPress={() => setTapMode(id)} style={[styles.chipSm, tapMode === id && styles.chipOn]} accessibilityRole="button" accessibilityState={{ selected: tapMode === id }}>
                <Text style={[styles.chipText, tapMode === id && { color: HUD.bg }]}>{label}</Text>
              </Pressable>
            ))}
          </View>
        )}
        <GameMap
          center={mapCenter}
          fitRadius={area?.r}
          follow
          onPick={isHost ? pick : undefined}
          hint={hint}
          circles={circles}
          markers={markers}
        />
        <Text style={[type.caption, { marginTop: 8 }]}>
          {area
            ? isHost
              ? 'Everyone plays inside the circle. Players get a warning if they wander out.'
              : 'The host set the play area. Stay inside the circle.'
            : isHost
              ? (locError ? 'Turn on location to set the play area, or tap the map.' : 'Finding your location…')
              : 'The host is setting the play area.'}
        </Text>

        {mode === 'snd' && (
          <View style={styles.sitesBox}>
            <View style={styles.headRow}>
              <Text style={type.label}>Bomb sites</Text>
              {generating && <ActivityIndicator size="small" color={colors.textMuted} />}
            </View>
            <Text style={type.caption}>
              {generating
                ? 'Finding a spot on a street or sidewalk…'
                : sites.length
                  ? `${sites.map((x) => x.id).join(' & ')} · ${formatDistance(SITE_RADIUS_M)} radius${siteGap != null ? ` · ${formatDistance(siteGap)} apart` : ''}${siteSource === 'fallback' ? ' · placed at the area centre (map data unavailable)' : siteSource === 'streets' ? ' · on a street or sidewalk' : ''}. Everyone sees the sites on the map and compass.`
                  : isHost ? 'Sites are generated when the play area is set.' : 'The host is placing the bomb sites.'}
            </Text>
            {isHost && !generating && (
              <Text style={[type.caption, { marginTop: 4 }]}>
                To choose them yourself: stand at the spot and tap “Set A here” (then walk to B), or pick “Tap map: A/B” and tap the map. Keep sites at least {formatDistance(MIN_SITE_GAP_M)} apart, outdoors, somewhere safe to stand.
              </Text>
            )}
            {siteGap != null && siteGap < MIN_SITE_GAP_M && (
              <Text style={[type.caption, { marginTop: 4, color: HUD.red }]}>Sites A and B overlap — move one at least {formatDistance(MIN_SITE_GAP_M)} away.</Text>
            )}
            {!!siteMsg && <Text style={[type.caption, { marginTop: 4, color: siteMsg.bad ? HUD.gold : HUD.green }]}>{siteMsg.text}</Text>}
            {area && area.r > 150 && <Text style={[type.caption, { marginTop: 4 }]}>For big areas, generated sites go within about 500 ft of the area’s centre so both are in walking distance.</Text>}
            {isHost && (
              <>
                <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
                  <Btn title={placing === 'A' ? 'Locating…' : 'Set A here'} size="sm" disabled={!!placing} onPress={() => setHere('A')} style={{ flex: 1 }} />
                  <Btn title={placing === 'B' ? 'Locating…' : 'Set B here'} size="sm" disabled={!!placing} onPress={() => setHere('B')} style={{ flex: 1 }} />
                </View>
                <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
                  <Btn title={generating ? 'Rolling…' : 'Re-roll sites'} size="sm" disabled={generating || !area} onPress={() => { buzz('medium'); setSiteMsg(null); regenerate() }} style={{ flex: 1 }} />
                  {sites.some((x) => x.id === 'B') && <Btn title="Remove B" size="sm" onPress={() => { setSiteMsg(null); patchSettings({ sites: sites.filter((x) => x.id !== 'B') }) }} />}
                </View>
              </>
            )}
          </View>
        )}
      </Card>

      {mode !== 'ffa' && (
        <Card>
          <View style={styles.headRow}>
            <Text style={type.label}>Teams</Text>
            {isHost ? (
              <View style={styles.lockRow}>
                <Text style={type.caption}>Lock teams</Text>
                <Switch value={locked} onValueChange={(v) => room.setInfo({ teamsLocked: v })} trackColor={{ false: 'rgba(255,255,255,0.14)', true: HUD.accent }} thumbColor="#fff" ios_backgroundColor="rgba(255,255,255,0.14)" />
              </View>
            ) : locked ? <Text style={type.caption}>Teams locked by host</Text> : null}
          </View>
          <View style={styles.teams}>
            {['A', 'B'].map((t) => {
              const members = snap.roster.filter((p) => teams[p.id] === t)
              return (
                <View key={t} style={[styles.teamCol, { borderTopColor: TEAMS[t].color, backgroundColor: withAlpha(TEAMS[t].color, 0.1) }, teams[meId] === t && styles.teamColMine]}>
                  <View style={styles.teamHead}>
                    <View style={[styles.teamDot, { backgroundColor: TEAMS[t].color }]} />
                    <Text style={[styles.teamName, { color: TEAMS[t].color }]}>{TEAMS[t].name}</Text>
                    {teams[meId] === t ? <Text style={styles.yourTeam}>YOUR TEAM</Text> : null}
                    <Text style={styles.teamCount}>{members.length}</Text>
                  </View>
                  {members.length === 0 && <Text style={styles.emptyTeam}>EMPTY</Text>}
                  {members.map((p) => (
                    <Pressable
                      key={p.id}
                      disabled={!isHost}
                      onPress={() => move(p.id, t === 'A' ? 'B' : 'A')}
                      style={({ pressed }) => [styles.member, pressed && isHost && { backgroundColor: 'rgba(255,255,255,0.08)' }]}
                      accessibilityRole={isHost ? 'button' : undefined}
                      accessibilityHint={isHost ? 'Moves this player to the other team' : undefined}
                    >
                      <Avatar uri={p.avatar} name={p.username} size={24} />
                      <Text style={[type.caption, { color: colors.text, marginLeft: 6, flex: 1 }]} numberOfLines={1}>
                        {p.username}{p.id === meId ? ' (you)' : ''}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              )
            })}
          </View>
          {!locked && teams[meId] && (
            <Btn title={`Switch to ${TEAMS[teams[meId] === 'A' ? 'B' : 'A'].name}`} size="sm" onPress={() => move(meId, teams[meId] === 'A' ? 'B' : 'A')} style={{ marginTop: 10 }} />
          )}
          {isHost && (
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
              <Btn title="Shuffle teams" size="sm" onPress={() => room.setInfo({ teams: balanceTeams(snap.roster.map((p) => p.id)) })} style={{ flex: 1 }} />
            </View>
          )}
          {isHost && <Text style={styles.hint}>TAP A PLAYER TO MOVE THEM</Text>}
        </Card>
      )}
    </>
  )
}

const styles = StyleSheet.create({
  headRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  lockRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  teams: { flexDirection: 'row', gap: 8 },
  teamCol: { flex: 1, borderTopWidth: 3, borderRadius: ST.radius, padding: 10, gap: 2 },
  teamColMine: { borderWidth: 1, borderColor: 'rgba(255,255,255,0.22)', borderTopWidth: 3 },
  teamHead: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 },
  teamDot: { width: 8, height: 8 },
  teamName: { flex: 1, fontFamily: FONT.display, fontSize: 14, letterSpacing: 1.6, textTransform: 'uppercase' },
  yourTeam: { fontFamily: FONT.ui, fontSize: 9, letterSpacing: 1.4, color: AC.muted },
  teamCount: { fontFamily: FONT.display, fontSize: 14, color: AC.text, fontVariant: ['tabular-nums'] },
  emptyTeam: { fontFamily: FONT.ui, fontSize: 10, letterSpacing: 1.6, color: AC.faint },
  member: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6, paddingHorizontal: 4, borderRadius: ST.radius },
  hint: { fontFamily: FONT.ui, fontSize: 10, letterSpacing: 1.6, color: AC.faint, marginTop: 8 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 10 },
  chip: { paddingHorizontal: 14, minHeight: 36, justifyContent: 'center', borderRadius: ST.radius, borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)' },
  chipSm: { paddingHorizontal: 12, minHeight: 32, justifyContent: 'center', borderRadius: ST.radius, borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)' },
  chipOn: { backgroundColor: HUD.accent, borderColor: HUD.accent },
  chipText: { fontFamily: FONT.ui, fontSize: 12, letterSpacing: 1.2, color: AC.text, textTransform: 'uppercase' },
  sitesBox: { marginTop: 14, paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.hairline },
})
