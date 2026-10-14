// Mafia — social deduction party game (5–15 players).
//
// Night/Day cycle. Roles: Town, Mafia (1–3), Doctor, Detective.
// Night: Mafia picks a target, Doctor picks someone to save, Detective
// investigates one player. Day: discuss and vote to eliminate.
// Town wins when all Mafia are eliminated; Mafia wins when they equal Town.
// Host-authoritative: the host drives the game state machine and holds the
// secret role assignments.
//
// Rules (standard Mafia / Werewolf):
// - Mafia know each other (the role message carries `team`) and can't target Mafia.
//   With several Mafia the most-chosen target dies; a split vote is settled at random.
// - The Doctor may save anyone, themselves included, but not the same player two
//   nights running.
// - The Detective gets one private result per night (sent only to them).
// - Day vote: most votes is eliminated; a tie, or Skip on top, eliminates no one.
// - Dead players can't act or vote. The night ends early once every night role is in.
// - Host migration: the new host asks everyone for their role ("whois" / "iam") and
//   carries on; if it can't recover every living player's role the round is void.
import React, { useEffect, useRef, useState } from 'react'
import { Image, Pressable, StyleSheet, Text, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { formatClock } from './MultiplayerUI'
import {
  recordRoundResult,
  useHostLoop, useRoomClock, useRoomSnapshot, useSharedLocation,
} from '../lib/multiplayer'
import { buzz } from '../lib/gamePrefs'
import { ST, StButton, stType, useStudioFonts, withAlpha } from './studio'
import {
  StBanner, StFeed, StGrid, StHero, StPlayerRow, StPlayerTile, StResultsFooter, StScreen, StSection,
  StSpectating, StStats, StTag,
} from './beside/studioKit'

// ─── Character art ────────────────────────────────────────────────────────────
const CHAR_IMAGES = {
  town: require('../../assets/mafia-characters/townsperson.png'),
  mafia: require('../../assets/mafia-characters/mafia.png'),
  doctor: require('../../assets/mafia-characters/doctor.png'),
  detective: require('../../assets/mafia-characters/detective.png'),
}

// ─── Role config ──────────────────────────────────────────────────────────────
const ROLES = {
  town: { label: 'Townsperson', color: ST.friendly, icon: 'people-outline', desc: 'Find and vote out the Mafia.', image: CHAR_IMAGES.town },
  mafia: { label: 'Mafia', color: ST.enemy, icon: 'skull-outline', desc: 'Eliminate the Town without getting caught.', image: CHAR_IMAGES.mafia },
  doctor: { label: 'Doctor', color: ST.health, icon: 'medkit-outline', desc: 'Each night, choose someone to protect.', image: CHAR_IMAGES.doctor },
  detective: { label: 'Detective', color: ST.objective, icon: 'search-outline', desc: 'Each night, investigate one player.', image: CHAR_IMAGES.detective },
}

// ─── Timing ───────────────────────────────────────────────────────────────────
const COUNTDOWN_MS = 5000
const NIGHT_MS = 30000
const DISCUSS_MS = 60000
const VOTE_MS = 30000
const NIGHT_GRACE_MS = 3000 // once every night role has acted
const RECOVER_MS = 8000 // host migration: how long to wait for role claims

function shuffled(arr) {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]] }
  return a
}

// ─── Engine (pure; `sec` is the host-only secret, mutated in place) ───────────
function assignRoles(roster, shuffle = shuffled) {
  const ids = shuffle(roster.map((p) => p.id))
  const n = ids.length
  const mafiaCount = n >= 10 ? 3 : n >= 7 ? 2 : 1
  const roles = {}
  let i = 0
  for (let m = 0; m < mafiaCount && i < n; m++) roles[ids[i++]] = 'mafia'
  if (n >= 5) roles[ids[i++]] = 'doctor'
  if (n >= 6) roles[ids[i++]] = 'detective'
  while (i < n) roles[ids[i++]] = 'town'
  return roles
}

function initialState(roster, info, now) {
  const players = {}
  for (const p of roster) players[p.id] = { name: p.username, alive: true, eliminated: false }
  return {
    game: 'mafia',
    round: info.round,
    phase: 'countdown',
    startsAt: now + COUNTDOWN_MS,
    dayNumber: 0,
    players,
    // Night actions live in the host's secret, never in the shared state.
    nightResult: null, // { killed: id | null, saved: bool }
    investigateResult: null, // unused: results go privately to the detective
    votes: {},
    voteResult: null, // { eliminated: id | null }
    discussUntil: 0,
    voteUntil: 0,
    nightUntil: 0,
    feed: [],
    winner: null,
  }
}

