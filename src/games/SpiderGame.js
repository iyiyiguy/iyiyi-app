// Spider Spider 123 — real-world tag over GPS.
// Host-authoritative: the host picks the first spider. A tag only lands if the
// spider stays within range of the victim for 3 seconds straight (checked by
// the host against both players' shared positions); walking out of range
// breaks it. Tagged players become spiders; the last free player wins. The
// round timer is optional (off by default).
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { StyleSheet, Text, View, useWindowDimensions } from 'react-native'
import { formatClock } from './MultiplayerUI'
import { buzz } from '../lib/gamePrefs'
import {
  bearingDeg, compassLabel, distanceMeters, formatDistance, offsetMeters, recordRoundResult, shuffled,
  useHostLoop, useRoomClock, useRoomPositions, useRoomSnapshot, useSharedLocation,
} from '../lib/multiplayer'
import { FONT, ST, StButton, stGlow, stType, useStudioFonts, withAlpha } from './studio'
import {
  StBanner, StFeed, StHero, StLocationGate, StMvp, StPlayerRow, StResultsFooter, StReveal, StRing,
  StScreen, StSection, StSpectating, StStats, StTag,
} from './beside/studioKit'

const TAG_RANGE_M = 10
const HEAD_START_MS = 15000
const COUNTDOWN_MS = 5000
const TAG_HOLD_MS = 3000
// A tag in progress only breaks once the pair is clearly apart: GPS fixes jump a few
// metres between samples, so one noisy reading at the edge shouldn't cancel it.
const BREAK_MARGIN_M = 3
// A tag in progress survives a short GPS dropout; it can't land without fresh fixes.
const NO_FIX_GRACE_MS = 4000

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
  if (spiders.length === 0 && free.length >= 2) {
    const pick = shuffled(free)[0]
    return {
      ...state,
      players: { ...state.players, [pick]: { ...state.players[pick], spider: true } },
      feed: [{ id: `respawn-${now}`, text: `The spider left. ${state.players[pick].name} is the new spider!` }, ...state.feed].slice(0, 8),
    }
  }
  const end = (winners, reason) => withMvp({ ...state, phase: 'ended', endedAt: now, winners, reason, tagging: {} })
  if (state.endsAt && now >= state.endsAt) return end(free, 'time')
  if (state.initialCount >= 3 && free.length === 1) return end(free, 'last')
  if (free.length === 0) {
    // Everyone got caught: the hunters win (whoever made a tag, plus the starting
    // spider), not the player who was tagged last a moment ago.
    const tagged = new Set(Object.values(state.players).map((p) => p.taggedBy).filter(Boolean))
    const hunters = spiders.filter((id) => tagged.has(id) || !state.players[id].taggedBy)
    return end(hunters.length ? hunters : spiders, 'all')
  }
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
    if (!spider?.spider || !victim || victim.spider) continue // stale attempt, drop silently
    if (!presentIds.has(spiderId) || !presentIds.has(target)) { broken.push(spiderId); continue }
    const a = posOf(spiderId)
    const b = posOf(target)
    if (!a || !b) {
      // No fresh fix for one of them: hold the attempt briefly, never land it blind.
      if (now - startedAt > TAG_HOLD_MS + NO_FIX_GRACE_MS) broken.push(spiderId)
      else nextTagging[spiderId] = tagging[spiderId]
      continue
    }
    const d = distanceMeters(a, b)
    if (d > tagAllowance(a, b) + BREAK_MARGIN_M) { broken.push(spiderId); continue }
    if (now - startedAt >= TAG_HOLD_MS && d <= tagAllowance(a, b)) {
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

// Host check for a tag_start action. Returns { state } or { notice }.
function startTag(s, from, target, t, posOf) {
  const tagger = s.players[from]
  const victim = s.players[target]
  if (!tagger?.spider || !victim || victim.spider || target === from) return {}
  if (t < s.tagOpensAt) return { notice: 'Head start — you can tag in a moment.' }
  const a = posOf(from)
  const b = posOf(target)
  if (!a || !b) return { notice: 'Waiting for both locations — try again.' }
  const d = distanceMeters(a, b)
  if (d > tagAllowance(a, b)) return { notice: `Too far — ${formatDistance(d)} away. Get closer!` }
  if (s.tagging?.[from]?.target === target) return {}
  return { state: { ...s, tagging: { ...(s.tagging || {}), [from]: { target, startedAt: t } } } }
}

// MVP: most tags; ties broken by surviving longest.
function withMvp(state) {
  const tags = {}
  for (const p of Object.values(state.players)) if (p.taggedBy) tags[p.taggedBy] = (tags[p.taggedBy] || 0) + 1
  const survived = (p) => (p.taggedAt || state.endedAt || Date.now()) - state.startedAt
  const ranked = Object.keys(state.players).sort((a, b) => ((tags[b] || 0) - (tags[a] || 0)) || (survived(state.players[b]) - survived(state.players[a])))
  return { ...state, tags, mvp: ranked[0] || null }
}

// Pure rules, exported for headless tests.
export const spiderEngine = { initialState, evaluate, processTagging, startTag, tagAllowance, TAG_RANGE_M, TAG_HOLD_MS, BREAK_MARGIN_M }

const roleColor = (spider) => (spider ? ST.enemy : ST.friendly)

export function SpiderGame({ room, onExit }) {
  useStudioFonts()
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
      flash('You were tagged. Now you’re a spider — go catch someone.')
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
      const r = startTag(s, from, action.target, t, (id) => room.freshPosition(id))
      if (r.notice) notify(from, r.notice)
      if (r.state) room.publishState(r.state)
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
  if (loc.status !== 'granted') return <StLocationGate status={loc.status} onExit={onExit} what="Spider Spider 123" />
  if (!state) return <StSpectating title="Starting" text="Picking the first spider…" />
  if (!state.players[meId]) return <StSpectating />

  const avatarOf = (id) => snap.roster.find((r) => r.id === id)?.avatar
  const nameOf = (id) => state.players[id]?.name || 'someone'
  const ft = Math.round(TAG_RANGE_M * 3.28)

  if (state.phase === 'ended') {
    const iWon = state.winners.includes(meId)
    const reason = state.reason === 'time' ? 'Time’s up — the free players survived'
      : state.reason === 'last' ? 'Last player standing'
        : state.reason === 'all' ? 'The spiders caught everyone'
          : 'Not enough players left'
    const mine = state.players[meId]
    const myTags = state.tags?.[meId] || 0
    const survivedMs = Math.max(0, (mine.taggedAt || state.endedAt || now) - state.startedAt)
    const caught = Object.values(state.players).filter((p) => p.taggedBy).length
    const rows = Object.entries(state.players)
      .sort((a, b) => (b[1].taggedAt || Infinity) - (a[1].taggedAt || Infinity))
    return (
      <StScreen>
        <StHero
          kicker={`Spider Spider 123 · ${reason}`}
          title={iWon ? 'Victory' : mine.spider && mine.taggedBy ? 'Caught' : 'Round over'}
          sub={iWon ? 'You’re on the winning side.' : state.winners.length ? `${state.winners.map(nameOf).join(', ')} won.` : 'No winner this round.'}
          color={iWon ? ST.health : ST.enemy}
          big
        />
        <StStats items={[
          { label: 'Your tags', value: String(myTags), color: myTags ? ST.enemy : ST.text },
          { label: mine.taggedBy ? 'Free for' : 'Survived', value: formatClock(survivedMs) },
          { label: 'Caught', value: `${caught}/${Math.max(0, Object.keys(state.players).length - 1)}` },
        ]} />
        {state.mvp && state.players[state.mvp] ? (
          <StMvp
            player={{ id: state.mvp, username: state.players[state.mvp].name, avatar: avatarOf(state.mvp) }}
            line={`${state.tags?.[state.mvp] || 0} tag${state.tags?.[state.mvp] === 1 ? '' : 's'}`}
          />
        ) : null}
        <StSection label="Played with · follow on iYiYi">
          {rows.map(([id, p]) => (
            <StPlayerRow
              key={id}
              player={{ id, username: id === meId ? `${p.name} (you)` : p.name, avatar: avatarOf(id) }}
              color={roleColor(p.spider)}
              subtitle={`${p.taggedBy ? `Tagged by ${nameOf(p.taggedBy)} at ${formatClock(p.taggedAt - state.startedAt)}` : p.spider ? 'Started as the spider' : 'Never caught'} · ${state.tags?.[id] || 0} tags`}
              right={state.winners.includes(id) ? <StTag text="Win" color={ST.health} /> : null}
            />
          ))}
        </StSection>
        <StResultsFooter isHost={isHost} onAgain={() => room.setInfo({ round: (info.round || 0) + 1 })} onExit={onExit} />
      </StScreen>
    )
  }

  if (state.phase === 'countdown') {
    return (
      <StReveal
        kicker="Spider Spider 123 · you are"
        title={amSpider ? 'The spider' : 'Free'}
        color={roleColor(amSpider)}
        icon={amSpider ? 'bug-outline' : 'walk-outline'}
        body={amSpider
          ? `Everyone gets a ${HEAD_START_MS / 1000} s head start. Then get within about ${ft} ft of someone and stay there for 3 seconds to tag them.`
          : 'Run. After the head start a spider has to stay next to you for 3 seconds to tag you. Last one free wins.'}
        count={Math.max(0, Math.ceil((state.startsAt - now) / 1000))}
      />
    )
  }

  const presentIds = new Set((snap.roster || []).map((r) => r.id))
  const freeLeft = Object.keys(state.players).filter((id) => !state.players[id].spider && presentIds.has(id)).length
  const spiderCount = Object.keys(state.players).filter((id) => state.players[id].spider && presentIds.has(id)).length
  const headStart = Math.max(0, state.tagOpensAt - now)
  const myColor = roleColor(amSpider)
  const holdOf = (t) => Math.min(TAG_HOLD_MS, Math.max(0, now - t.startedAt))

  return (
    <StScreen>
      <StHero
        kicker={`Spider Spider 123 · ${amSpider ? 'you are a spider' : 'you are free'}`}
        title={state.endsAt ? formatClock(state.endsAt - now) : formatClock(now - state.startedAt)}
        sub={`${freeLeft} free player${freeLeft === 1 ? '' : 's'} left · ${spiderCount} spider${spiderCount === 1 ? '' : 's'}`}
        color={myColor}
      />

      {headStart > 0 ? (
        <StBanner
          icon="timer-outline"
          color={ST.objective}
          text={amSpider ? `Head start · you can tag in ${Math.ceil(headStart / 1000)} s` : `Head start · ${Math.ceil(headStart / 1000)} s to get away`}
        />
      ) : null}

      {beingTagged ? (
        <View style={[styles.tagCard, { backgroundColor: withAlpha(ST.enemy, 0.16), borderColor: ST.enemy }]}>
          <StRing size={84} color={ST.enemy} progress={holdOf(tagOnMe[1]) / TAG_HOLD_MS} value={(holdOf(tagOnMe[1]) / 1000).toFixed(1)} unit="of 3 s" />
          <View style={{ flex: 1, marginLeft: 14 }}>
            <Text style={[stType.label, { color: ST.enemy }]}>Being tagged</Text>
            <Text style={[stType.name, { fontSize: 18 }]} numberOfLines={1}>Run · {nameOf(tagOnMe[0])} is on you</Text>
            <Text style={[stType.small, { marginTop: 2 }]}>Get more than about {ft} ft away to break it.</Text>
          </View>
        </View>
      ) : null}

      <Radar me={myPos} amSpider={amSpider} others={others.filter((o) => o.present && o.pos)} focusId={myTagging?.target || tagOnMe?.[0]} />

      {myTagging ? (
        <View style={styles.tagCenter}>
          <StRing size={96} color={ST.enemy} progress={holdOf(myTagging) / TAG_HOLD_MS} value={(holdOf(myTagging) / 1000).toFixed(1)} unit="of 3 s" />
          <Text style={[stType.name, { letterSpacing: 1, marginTop: 8, textTransform: 'uppercase', textAlign: 'center' }]} numberOfLines={1}>
            Tagging {nameOf(myTagging.target)} · stay close
          </Text>
          <StButton title="Cancel tag" tone="ghost" height={38} onPress={() => room.sendAction({ type: 'tag_cancel' })} style={{ marginTop: 8, minWidth: 150 }} />
        </View>
      ) : null}

      <Text style={[stType.small, { textAlign: 'center', marginBottom: 10 }]}>
        {myPos ? `GPS ±${Math.round(myPos.acc ?? 10)} m · the host confirms every tag` : 'Waiting for GPS…'}
        {myPos?.acc > 25 ? ' · weak signal, move into the open' : ''}
      </Text>

      {!!notice && <StBanner text={notice} color={ST.objective} icon="information-circle-outline" />}

      <StSection label="Players" right={amSpider ? `Tag range ~${ft} ft` : 'Nearest first'}>
        {others.map((o) => {
          const canTag = amSpider && !o.spider && o.present && headStart === 0 && o.pos && myPos && o.distance <= tagAllowance(myPos, o.pos)
          const status = o.spider ? 'Spider' : 'Free'
          return (
            <StPlayerRow
              key={o.id}
              player={{ id: o.id, username: o.name, avatar: avatarOf(o.id) }}
              color={roleColor(o.spider)}
              dim={!o.present}
              subtitle={!o.present ? 'Disconnected' : o.pos ? `${status} · ${formatDistance(o.distance)} ${o.dir || ''}` : `${status} · no location yet`}
              subtitleColor={o.present && o.spider && !amSpider && o.distance < 30 ? ST.enemy : undefined}
              right={amSpider && !o.spider && o.present
                ? myTagging?.target === o.id
                  ? <StTag text="Tagging" color={ST.enemy} solid />
                  : <StButton title="Tag" tone="danger" height={34} disabled={!canTag} style={{ minWidth: 64, paddingHorizontal: 10 }} onPress={() => { buzz('medium'); room.sendAction({ type: 'tag_start', target: o.id }) }} />
                : null}
            />
          )
        })}
        {others.length === 0 ? <Text style={stType.small}>No one else is here.</Text> : null}
      </StSection>

      <StFeed items={state.feed} />
    </StScreen>
  )
}

// North-up radar around me: free players are friendly dots, spiders enemy diamonds, the
// red circle is the tag range. Outer ring = RADAR_M; anyone further sits on the edge.
const RADAR_M = 50
function Radar({ me, amSpider, others, focusId }) {
  const { width } = useWindowDimensions()
  const size = Math.max(200, Math.min(width - 48, 300))
  const r = size / 2
  const px = (m) => (m / RADAR_M) * r
  const tagR = px(TAG_RANGE_M + Math.min(10, me?.acc ?? 10))
  const nearestLabel = others.find((o) => (amSpider ? !o.spider : o.spider))
  const meColor = amSpider ? ST.enemy : ST.friendly
  return (
    <View style={[styles.radarWrap, { height: size + 8 }]} accessibilityLabel={`Radar: ${others.length} players nearby`}>
      <View style={{ width: size, height: size }}>
        <View style={[styles.ring, { width: size, height: size, borderRadius: r, borderColor: 'rgba(255,255,255,0.2)' }]} />
        <View style={[styles.ring, { left: r / 2, top: r / 2, width: r, height: r, borderRadius: r / 2, borderColor: 'rgba(255,255,255,0.12)' }]} />
        <View style={[styles.ring, { left: r - tagR, top: r - tagR, width: tagR * 2, height: tagR * 2, borderRadius: tagR, borderWidth: 2, borderColor: ST.enemy, backgroundColor: withAlpha(ST.enemy, 0.1) }]} />
        <Text style={[stType.label, styles.north]}>N</Text>
        <Text style={[stType.label, { position: 'absolute', right: 4, top: r - 7, fontSize: 9 }]}>{formatDistance(RADAR_M)}</Text>
        {me ? others.map((o) => {
          const { x, y } = offsetMeters(me, o.pos)
          const d = Math.hypot(x, y)
          const k = d > RADAR_M ? RADAR_M / d : 1
          const cx = r + px(x * k)
          const cy = r - px(y * k)
          const focus = o.id === focusId || o.id === nearestLabel?.id
          const c = roleColor(o.spider)
          const dot = o.spider ? 12 : 11
          return (
            <View key={o.id} style={[styles.blip, { top: cy - dot / 2 }, cx > r ? { right: size - cx - dot / 2, flexDirection: 'row-reverse' } : { left: cx - dot / 2 }]} pointerEvents="none">
              <View style={[
                { width: dot, height: dot, backgroundColor: c },
                o.spider ? { transform: [{ rotate: '45deg' }] } : { borderRadius: dot / 2 },
                focus && stGlow(c, 10),
                d > RADAR_M && { opacity: 0.55 },
              ]} />
              {focus ? <Text style={[styles.blipLabel, cx > r ? { marginRight: 6 } : { marginLeft: 6 }]} numberOfLines={1}>{`${o.name} · ${formatDistance(o.distance)}`.toUpperCase()}</Text> : null}
            </View>
          )
        }) : null}
        <View style={[styles.me, { left: r - 9, top: r - 9, backgroundColor: meColor }, amSpider ? { transform: [{ rotate: '45deg' }] } : { borderRadius: 9 }]} />
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  tagCard: { flexDirection: 'row', alignItems: 'center', padding: 12, marginBottom: 10, borderWidth: 1, borderRadius: ST.radius },
  tagCenter: { alignItems: 'center', marginBottom: 8 },
  radarWrap: { alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  ring: { position: 'absolute', borderWidth: 1 },
  north: { position: 'absolute', top: 4, alignSelf: 'center', left: 0, right: 0, textAlign: 'center' },
  blip: { position: 'absolute', flexDirection: 'row', alignItems: 'center' },
  blipLabel: { paddingHorizontal: 5, fontFamily: FONT.ui, fontSize: 11, color: ST.text, backgroundColor: 'rgba(8,10,14,0.8)', maxWidth: 140 },
  me: { position: 'absolute', width: 18, height: 18 },
})
