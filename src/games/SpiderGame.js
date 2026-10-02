// Spider Spider 123 — real-world tag over GPS.
// Host-authoritative: the host picks the first spider. A tag only lands if the
// spider stays within range of the victim for 3 seconds straight (checked by
// the host against both players' shared positions); walking out of range
// breaks it. Tagged players become spiders; the last free player wins. The
// round timer is optional (off by default).
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { ScrollView, StyleSheet, Text, View } from 'react-native'
import { Avatar, Btn, Card, LocationGate, Pill, PlayerRow, PlayerTap, ProgressRing, Spectating, formatClock } from './MultiplayerUI'
import { buzz } from '../lib/gamePrefs'
import {
  bearingDeg, compassLabel, distanceMeters, formatDistance, recordRoundResult, shuffled,
  useHostLoop, useRoomClock, useRoomPositions, useRoomSnapshot, useSharedLocation,
} from '../lib/multiplayer'
import { colors, type } from '../theme'

const TAG_RANGE_M = 10
const HEAD_START_MS = 15000
const COUNTDOWN_MS = 5000
const TAG_HOLD_MS = 3000

// GPS is only good to ~5-15 m, so allow some of each player's reported error.
function tagAllowance(a, b) {
  return TAG_RANGE_M + Math.min(10, ((a?.acc ?? 10) + (b?.acc ?? 10)) / 2)
}

function initialState(roster, info, now) {
  const ids = roster.map((p) => p.id)
  const spider = shuffled(ids)[0]
  const players = {}
  for (const p of roster) players[p.id] = { name: p.username, spider: p.id === spider, taggedAt: null, taggedBy: null }
  return {
    game: 'spider',
    round: info.round,
    phase: 'countdown',
    startsAt: now + COUNTDOWN_MS,
    startedAt: now + COUNTDOWN_MS,
    tagOpensAt: now + COUNTDOWN_MS + HEAD_START_MS,
    endsAt: info.settings?.roundMinutes ? now + COUNTDOWN_MS + info.settings.roundMinutes * 60000 : null,
    tagging: {}, // spiderId -> { target, startedAt }
    initialCount: ids.length,
    players,
    winners: [],
    reason: null,
    feed: [{ id: `start-${now}`, text: `${players[spider].name} is the spider!` }],
  }
}

// Returns a new state if the round should end / needs fixing, else null.
function evaluate(state, presentIds, now) {
  if (state.phase === 'countdown') return now >= state.startsAt ? { ...state, phase: 'playing' } : null
  if (state.phase !== 'playing') return null
  const present = Object.keys(state.players).filter((id) => presentIds.has(id))
  const free = present.filter((id) => !state.players[id].spider)
  const spiders = present.filter((id) => state.players[id].spider)
  let next = null
  if (spiders.length === 0 && free.length >= 2) {
    const pick = shuffled(free)[0]
    next = {
      ...state,
      players: { ...state.players, [pick]: { ...state.players[pick], spider: true } },
      feed: [{ id: `respawn-${now}`, text: `The spider left. ${state.players[pick].name} is the new spider!` }, ...state.feed].slice(0, 8),
    }
    return next
  }
  const end = (winners, reason) => withMvp({ ...state, phase: 'ended', endedAt: now, winners, reason })
  if (state.endsAt && now >= state.endsAt) return end(free, 'time')
  if (state.initialCount >= 3 && free.length === 1) return end(free, 'last')
  if (free.length === 0) return end(spiders, 'all')
  if (present.length < 2) return end(present, 'left')
  return null
}