function newSecret(round, roles) {
  return { round, roles, mafiaTarget: null, doctorTarget: null, detectiveTarget: null, mafiaVotes: {}, lastDoctorTarget: null }
}

const mafiaTeam = (roles) => Object.keys(roles).filter((id) => roles[id] === 'mafia')
const roleMessage = (sec, id) => {
  const role = sec.roles[id] || 'town'
  return role === 'mafia' ? { round: sec.round, role, team: mafiaTeam(sec.roles) } : { round: sec.round, role }
}

function checkWin(players, roles) {
  const mafia = Object.keys(players).filter((id) => players[id].alive && roles[id] === 'mafia').length
  const town = Object.keys(players).filter((id) => players[id].alive && roles[id] !== 'mafia').length
  if (mafia === 0) return 'town'
  if (mafia >= town) return 'mafia'
  return null
}

const endState = (s, players, sec, extra) => ({ ...s, ...extra, phase: 'ended', players, winner: checkWin(players, sec.roles), roles: { ...sec.roles } })

function startNight(s, sec, t, extra = {}) {
  sec.mafiaTarget = null
  sec.doctorTarget = null
  sec.detectiveTarget = null
  sec.mafiaVotes = {}
  return { ...s, ...extra, phase: 'night', nightUntil: t + NIGHT_MS, nightResult: null, investigateResult: null, votes: {} }
}

// Mafia's choice: most-voted target among the living Mafia; a split is settled at random.
function mafiaChoice(s, sec, shuffle = shuffled) {
  const tally = {}
  for (const m of Object.keys(sec.mafiaVotes)) {
    const v = sec.mafiaVotes[m]
    if (!s.players[m]?.alive || !s.players[v]?.alive) continue
    tally[v] = (tally[v] || 0) + 1
  }
  const best = Math.max(0, ...Object.values(tally))
  const top = Object.keys(tally).filter((id) => tally[id] === best)
  return top.length ? shuffle(top)[0] : null
}

// Night action from `from`. Returns a list of private replies [{ to, type, data }].
function nightAction(s, sec, action, from) {
  const replies = []
  const say = (to, text) => replies.push({ to, type: 'notice', data: { text } })
  const role = sec.roles[from]
  const target = action?.target
  if (s.phase !== 'night' || !s.players[from]?.alive) return replies
  const victim = s.players[target]
  if (!victim?.alive) return replies
  if (action.type === 'mafia_target' && role === 'mafia') {
    if (sec.roles[target] === 'mafia') { say(from, 'That’s one of your own.'); return replies }
    sec.mafiaVotes[from] = target
    sec.mafiaTarget = mafiaChoice(s, sec, (a) => a) // provisional (deterministic) until dawn
    say(from, `Target locked: ${victim.name}`)
    for (const m of mafiaTeam(sec.roles)) {
      if (m !== from && s.players[m]?.alive) say(m, `${s.players[from].name} wants ${victim.name}.`)
    }
  } else if (action.type === 'doctor_save' && role === 'doctor') {
    if (target === sec.lastDoctorTarget) { say(from, `You protected ${victim.name} last night — choose someone else.`); return replies }
    sec.doctorTarget = target
    say(from, `Protecting ${victim.name} tonight.`)
  } else if (action.type === 'detective_investigate' && role === 'detective') {
    if (target === from) return replies
    if (sec.detectiveTarget) { say(from, 'You’ve already investigated someone tonight.'); return replies }
    sec.detectiveTarget = target
    replies.push({ to: from, type: 'investigate', data: { target, name: victim.name, isMafia: sec.roles[target] === 'mafia', day: s.dayNumber } })
  }
  return replies
}

// True once every living, present night role has acted.
function nightComplete(s, sec, presentIds) {
  const live = Object.keys(s.players).filter((id) => s.players[id].alive && presentIds.has(id))
  return live.every((id) => {
    const r = sec.roles[id]
    if (r === 'mafia') return !!sec.mafiaVotes[id]
    if (r === 'doctor') return !!sec.doctorTarget
    if (r === 'detective') return !!sec.detectiveTarget
    return true
  })
}

function resolveNight(s, sec, t, shuffle = shuffled) {
  const target = mafiaChoice(s, sec, shuffle)
  const saved = !!target && sec.doctorTarget === target
  const killed = target && !saved ? target : null
  sec.lastDoctorTarget = sec.doctorTarget
  const players = { ...s.players }
  const feed = [...s.feed]
  if (killed) {
    players[killed] = { ...players[killed], alive: false, eliminated: true }
    feed.unshift({ id: `kill-${s.dayNumber}`, text: `Day ${s.dayNumber}: ${players[killed].name} was found eliminated.` })
  } else {
    feed.unshift({ id: `safe-${s.dayNumber}`, text: `Day ${s.dayNumber}: No one was eliminated last night.` })
  }
  const nightResult = { killed, saved }
  if (checkWin(players, sec.roles)) return endState(s, players, sec, { feed: feed.slice(0, 20), nightResult })
  return {
    ...s, phase: 'discuss', players, dayNumber: s.dayNumber,
    nightResult, discussUntil: t + DISCUSS_MS, votes: {}, voteResult: null,
    feed: feed.slice(0, 20),
  }
}

// Validate and record a day vote. Returns the new state or null.
function castVote(s, action, from) {
  if (s.phase !== 'vote' || !s.players[from]?.alive || s.votes[from] !== undefined) return null
  const target = action?.target
  if (target !== 'skip' && !s.players[target]?.alive) return null
  return { ...s, votes: { ...s.votes, [from]: target } }
}

const allVoted = (s, presentIds) => Object.keys(s.players)
  .filter((id) => s.players[id].alive && presentIds.has(id))
  .every((id) => s.votes[id] !== undefined)

// Plurality: the most-voted player is out unless that's tied or Skip has as many votes.
function resolveVote(s, sec, t) {
  const tally = {}
  let skip = 0
  for (const voter of Object.keys(s.votes)) {
    if (!s.players[voter]?.alive) continue
    const v = s.votes[voter]
    if (v === 'skip') skip += 1
    else if (s.players[v]?.alive) tally[v] = (tally[v] || 0) + 1
  }
  const sorted = Object.entries(tally).sort((a, b) => b[1] - a[1])
  const top = sorted[0]
  const tie = !!top && sorted.length > 1 && sorted[1][1] === top[1]
  const eliminated = top && !tie && top[1] > skip ? top[0] : null
  const players = { ...s.players }
  const feed = [...s.feed]
  if (eliminated) {
    players[eliminated] = { ...players[eliminated], alive: false, eliminated: true }
    feed.unshift({ id: `vote-${s.dayNumber}`, text: `${players[eliminated].name} was voted out. They were ${ROLES[sec.roles[eliminated]]?.label || 'Town'}.` })
  } else {
    feed.unshift({ id: `novote-${s.dayNumber}`, text: `No one was voted out${tie ? ' (tie)' : top && skip >= top[1] ? ' (skipped)' : ''}.` })
  }
  const voteResult = { eliminated, tally, skip }
  if (checkWin(players, sec.roles)) return endState(s, players, sec, { voteResult, feed: feed.slice(0, 20) })
  return startNight({ ...s, players, voteResult, feed: feed.slice(0, 20) }, sec, t, { dayNumber: s.dayNumber + 1 })
}

// Host migration: rebuild the secret from role claims ({ id: { role, team } }).
// Returns { sec } when every living present player has claimed, else null.
function recoverSecret(s, claims, presentIds) {
  const living = Object.keys(s.players).filter((id) => s.players[id].alive && presentIds.has(id))
  if (!living.every((id) => claims[id])) return null
  const roles = {}
  for (const id of Object.keys(s.players)) roles[id] = claims[id]?.role || 'town'
  // Mafia know their team, so an absent Mafia player is still known.
  for (const c of Object.values(claims)) if (c.role === 'mafia') for (const m of c.team || []) if (s.players[m]) roles[m] = 'mafia'
  return newSecret(s.round, roles)
}

// Pure rules, exported for headless tests.
export const mafiaEngine = {
  assignRoles, initialState, newSecret, roleMessage, checkWin, startNight, nightAction, nightComplete,
  resolveNight, castVote, allVoted, resolveVote, recoverSecret, mafiaChoice,
}