// Advance in-progress tags: break any that drifted out of range, land any
// that have been held for TAG_HOLD_MS. Returns { state, broken: [spiderId] }.
function processTagging(state, now, posOf, presentIds) {
  const tagging = state.tagging || {}
  if (!Object.keys(tagging).length) return { state, broken: [] }
  let players = state.players
  let feed = state.feed
  const nextTagging = {}
  const broken = []
  for (const spiderId of Object.keys(tagging)) {
    const { target, startedAt } = tagging[spiderId]
    const spider = players[spiderId]
    const victim = players[target]
    const a = posOf(spiderId)
    const b = posOf(target)
    const ok = spider?.spider && victim && !victim.spider && presentIds.has(spiderId) && presentIds.has(target) && a && b && distanceMeters(a, b) <= tagAllowance(a, b)
    if (!ok) { if (victim && !victim.spider) broken.push(spiderId); continue }
    if (now - startedAt >= TAG_HOLD_MS) {
      players = { ...players, [target]: { ...victim, spider: true, taggedAt: now, taggedBy: spiderId } }
      feed = [{ id: `tag-${target}-${now}`, text: `${spider.name} tagged ${victim.name}!` }, ...feed].slice(0, 8)
    } else {
      nextTagging[spiderId] = tagging[spiderId]
    }
  }
  // Drop attempts on anyone who just became a spider.
  for (const k of Object.keys(nextTagging)) if (players[nextTagging[k].target]?.spider) delete nextTagging[k]
  return { state: { ...state, players, feed, tagging: nextTagging }, broken }
}

// MVP: most tags; ties broken by surviving longest.
function withMvp(state) {
  const tags = {}
  for (const p of Object.values(state.players)) if (p.taggedBy) tags[p.taggedBy] = (tags[p.taggedBy] || 0) + 1
  const survived = (p) => (p.taggedAt || state.endedAt || Date.now()) - state.startedAt
  const ranked = Object.keys(state.players).sort((a, b) => ((tags[b] || 0) - (tags[a] || 0)) || (survived(state.players[b]) - survived(state.players[a])))
  return { ...state, tags, mvp: ranked[0] || null }
}

export function SpiderGame({ room, onExit }) {
  const snap = useRoomSnapshot(room)
  const positions = useRoomPositions(room)
  const now = useRoomClock(room, 200)
  const loc = useSharedLocation(room)
  const [notice, setNotice] = useState(null)
  const noticeTimer = useRef(null)

  const meId = snap?.me?.id
  const isHost = !!snap?.isHost
  const state = snap?.state?.game === 'spider' ? snap.state : null
  const info = snap?.info

  const flash = (text) => {
    setNotice(text)
    clearTimeout(noticeTimer.current)
    noticeTimer.current = setTimeout(() => setNotice(null), 3500)
  }
  useEffect(() => () => clearTimeout(noticeTimer.current), [])

  useEffect(() => {
    if (!room) return undefined
    return room.onMessage('notice', (data) => flash(String(data?.text || '')))
  }, [room])

  // Feedback when I get tagged.
  const amSpider = !!state?.players?.[meId]?.spider
  const wasSpider = useRef(amSpider)
  useEffect(() => {
    if (amSpider && !wasSpider.current && state?.players?.[meId]?.taggedBy) {
      buzz('error')
      flash('You were tagged! Now you’re a spider 🕷️')
    }
    wasSpider.current = amSpider
  }, [amSpider, state, meId])

  // Record result once the round ends.
  useEffect(() => {
    if (state?.phase === 'ended' && state.players?.[meId]) {
      recordRoundResult(room, { result: state.winners.includes(meId) ? 'win' : 'loss' })
    }
  }, [state?.phase, state?.winners, state?.players, room, meId])

  // ---- host logic ----
  const notify = (to, text) => {
    if (to === meId) flash(text)
    else room.send('notice', { text }, { to })
  }
  useHostLoop(room, isHost, {
    onTick: () => {
      const s = room.getState()
      const t = room.now()
      const roundNo = room.info.round || 0
      if (roundNo > 0 && (!s || s.game !== 'spider' || s.round !== roundNo)) {
        if (room.roster.length >= 1) room.publishState(initialState(room.roster, room.info, t))
        return
      }
      if (!s) return
      const presentIds = room.presentIds()
      let next = s
      if (s.phase === 'playing') {
        const r = processTagging(s, t, (id) => room.freshPosition(id), presentIds)
        next = r.state
        for (const spiderId of r.broken) notify(spiderId, 'Tag broken — they got out of range.')
      }
      next = evaluate(next, presentIds, t) || next
      if (next !== s) room.publishState(next)
    },
    onAction: (action, from) => {
      const s = room.getState()
      if (!s || s.game !== 'spider' || s.phase !== 'playing') return
      const t = room.now()
      if (action?.type === 'tag_cancel') {
        if (s.tagging?.[from]) {
          const { [from]: _gone, ...rest } = s.tagging
          room.publishState({ ...s, tagging: rest })
        }
        return
      }
      if (action?.type !== 'tag_start') return
      const target = action.target
      const tagger = s.players[from]
      const victim = s.players[target]
      if (!tagger?.spider || !victim || victim.spider) return
      if (t < s.tagOpensAt) { notify(from, 'Head start — you can tag in a moment.'); return }
      const a = room.freshPosition(from)
      const b = room.freshPosition(target)
      if (!a || !b) { notify(from, 'Waiting for both locations — try again.'); return }
      const d = distanceMeters(a, b)
      if (d > tagAllowance(a, b)) { notify(from, `Too far — ${formatDistance(d)} away. Get closer!`); return }
      room.publishState({ ...s, tagging: { ...(s.tagging || {}), [from]: { target, startedAt: t } } })
    },
  }, 300)

  const myPos = loc.coords
  const others = useMemo(() => {
    if (!state) return []
    return Object.keys(state.players)
      .filter((id) => id !== meId)
      .map((id) => {
        const p = positions?.[id]
        const fresh = p && Date.now() - p.at < 15000 ? p : null
        const d = fresh && myPos ? distanceMeters(myPos, fresh) : Infinity
        return {
          id,
          ...state.players[id],
          pos: fresh,
          distance: d,
          dir: fresh && myPos ? compassLabel(bearingDeg(myPos, fresh)) : null,
          present: (snap?.roster || []).some((r) => r.id === id),
        }
      })
      .sort((a, b) => a.distance - b.distance)
  }, [state, positions, myPos, meId, snap?.roster])

  // In-progress tags involving me (as spider or as victim).
  const myTagging = state?.tagging?.[meId] || null
  const tagOnMe = state ? Object.entries(state.tagging || {}).find(([, v]) => v.target === meId) : null
  const beingTagged = !!tagOnMe
  const wasBeingTagged = useRef(false)
  useEffect(() => {
    if (beingTagged && !wasBeingTagged.current) buzz('warning')
    wasBeingTagged.current = beingTagged
  }, [beingTagged])

  // ---- render ----
  if (!room || !snap) return null
  if (loc.status !== 'granted') return <LocationGate status={loc.status} onExit={onExit} what="Spider Spider 123" />
  if (!state) return <Spectating text="Starting…" />
  if (!state.players[meId]) return <Spectating />

  const avatarOf = (id) => snap.roster.find((r) => r.id === id)?.avatar

  if (state.phase === 'ended') {
    const iWon = state.winners.includes(meId)
    const reason = state.reason === 'time' ? 'Time’s up — the free players survived!'
      : state.reason === 'last' ? 'Last player standing!'
        : state.reason === 'all' ? 'The spiders caught everyone!'
          : 'Not enough players left.'
    return (
      <ScrollView contentContainerStyle={styles.pad}>
        <Text style={[type.display, { textAlign: 'center' }]}>{iWon ? 'You win! 🎉' : 'Round over'}</Text>
        <Text style={[type.body, { textAlign: 'center', marginVertical: 10 }]}>{reason}</Text>
        {state.mvp && state.players[state.mvp] && (
          <Card>
            <Text style={type.label}>MVP</Text>
            <PlayerTap player={{ id: state.mvp, username: state.players[state.mvp].name, avatar: avatarOf(state.mvp) }} style={styles.mvp}>
              <Avatar uri={avatarOf(state.mvp)} name={state.players[state.mvp].name} size={50} />
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Text style={type.title}>{state.players[state.mvp].name}</Text>
                <Text style={type.caption}>{state.tags?.[state.mvp] || 0} tags</Text>
              </View>
              <Text style={{ fontSize: 28 }}>⭐</Text>
            </PlayerTap>
          </Card>
        )}
        <Card>
          <Text style={[type.label, { marginBottom: 4 }]}>Winners</Text>
          {state.winners.length === 0 && <Text style={type.caption}>No one.</Text>}
          {state.winners.map((id) => (
            <PlayerRow key={id} player={{ id, username: state.players[id]?.name, avatar: avatarOf(id) }} right={<Pill text="WIN" color={colors.success} />} />
          ))}
        </Card>
        <Card>
          <Text style={[type.label, { marginBottom: 4 }]}>Everyone</Text>
          {Object.entries(state.players)
            .sort((a, b) => (b[1].taggedAt || Infinity) - (a[1].taggedAt || Infinity))
            .map(([id, p]) => (
              <PlayerRow
                key={id}
                player={{ id, username: p.name, avatar: avatarOf(id) }}
                subtitle={`${p.taggedBy ? `Tagged by ${state.players[p.taggedBy]?.name || 'someone'} at ${formatClock(p.taggedAt - state.startedAt)}` : p.spider ? 'Started as the spider' : 'Never caught'} · ${state.tags?.[id] || 0} tags`}
              />
            ))}
        </Card>
        {isHost
          ? <Btn title="Play again" variant="primary" onPress={() => room.setInfo({ round: (info.round || 0) + 1 })} />
          : <Text style={[type.caption, { textAlign: 'center' }]}>Waiting for the host to start another round…</Text>}
        <Btn title="Leave" onPress={onExit} style={{ marginTop: 12 }} />
      </ScrollView>
    )
  }

  if (state.phase === 'countdown') {
    return (
      <View style={[styles.countdown, { backgroundColor: amSpider ? colors.crimson : colors.success }]}>
        <Text style={styles.cdSmall}>{amSpider ? 'You start as the spider' : 'You’re free'}</Text>
        <Text style={styles.cdBig}>{Math.max(0, Math.ceil((state.startsAt - now) / 1000))}</Text>
        <Text style={styles.cdSmall}>{amSpider ? `Everyone gets a ${HEAD_START_MS / 1000}s head start, then hunt them down.` : 'Run! The spider can tag you after the head start.'}</Text>
      </View>
    )
  }

  const free = Object.values(state.players).filter((p) => !p.spider).length
  const headStart = Math.max(0, state.tagOpensAt - now)

  return (
    <ScrollView contentContainerStyle={styles.pad}>
      <View style={[styles.role, { backgroundColor: amSpider ? colors.crimson : colors.success }]}>
        <Text style={styles.roleTitle}>{amSpider ? '🕷️ You’re a spider' : '🏃 Run!'}</Text>
        <Text style={styles.roleSub}>
          {amSpider
            ? headStart > 0 ? `You can start tagging in ${Math.ceil(headStart / 1000)}s` : `Get within about ${Math.round(TAG_RANGE_M * 3.28)} ft, press Tag, and stay close for 3 seconds.`
            : 'Stay away from the spiders. A spider has to stay next to you for 3 seconds to tag you. Last one free wins.'}
        </Text>
      </View>

      <View style={styles.statsRow}>
        <Stat label={state.endsAt ? 'Time left' : 'Mode'} value={state.endsAt ? formatClock(state.endsAt - now) : 'Last one'} />
        <Stat label="Free" value={String(free)} />
        <Stat label="Spiders" value={String(Object.keys(state.players).length - free)} />
      </View>

      {beingTagged && (
        <View style={[styles.tagCard, { backgroundColor: colors.danger }]}>
          <ProgressRing size={84} progress={(now - tagOnMe[1].startedAt) / TAG_HOLD_MS} color={colors.onBrand} trackColor="rgba(255,255,255,0.3)">
            <Text style={{ fontSize: 30 }}>🕷️</Text>
          </ProgressRing>
          <View style={{ flex: 1, marginLeft: 14 }}>
            <Text style={styles.tagTitle}>You’re being tagged — run!</Text>
            <Text style={styles.tagSub}>{state.players[tagOnMe[0]]?.name} is on you. Get more than about {Math.round(TAG_RANGE_M * 3.28)} ft away to break it.</Text>
          </View>
        </View>
      )}
      {myTagging && (
        <View style={[styles.tagCard, { backgroundColor: colors.crimson }]}>
          <ProgressRing size={84} progress={(now - myTagging.startedAt) / TAG_HOLD_MS} color={colors.onBrand} trackColor="rgba(255,255,255,0.3)">
            <Text style={styles.tagPct}>{Math.min(100, Math.round(((now - myTagging.startedAt) / TAG_HOLD_MS) * 100))}%</Text>
          </ProgressRing>
          <View style={{ flex: 1, marginLeft: 14 }}>
            <Text style={styles.tagTitle}>Tagging {state.players[myTagging.target]?.name}…</Text>
            <Text style={styles.tagSub}>Stay close for {TAG_HOLD_MS / 1000} seconds.</Text>
            <Btn title="Cancel" size="sm" onPress={() => room.sendAction({ type: 'tag_cancel' })} style={{ marginTop: 8, alignSelf: 'flex-start' }} />
          </View>
        </View>
      )}
      {!!notice && <Card><Text style={type.body}>{notice}</Text></Card>}
      {myPos?.acc > 25 && <Text style={[type.caption, { marginBottom: 8 }]}>Your GPS signal is weak (±{Math.round(myPos.acc)} m). Move into the open for better accuracy.</Text>}

      <Card>
        <Text style={[type.label, { marginBottom: 4 }]}>Players</Text>
        {others.map((o) => {
          const canTag = amSpider && !o.spider && o.present && headStart === 0 && o.pos && myPos && o.distance <= tagAllowance(myPos, o.pos)
          return (
            <PlayerRow
              key={o.id}
              player={{ username: o.name, avatar: avatarOf(o.id) }}
              dim={!o.present}
              subtitle={!o.present ? 'Disconnected' : o.pos ? `${formatDistance(o.distance)} ${o.dir || ''} · ${o.spider ? 'spider' : 'free'}` : `No location yet · ${o.spider ? 'spider' : 'free'}`}
              right={amSpider && !o.spider
                ? myTagging?.target === o.id
                  ? <Pill text="TAGGING" color={colors.crimson} />
                  : <Btn title="Tag" size="sm" variant="primary" disabled={!canTag} onPress={() => { buzz('medium'); room.sendAction({ type: 'tag_start', target: o.id }) }} />
                : o.spider ? <Text style={{ fontSize: 20 }}>🕷️</Text> : null}
            />
          )
        })}
      </Card>

      {state.feed.length > 0 && (
        <Card>
          {state.feed.map((f) => <Text key={f.id} style={[type.caption, { marginVertical: 2 }]}>{f.text}</Text>)}
        </Card>
      )}
    </ScrollView>
  )
}