// ─── Component ────────────────────────────────────────────────────────────────
export function MafiaGame({ room, onExit }) {
  useStudioFonts()
  const snap = useRoomSnapshot(room)
  const now = useRoomClock(room, 500)
  useSharedLocation(room) // share GPS so nearby invite + proximity features work
  const [myRole, setMyRole] = useState(null) // { round, role, team }
  const [peek, setPeek] = useState(false)
  const [investigations, setInvestigations] = useState([]) // detective only: [{ round, day, target, name, isMafia }]
  const [pick, setPick] = useState(null) // { key, id } local selection on the current screen
  const [locked, setLocked] = useState(null) // { key, id } what I sent this phase
  const [lastSave, setLastSave] = useState(null) // doctor: { round, day, id }
  const [notice, setNotice] = useState(null)
  const noticeTimer = useRef(null)
  const secret = useRef(null) // host only
  const claims = useRef({ round: null, roles: {}, since: 0 }) // host only, after migration
  const lastRoleReq = useRef(0)

  const meId = snap?.me?.id
  const isHost = !!snap?.isHost
  const state = snap?.state?.game === 'mafia' ? snap.state : null
  const round = state?.round
  const roleInfo = myRole && myRole.round === round ? myRole : null
  const roleKnown = roleInfo?.role || null

  const flash = (text) => {
    setNotice(text)
    clearTimeout(noticeTimer.current)
    noticeTimer.current = setTimeout(() => setNotice(null), 5000)
  }
  useEffect(() => () => clearTimeout(noticeTimer.current), [])

  // ── Messages ──
  useEffect(() => {
    if (!room) return undefined
    const offs = [
      room.onMessage('role', (d) => {
        if (d && typeof d.round === 'number' && ROLES[d.role]) setMyRole({ round: d.round, role: d.role, team: Array.isArray(d.team) ? d.team : null })
      }),
      room.onMessage('notice', (d) => { buzz('warning'); flash(String(d?.text || '')) }),
      room.onMessage('investigate', (d) => {
        if (d && typeof d.target === 'string') {
          buzz('select')
          setInvestigations((list) => [{ round: room.getState()?.round, day: d.day ?? room.getState()?.dayNumber, target: d.target, name: d.name, isMafia: !!d.isMafia }, ...list.filter((x) => !(x.target === d.target && x.round === room.getState()?.round))])
        }
      }),
    ]
    return () => offs.forEach((off) => off())
  }, [room])

  // Answer a new host's "whois" after host migration.
  useEffect(() => {
    if (!room) return undefined
    return room.onMessage('whois', (d, from) => {
      if (roleInfo && d?.round === round) room.send('iam', { round, role: roleInfo.role, team: roleInfo.team || null }, { to: from })
    })
  }, [room, roleInfo, round])

  // Missed the role message (slow join / reconnect): ask the host again.
  useEffect(() => {
    if (!room || !state || roleKnown || !state.players[meId] || isHost) return
    const t = Date.now()
    if (t - lastRoleReq.current > 3000) {
      lastRoleReq.current = t
      room.send('role_req', { round }, { to: snap.hostId })
    }
  }, [room, state, roleKnown, meId, isHost, round, snap?.hostId, now])

  useEffect(() => {
    setPeek(false)
    setInvestigations((list) => list.filter((x) => x.round === round))
  }, [round])

  // New phase: clear the local selection.
  const phaseKey = state ? `${state.round}-${state.phase}-${state.dayNumber}` : ''
  useEffect(() => { setPick(null); setLocked(null) }, [phaseKey])

  // Record result
  useEffect(() => {
    if (state?.phase === 'ended' && state.winner && roleKnown) {
      const isMafia = roleKnown === 'mafia'
      const won = (state.winner === 'mafia') === isMafia
      recordRoundResult(room, { result: won ? 'win' : 'loss', score: state.dayNumber })
    }
  }, [state?.phase]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Host logic ──
  const notify = (to, t, data) => {
    if (to === meId) room.emitter.emit(`msg:${t}`, data, meId)
    else room.send(t, data, { to })
  }

  useEffect(() => {
    if (!room || !isHost) return undefined
    const offs = [
      room.onMessage('role_req', (d, from) => {
        const sec = secret.current
        if (sec && d?.round === sec.round && room.getState()?.players?.[from]) notify(from, 'role', roleMessage(sec, from))
      }),
      room.onMessage('iam', (d, from) => {
        const s = room.getState()
        if (!s || d?.round !== s.round || !ROLES[d.role]) return
        if (claims.current.round !== s.round) claims.current = { round: s.round, roles: {}, since: room.now() }
        claims.current.roles[from] = { role: d.role, team: Array.isArray(d.team) ? d.team : null }
      }),
    ]
    return () => offs.forEach((off) => off())
  }, [room, isHost]) // eslint-disable-line react-hooks/exhaustive-deps

  useHostLoop(room, isHost, {
    onTick: () => {
      const s = room.getState()
      const t = room.now()
      const roundNo = room.info.round || 0
      if (roundNo > 0 && (!s || s.game !== 'mafia' || s.round !== roundNo)) {
        const next = initialState(room.roster, room.info, t)
        secret.current = newSecret(roundNo, assignRoles(room.roster))
        room.publishState(next)
        for (const id of Object.keys(next.players)) notify(id, 'role', roleMessage(secret.current, id))
        return
      }
      if (!s || s.phase === 'ended') return
      if (!secret.current || secret.current.round !== s.round) {
        // Host migrated mid-round: recover the roles from everyone's claims.
        if (claims.current.round !== s.round) claims.current = { round: s.round, roles: {}, since: t }
        if (roleInfo) claims.current.roles[meId] = { role: roleInfo.role, team: roleInfo.team || null }
        const presentIds = room.presentIds()
        const sec = recoverSecret(s, claims.current.roles, presentIds)
        if (sec) { secret.current = sec; return }
        if (t - claims.current.since > RECOVER_MS) {
          room.publishState({ ...s, phase: 'ended', winner: null, reason: 'host_left', feed: [{ id: `void-${t}`, text: 'The host left and the roles couldn’t be recovered. This round doesn’t count.' }, ...s.feed].slice(0, 20) })
          return
        }
        room.send('whois', { round: s.round })
        return
      }
      const sec = secret.current

      // Countdown → first night
      if (s.phase === 'countdown' && t >= s.startsAt) {
        room.publishState(startNight(s, sec, t, { dayNumber: 1 }))
        return
      }

      // Night → resolve → day (early once every night role is in)
      if (s.phase === 'night') {
        if (t >= s.nightUntil) { room.publishState(resolveNight(s, sec, t)); return }
        if (s.nightUntil - t > NIGHT_GRACE_MS && nightComplete(s, sec, room.presentIds())) {
          room.publishState({ ...s, nightUntil: t + NIGHT_GRACE_MS })
        }
        return
      }

      // Discuss → vote
      if (s.phase === 'discuss' && t >= s.discussUntil) {
        room.publishState({ ...s, phase: 'vote', voteUntil: t + VOTE_MS, votes: {} })
        return
      }

      // Vote → resolve → night
      if (s.phase === 'vote' && (t >= s.voteUntil || allVoted(s, room.presentIds()))) {
        room.publishState(resolveVote(s, sec, t))
      }
    },
    onAction: (action, from) => {
      const s = room.getState()
      const sec = secret.current
      if (!s || s.game !== 'mafia' || !sec || sec.round !== s.round || !action) return
      const t = room.now()
      if (action.type === 'vote') {
        const next = castVote(s, action, from)
        if (!next) return
        room.publishState(allVoted(next, room.presentIds()) ? resolveVote(next, sec, t) : next)
        return
      }
      for (const r of nightAction(s, sec, action, from)) notify(r.to, r.type, r.data)
    },
  }, 500)

  // ── Render ──
  if (!room || !snap) return null
  if (!state) return <StSpectating title="Starting" text="Dealing the roles…" />
  const me = state.players[meId]
  if (!me) return <StSpectating />

  const avatarOf = (id) => snap.roster.find((r) => r.id === id)?.avatar
  const nameOf = (id) => state.players[id]?.name || '?'
  const playerOf = (id) => ({ id, username: id === meId ? `${nameOf(id)} (you)` : nameOf(id), avatar: avatarOf(id) })
  const ids = Object.keys(state.players)
  const alive = ids.filter((id) => state.players[id].alive)
  const dead = ids.filter((id) => !state.players[id].alive)
  const role = ROLES[roleKnown] || null
  const team = roleKnown === 'mafia' ? (roleInfo?.team || []) : []

  // ── Countdown: role reveal ──
  if (state.phase === 'countdown') {
    const left = Math.max(0, Math.ceil((state.startsAt - now) / 1000))
    const c = role?.color || ST.muted
    const mates = team.filter((id) => id !== meId).map(nameOf)
    return (
      <StScreen scroll={false} style={styles.center}>
        <View style={[styles.revealEdge, { backgroundColor: c }]} />
        <Text style={[stType.kicker, { color: ST.night }]}>Mafia · your secret role</Text>
        <View style={[styles.portrait, { borderColor: c }]}>
          {role ? <Image source={role.image} style={styles.portraitImg} /> : <Ionicons name="help-circle-outline" size={48} color={ST.muted} />}
        </View>
        <Text style={[stType.display, { color: c, textAlign: 'center' }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.5}>{role ? role.label : 'Dealing'}</Text>
        <Text style={[stType.body, { textAlign: 'center', marginTop: 6, maxWidth: 320 }]}>{role ? role.desc : 'Getting your role…'}</Text>
        {mates.length ? <Text style={[stType.small, { color: ST.enemy, marginTop: 8, textAlign: 'center' }]}>Your Mafia partner{mates.length > 1 ? 's' : ''}: {mates.join(', ')}</Text> : null}
        <Text style={[stType.num, { fontSize: 72, marginTop: 20 }]}>{left}</Text>
        <Text style={[stType.label, { marginTop: 6 }]}>Don’t show your screen</Text>
      </StScreen>
    )
  }

  // ── Ended ──
  if (state.phase === 'ended') return <Summary state={state} meId={meId} roleKnown={roleKnown} playerOf={playerOf} isHost={isHost} room={room} snap={snap} onExit={onExit} />

  const RoleChip = (
    <Pressable onPress={() => setPeek((v) => !v)} accessibilityRole="button" accessibilityLabel="Show or hide your role" style={[styles.roleChip, { borderLeftColor: peek && role ? role.color : ST.lineStrong }]}>
      <View style={{ flex: 1 }}>
        <Text style={[stType.label, peek && role ? { color: role.color } : null]}>Your role</Text>
        <Text style={[stType.name, { fontSize: 17 }]}>{peek && role ? role.label.toUpperCase() : roleKnown ? 'TAP TO PEEK' : 'GETTING ROLE…'}</Text>
      </View>
      <Ionicons name={peek ? 'eye-off-outline' : 'eye-outline'} size={18} color={ST.muted} />
    </Pressable>
  )

  const DetectiveLog = roleKnown === 'detective' && investigations.length ? (
    <StSection label="Your investigations · only you see this" accent={ST.objective}>
      {investigations.map((x) => (
        <StPlayerRow key={x.target} player={playerOf(x.target)} follow={false} subtitle={`Night ${x.day ?? '?'}`} right={<StTag text={x.isMafia ? 'Mafia' : 'Not Mafia'} color={x.isMafia ? ST.enemy : ST.health} solid={x.isMafia} />} />
      ))}
    </StSection>
  ) : null

  // ── Night ──
  if (state.phase === 'night') {
    const timeLeft = Math.max(0, state.nightUntil - now)
    const key = `night-${state.dayNumber}`
    const sel = pick?.key === key ? pick.id : null
    const sent = locked?.key === key ? locked.id : null
    const lastSaved = roleKnown === 'doctor' && lastSave?.round === round && lastSave.day === state.dayNumber - 1 ? lastSave.id : null
    const investigatedTonight = roleKnown === 'detective' && investigations.some((x) => x.round === round && x.day === state.dayNumber)
    const acts = me.alive && (roleKnown === 'mafia' || roleKnown === 'doctor' || roleKnown === 'detective')
    const cfg = !me.alive ? null
      : roleKnown === 'mafia' ? { title: 'Choose a target', verb: 'Target', color: ST.enemy, type: 'mafia_target', can: (id) => id !== meId && !team.includes(id) }
        : roleKnown === 'doctor' ? { title: 'Choose who to save', verb: 'Save', color: ST.night, type: 'doctor_save', can: (id) => id !== lastSaved }
          : roleKnown === 'detective' ? { title: 'Who to investigate', verb: 'Investigate', color: ST.objective, type: 'detective_investigate', can: (id) => id !== meId && !investigatedTonight }
            : { title: 'The town sleeps', verb: 'Suspect', color: ST.friendly, local: true, can: (id) => id !== meId }
    const tagFor = (id) => {
      const p = state.players[id]
      if (!p.alive) return 'Out'
      if (id === meId) return role ? role.label : 'You'
      if (team.includes(id)) return 'Mafia'
      if (id === lastSaved) return 'Saved last night'
      const inv = investigations.find((x) => x.target === id)
      if (inv) return inv.isMafia ? 'Mafia' : 'Cleared'
      if (sent === id) return roleKnown === 'town' ? 'Suspect' : 'Locked'
      return 'Alive'
    }
    const send = () => {
      if (!sel || !cfg) return
      buzz('select')
      setLocked({ key, id: sel })
      if (cfg.local) return
      if (cfg.type === 'doctor_save') setLastSave({ round, day: state.dayNumber, id: sel })
      room.sendAction({ type: cfg.type, target: sel })
    }
    const prev = state.voteResult
    return (
      <StScreen>
        <StHero
          kicker={`Night ${state.dayNumber} · ${formatClock(timeLeft)}`}
          color={ST.night}
          title={!me.alive ? 'Night falls' : cfg.title}
          sub={!me.alive ? 'You’re out. Watch quietly — no hints.' : acts ? `You are the ${role.label}. Only you see this.` : roleKnown ? 'Mark who you suspect. Everyone taps at night so no one can tell who has a role.' : 'Getting your role…'}
        />
        {cfg ? (
          <StGrid cols={3}>
            {ids.map((id) => {
              const ok = state.players[id].alive && cfg.can(id) && !sent
              return (
                <StPlayerTile
                  key={id}
                  player={playerOf(id)}
                  tag={tagFor(id)}
                  selected={(sel || sent) === id}
                  color={cfg.color}
                  dim={!state.players[id].alive}
                  disabled={!ok}
                  onPress={() => setPick({ key, id })}
                />
              )
            })}
          </StGrid>
        ) : null}
        {cfg ? (
          <View style={{ marginTop: 6, marginBottom: 10 }}>
            {sent ? (
              <StBanner icon="lock-closed-outline" color={cfg.color} text={cfg.local ? `You marked ${nameOf(sent)}.` : roleKnown === 'detective' ? `Investigating ${nameOf(sent)}…` : `${cfg.verb}: ${nameOf(sent)} · locked in`} sub={roleKnown === 'mafia' && team.length > 1 ? 'The most-chosen target is hit at dawn.' : 'Wait for daylight.'} />
            ) : (
              <StButton
                title={sel ? `${cfg.verb} ${nameOf(sel)}` : roleKnown === 'detective' && investigatedTonight ? 'Investigated tonight' : `Pick a player`}
                color={cfg.color}
                disabled={!sel}
                onPress={send}
              />
            )}
          </View>
        ) : null}
        {!!notice && <StBanner text={notice} color={ST.night} icon="information-circle-outline" />}
        {DetectiveLog}
        {prev && state.dayNumber > 1 ? (
          <StSection label="Today’s vote">
            <Text style={stType.body}>{prev.eliminated ? `${nameOf(prev.eliminated)} was voted out.` : 'No one was voted out.'}</Text>
          </StSection>
        ) : null}
        <Text style={[stType.small, { color: 'rgba(242,244,247,0.55)' }]}>Long-press any player for their iYiYi profile and Follow. Roles stay hidden.</Text>
      </StScreen>
    )
  }

  // ── Day: discuss / vote ──
  const discussing = state.phase === 'discuss'
  const voting = state.phase === 'vote'
  const timeLeft = discussing ? Math.max(0, state.discussUntil - now) : voting ? Math.max(0, state.voteUntil - now) : 0
  const myVote = state.votes[meId]
  const key = `vote-${state.dayNumber}`
  const sel = pick?.key === key ? pick.id : null
  const tally = {}
  for (const v of Object.values(state.votes || {})) tally[v] = (tally[v] || 0) + 1
  const votedCount = Object.keys(state.votes || {}).length
  const nr = state.nightResult
  const canVote = voting && me.alive && myVote === undefined
  return (
    <StScreen>
      <StHero
        kicker={`Day ${state.dayNumber} · ${discussing ? 'discussion' : 'voting'} · ${formatClock(timeLeft)}`}
        color={discussing ? ST.friendly : ST.enemy}
        title={discussing ? 'Talk it out' : 'Vote someone out'}
        sub={discussing ? 'Who seems suspicious? Voting opens when the timer ends.' : 'Most votes is out. A tie — or Skip on top — means no one goes.'}
      />
      <StBanner
        icon={nr?.killed ? 'skull-outline' : 'sunny-outline'}
        color={nr?.killed ? ST.enemy : ST.health}
        text={nr ? (nr.killed ? `${nameOf(nr.killed)} was found eliminated.` : 'No one was eliminated last night.') : 'Morning.'}
      />
      {RoleChip}
      {!me.alive ? <StBanner icon="eye-outline" color={ST.muted} text="You’re out. You can watch but not vote." /> : null}

      <StSection label={`Alive · ${alive.length}`} right={voting ? `${votedCount} voted` : null}>
        <StGrid cols={3}>
          {alive.map((id) => (
            <StPlayerTile
              key={id}
              player={playerOf(id)}
              tag={voting ? (tally[id] ? `${tally[id]} vote${tally[id] > 1 ? 's' : ''}` : state.votes[id] !== undefined ? 'Voted' : 'Deciding') : team.includes(id) && id !== meId ? 'Mafia' : 'Alive'}
              selected={(canVote ? sel : myVote) === id}
              color={ST.enemy}
              disabled={!canVote || id === meId}
              onPress={() => setPick({ key, id })}
            />
          ))}
        </StGrid>
      </StSection>

      {canVote ? (
        <View style={{ flexDirection: 'row', gap: 8, marginBottom: 10 }}>
          <StButton title={sel ? `Vote out ${nameOf(sel)}` : 'Pick a suspect'} tone="danger" disabled={!sel} style={{ flex: 1 }} onPress={() => { buzz('select'); room.sendAction({ type: 'vote', target: sel }) }} />
          <StButton title={`Skip${tally.skip ? ` · ${tally.skip}` : ''}`} tone="ghost" style={{ width: 110 }} onPress={() => { buzz('select'); room.sendAction({ type: 'vote', target: 'skip' }) }} />
        </View>
      ) : voting && me.alive ? (
        <StBanner icon="checkmark" color={ST.enemy} text={myVote === 'skip' ? 'You skipped. Waiting for others…' : `You voted for ${nameOf(myVote)}. Waiting for others…`} />
      ) : null}

      {DetectiveLog}
      {!!notice && <StBanner text={notice} color={ST.night} icon="information-circle-outline" />}

      {dead.length > 0 && (
        <StSection label="Eliminated">
          {dead.map((id) => <StPlayerRow key={id} player={playerOf(id)} dim />)}
        </StSection>
      )}
      <StFeed items={state.feed} label="Event log" />
    </StScreen>
  )
}

// ─── Summary ──────────────────────────────────────────────────────────────────
function Summary({ state, meId, roleKnown, playerOf, isHost, room, snap, onExit }) {
  const isMafia = roleKnown === 'mafia'
  const void_ = !state.winner
  const iWon = !void_ && (state.winner === 'mafia') === isMafia
  const roles = state.roles || {}
  const winColor = state.winner === 'mafia' ? ST.enemy : ST.friendly
  const ids = Object.keys(state.players)
  const survivors = ids.filter((id) => state.players[id].alive).length
  const mafiaCount = ids.filter((id) => roles[id] === 'mafia').length
  const order = { mafia: 0, detective: 1, doctor: 2, town: 3 }
  const sorted = [...ids].sort((a, b) => (order[roles[a]] ?? 4) - (order[roles[b]] ?? 4))
  return (
    <StScreen>
      <StHero
        kicker={void_ ? 'Mafia · round void' : `Mafia · day ${state.dayNumber}`}
        title={void_ ? 'No result' : state.winner === 'town' ? 'Town wins' : 'Mafia wins'}
        sub={void_ ? 'The host left mid-round.' : roleKnown ? (iWon ? 'You were on the winning side.' : 'Better luck next time.') : null}
        color={void_ ? ST.muted : winColor}
        big
      />
      {!void_ ? (
        <View style={[styles.banner, { borderColor: winColor }]}>
          <Image source={state.winner === 'town' ? CHAR_IMAGES.town : CHAR_IMAGES.mafia} style={styles.bannerImg} />
          <View style={{ flex: 1 }}>
            <Text style={[stType.label, { color: winColor }]}>{iWon ? 'Victory' : 'Defeat'}</Text>
            <Text style={[stType.name, { fontSize: 18 }]}>{state.winner === 'town' ? 'Every Mafia member is out' : 'The Mafia matched the Town'}</Text>
          </View>
        </View>
      ) : null}
      <StStats items={[
        { label: 'Days', value: String(state.dayNumber || 0) },
        { label: 'Survivors', value: `${survivors}/${ids.length}` },
        { label: 'Mafia', value: roles && Object.keys(roles).length ? String(mafiaCount) : '—', color: ST.enemy },
      ]} />
      <StSection label={Object.keys(roles).length ? 'Roles revealed · follow on iYiYi' : 'Played with · follow on iYiYi'}>
        {sorted.map((id) => {
          const p = state.players[id]
          const r = ROLES[roles[id] || (id === meId ? roleKnown : null)]
          return (
            <StPlayerRow
              key={id}
              player={playerOf(id)}
              color={r?.color}
              subtitle={p.alive ? 'Survived' : 'Eliminated'}
              dim={!p.alive}
              right={r ? <StTag text={r.label} color={r.color} /> : null}
            />
          )
        })}
      </StSection>
      <StFeed items={state.feed} label="Event log" max={20} />
      <StResultsFooter isHost={isHost} onAgain={() => room.setInfo({ round: (snap.info.round || 0) + 1 })} onExit={onExit} />
    </StScreen>
  )
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center', padding: 24 },
  revealEdge: { position: 'absolute', top: 0, left: 0, right: 0, height: 3 },
  portrait: { width: 132, height: 132, marginVertical: 16, borderWidth: 2, borderRadius: ST.radius, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', backgroundColor: '#2a3038' },
  portraitImg: { width: '100%', height: '100%' },
  roleChip: { flexDirection: 'row', alignItems: 'center', padding: 10, marginBottom: 10, borderLeftWidth: 3, backgroundColor: withAlpha('#ffffff', 0.04), borderRadius: ST.radius },
  banner: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 10, marginBottom: 10, borderWidth: 1, borderRadius: ST.radius, backgroundColor: ST.panel },
  bannerImg: { width: 56, height: 56, borderRadius: ST.radius },
})