function Stat({ label, value }) {
  return (
    <Card style={{ flex: 1, marginHorizontal: 4 }} padding={10}>
      <Text style={type.label}>{label}</Text>
      <Text style={type.title}>{value}</Text>
    </Card>
  )
}

const styles = StyleSheet.create({
  pad: { padding: 12, paddingBottom: 40 },
  tagCard: { flexDirection: 'row', alignItems: 'center', borderRadius: 16, padding: 14, marginBottom: 12 },
  tagTitle: { ...type.title, color: colors.onBrand },
  tagSub: { ...type.caption, color: colors.onBrandMuted, marginTop: 4 },
  tagPct: { ...type.body, fontWeight: '800', color: colors.onBrand },
  role: { borderRadius: 16, padding: 16, marginBottom: 12 },
  roleTitle: { ...type.title, color: colors.onBrand },
  roleSub: { ...type.caption, color: colors.onBrandMuted, marginTop: 4 },
  statsRow: { flexDirection: 'row', marginHorizontal: -4 },
  mvp: { flexDirection: 'row', alignItems: 'center', marginTop: 8 },
  countdown: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28 },
  cdSmall: { ...type.body, color: colors.onBrand, textAlign: 'center' },
  cdBig: { fontSize: 96, fontWeight: '800', color: colors.onBrand },
})
