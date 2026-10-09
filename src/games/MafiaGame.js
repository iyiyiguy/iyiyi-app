// Mafia — social deduction party game (5–15 players).
//
// Night/Day cycle. Roles: Town, Mafia (1–3), Doctor, Detective.
// Night: Mafia picks a target, Doctor picks someone to save, Detective
// investigates one player. Day: discuss and vote to eliminate.
// Town wins when all Mafia are eliminated; Mafia wins when they equal Town.
// Host-authoritative: the host drives the game state machine and holds the
// secret role assignments.
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { Avatar, Btn, Card, Pill, PlayerRow, PlayerTap, ProgressRing, Spectating, formatClock } from './MultiplayerUI'
import {
  recordRoundResult,
  useHostLoop, useRoomClock, useRoomSnapshot,
} from '../lib/multiplayer'
import { buzz } from '../lib/gamePrefs'
import { colors, radii, type } from '../theme'

// ─── Role config ──────────────────────────────────────────────────────────────
const ROLES = {
  town: { label: 'Townsperson', icon: '🏠', color: '#3b82f6', desc: 'Find and vote out the Mafia.' },
  mafia: { label: 'Mafia', icon: '🔪', color: '#ef4444', desc: 'Eliminate the Town without getting caught.' },
  doctor: { label: 'Doctor', icon: '🩺', color: '#22c55e', desc: 'Each night, choose someone to protect.' },
  detective: { label: 'Detective', icon: '🔍', color: '#eab308', desc: 'Each night, investigate one player.' },
}

// ─── Timing ───────────────────────────────────────────────────────────────────
const COUNTDOWN_MS = 5000
const NIGHT_MS = 30000
const DISCUSS_MS = 60000
const VOTE_MS = 30000

function shuffled(arr) {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]] }
  return a
}

// ─── Engine ───────────────────────────────────────────────────────────────────
function assignRoles(roster) {
  const ids = shuffled(roster.map((p) => p.id))
  const n = ids.length
  const mafiaCount = n >= 10 ? 3 : n >= 7 ? 2 : 1
  const roles = {}
  let i = 0
  for (let m = 0; m < mafiaCount; m++) roles[ids[i++]] = 'mafia'
  if (n >= 6) roles[ids[i++]] = 'doctor'
  if (n >= 7) roles[ids[i++]] = 'detective'
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
    // Night actions (host-side only, not published — kept in secret ref)
    // Published:
    nightResult: null, // { killed: id | null, saved: bool }
    investigateResult: null, // per-player via message
    votes: {},
    voteResult: null, // { eliminated: id | null }
    discussUntil: 0,
    voteUntil: 0,
    nightUntil: 0,
    feed: [],
    winner: null,
  }
}

function countAlive(players, roles, faction) {
  return Object.keys(players).filter((id) => players[id].alive && (!faction || roles[id] === faction || (faction === 'town' && roles[id] !== 'mafia'))).length
}

function checkWin(players, roles) {
  const mafia = countAlive(players, roles, 'mafia')
  const town = Object.keys(players).filter((id) => players[id].alive && roles[id] !== 'mafia').length
  if (mafia === 0) return 'town'
  if (mafia >= town) return 'mafia'
  return null
}

// ─── Component ────────────────────────────────────────────────────────────────
export function MafiaGame({ room, onExit }) {
  const snap = useRoomSnapshot(room)
  const now = useRoomClock(room, 500)
  const [myRole, setMyRole] = useState(null) // { round, role }
  const [showRole, setShowRole] = useState(false)
  const [investigateMsg, setInvestigateMsg] = useState(null)
  const [notice, setNotice] = useState(null)
  const noticeTimer = useRef(null)
  const secret = useRef(null) // host only: { round, roles, mafiaTarget, doctorTarget, detectiveTarget, mafiaVotes }

  const meId = snap?.me?.id
  const isHost = !!snap?.isHost
  const state = snap?.state?.game === 'mafia' ? snap.state : null
  const round = state?.round
  const roleKnown = myRole && myRole.round === round ? myRole.role : null

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
        if (d && typeof d.round === 'number' && ROLES[d.role]) setMyRole({ round: d.round, role: d.role })
      }),
      room.onMessage('notice', (d) => { buzz('warning'); flash(String(d?.text || '')) }),
      room.onMessage('investigate', (d) => {
        if (d && typeof d.target === 'string') {
          buzz('select')
          setInvestigateMsg(d)
        }
      }),
    ]
    return () => offs.forEach((off) => off())
  }, [room])

  useEffect(() => {
    setShowRole(false)
    setInvestigateMsg(null)
  }, [round])

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
    return room.onMessage('role_req', (d, from) => {
      const sec = secret.current
      if (sec && d?.round === sec.round) notify(from, 'role', { round: sec.round, role: sec.roles[from] || 'town' })
    })
  }, [room, isHost]) // eslint-disable-line react-hooks/exhaustive-deps

  useHostLoop(room, isHost, {
    onTick: () => {
      const s = room.getState()
      const t = room.now()
      const roundNo = room.info.round || 0
      if (roundNo > 0 && (!s || s.game !== 'mafia' || s.round !== roundNo)) {
        const next = initialState(room.roster, room.info, t)
        const roles = assignRoles(room.roster)
        secret.current = { round: roundNo, roles, mafiaTarget: null, doctorTarget: null, detectiveTarget: null, mafiaVotes: {} }
        room.publishState(next)
        for (const id of Object.keys(next.players)) notify(id, 'role', { round: roundNo, role: roles[id] })
        return
      }
      if (!s || s.phase === 'ended') return
      const sec = secret.current
      if (!sec || sec.round !== s.round) return

      // Countdown → first night
      if (s.phase === 'countdown' && t >= s.startsAt) {
        room.publishState({ ...s, phase: 'night', dayNumber: 1, nightUntil: t + NIGHT_MS, nightResult: null, investigateResult: null })
        sec.mafiaTarget = null
        sec.doctorTarget = null
        sec.detectiveTarget = null
        sec.mafiaVotes = {}
        return
      }

      // Night → resolve → day
      if (s.phase === 'night' && t >= s.nightUntil) {
        const target = sec.mafiaTarget
        const saved = target && sec.doctorTarget === target
        const killed = target && !saved ? target : null
        const players = { ...s.players }
        const feed = [...s.feed]
        if (killed) {
          players[killed] = { ...players[killed], alive: false, eliminated: true }
          feed.unshift({ id: `kill-${s.dayNumber}`, text: `☀️ Day ${s.dayNumber}: ${players[killed].name} was found eliminated.` })
        } else {
          feed.unshift({ id: `safe-${s.dayNumber}`, text: `☀️ Day ${s.dayNumber}: No one was eliminated last night.` })
        }
        const winner = checkWin(players, sec.roles)
        if (winner) {
          room.publishState({ ...s, phase: 'ended', players, feed: feed.slice(0, 20), winner, nightResult: { killed, saved: !!saved } })
          return
        }
        room.publishState({
          ...s, phase: 'discuss', players, dayNumber: s.dayNumber,
          nightResult: { killed, saved: !!saved },
          discussUntil: t + DISCUSS_MS, votes: {}, voteResult: null,
          feed: feed.slice(0, 20),
        })
        return
      }

      // Discuss → vote
      if (s.phase === 'discuss' && t >= s.discussUntil) {
        room.publishState({ ...s, phase: 'vote', voteUntil: t + VOTE_MS, votes: {} })
        return
      }

      // Vote → resolve → night
      if (s.phase === 'vote' && t >= s.voteUntil) {
        resolveVote(s, sec, t)
        return
      }
    },
    onAction: (action, from) => {
      const s = room.getState()
      const sec = secret.current
      if (!s || s.game !== 'mafia' || !sec || sec.round !== s.round) return
      const t = room.now()

      if (action.type === 'mafia_target' && s.phase === 'night' && sec.roles[from] === 'mafia') {
        sec.mafiaVotes[from] = action.target
        // Majority of living mafia decides
        const livingMafia = Object.keys(s.players).filter((id) => s.players[id].alive && sec.roles[id] === 'mafia')
        const votes = {}
        for (const m of livingMafia) { const v = sec.mafiaVotes[m]; if (v) votes[v] = (votes[v] || 0) + 1 }
        const majority = Math.ceil(livingMafia.length / 2)
        const chosen = Object.entries(votes).find(([, c]) => c >= majority)
        if (chosen) sec.mafiaTarget = chosen[0]
        notify(from, 'notice', { text: `Target locked: ${s.players[action.target]?.name || '?'}` })
      }

      if (action.type === 'doctor_save' && s.phase === 'night' && sec.roles[from] === 'doctor') {
        sec.doctorTarget = action.target
        notify(from, 'notice', { text: `Protecting ${s.players[action.target]?.name || '?'} tonight.` })
      }

      if (action.type === 'detective_investigate' && s.phase === 'night' && sec.roles[from] === 'detective') {
        sec.detectiveTarget = action.target
        const isMafia = sec.roles[action.target] === 'mafia'
        notify(from, 'investigate', { target: action.target, name: s.players[action.target]?.name, isMafia })
      }

      if (action.type === 'vote' && s.phase === 'vote' && s.players[from]?.alive) {
        const newVotes = { ...s.votes, [from]: action.target }
        room.publishState({ ...s, votes: newVotes })
        const aliveCount = Object.keys(s.players).filter((id) => s.players[id].alive).length
        if (Object.keys(newVotes).length >= aliveCount) resolveVote({ ...s, votes: newVotes }, sec, t)
      }
    },
  }, 500)

  function resolveVote(s, sec, t) {
    const tally = {}
    for (const target of Object.values(s.votes)) tally[target] = (tally[target] || 0) + 1
    const sorted = Object.entries(tally).filter(([k]) => k !== 'skip').sort((a, b) => b[1] - a[1])
    const top = sorted[0]
    const tie = sorted.length > 1 && sorted[0][1] === sorted[1][1]
    const eliminated = top && !tie ? top[0] : null
    const players = { ...s.players }
    const feed = [...s.feed]
    if (eliminated) {
      players[eliminated] = { ...players[eliminated], alive: false, eliminated: true }
      const wasRole = sec.roles[eliminated]
      feed.unshift({ id: `vote-${s.dayNumber}`, text: `🗳️ ${players[eliminated].name} was voted out. They were ${ROLES[wasRole]?.label || 'Town'}.` })
    } else {
      feed.unshift({ id: `novote-${s.dayNumber}`, text: `🗳️ No one was voted out${tie ? ' (tie)' : ''}.` })
    }
    const winner = checkWin(players, sec.roles)
    if (winner) {
      room.publishState({ ...s, phase: 'ended', players, voteResult: { eliminated }, feed: feed.slice(0, 20), winner })
      return
    }
    // Next night
    sec.mafiaTarget = null
    sec.doctorTarget = null
    sec.detectiveTarget = null
    sec.mafiaVotes = {}
    room.publishState({
      ...s, phase: 'night', players, dayNumber: s.dayNumber + 1,
      nightUntil: t + NIGHT_MS, nightResult: null, investigateResult: null,
      voteResult: { eliminated }, votes: {}, feed: feed.slice(0, 20),
    })
  }

  // ── Render ──
  if (!room || !snap) return null
  if (!state) return <Spectating text="Starting…" />
  const me = state.players[meId]
  if (!me) return <Spectating />

  const avatarOf = (id) => snap.roster.find((r) => r.id === id)?.avatar
  const alive = Object.entries(state.players).filter(([, p]) => p.alive)
  const dead = Object.entries(state.players).filter(([, p]) => !p.alive)

  // ── Countdown ──
  if (state.phase === 'countdown') {
    const left = Math.max(0, Math.ceil((state.startsAt - now) / 1000))
    const r = ROLES[roleKnown] || null
    return (
      <View style={[styles.reveal, { backgroundColor: r ? r.color : colors.inkSurfaceRaised }]}>
        <Text style={[styles.revealIcon]}>{r ? r.icon : '🎭'}</Text>
        <Text style={styles.revealSmall}>Your secret role</Text>
        <Text style={styles.revealBig}>{r ? r.label.toUpperCase() : '…'}</Text>
        <Text style={styles.revealSmall}>{r ? r.desc : 'Getting your role…'}</Text>
        <Text style={styles.revealCount}>{left}</Text>
        <Text style={styles.revealSmall}>Don't show your screen!</Text>
      </View>
    )
  }

  // ── Ended ──
  if (state.phase === 'ended') return <Summary state={state} meId={meId} roleKnown={roleKnown} avatarOf={avatarOf} isHost={isHost} room={room} snap={snap} onExit={onExit} />

  // ── Night ──
  if (state.phase === 'night') {
    const timeLeft = Math.max(0, state.nightUntil - now)
    return (
      <ScrollView contentContainerStyle={styles.pad}>
        <Card style={styles.nightCard}>
          <Text style={styles.moonIcon}>🌙</Text>
          <Text style={[type.display, { textAlign: 'center', color: '#c4b5fd' }]}>Night {state.dayNumber}</Text>
          <Text style={[type.caption, { textAlign: 'center', marginTop: 4 }]}>Close your eyes. The night actions are happening…</Text>
          <Text style={[type.display, { textAlign: 'center', marginTop: 12 }]}>{formatClock(timeLeft)}</Text>
        </Card>

        {!me.alive && <Card><Text style={type.body}>💀 You've been eliminated. Watch and wait.</Text></Card>}

        {me.alive && roleKnown === 'mafia' && (
          <Card>
            <Text style={[type.label, { color: ROLES.mafia.color }]}>🔪 Choose a target to eliminate</Text>
            {alive.filter(([id]) => id !== meId && roleKnown !== 'mafia').map(([id, p]) => (
              <PlayerRow key={id} player={{ username: p.name, avatar: avatarOf(id) }}
                right={<Btn title="Target" size="sm" variant="danger" onPress={() => { buzz('select'); room.sendAction({ type: 'mafia_target', target: id }) }} />}
              />
            ))}
            <Text style={[type.caption, { marginTop: 6 }]}>If multiple Mafia, majority picks the target.</Text>
          </Card>
        )}

        {me.alive && roleKnown === 'doctor' && (
          <Card>
            <Text style={[type.label, { color: ROLES.doctor.color }]}>🩺 Choose someone to protect</Text>
            {alive.map(([id, p]) => (
              <PlayerRow key={id} player={{ username: id === meId ? `${p.name} (you)` : p.name, avatar: avatarOf(id) }}
                right={<Btn title="Protect" size="sm" variant="primary" onPress={() => { buzz('select'); room.sendAction({ type: 'doctor_save', target: id }) }} />}
              />
            ))}
          </Card>
        )}

        {me.alive && roleKnown === 'detective' && (
          <Card>
            <Text style={[type.label, { color: ROLES.detective.color }]}>🔍 Investigate a player</Text>
            {alive.filter(([id]) => id !== meId).map(([id, p]) => (
              <PlayerRow key={id} player={{ username: p.name, avatar: avatarOf(id) }}
                right={<Btn title="Investigate" size="sm" variant="primary" onPress={() => { buzz('select'); room.sendAction({ type: 'detective_investigate', target: id }) }} />}
              />
            ))}
          </Card>
        )}

        {investigateMsg && (
          <Card style={{ borderColor: ROLES.detective.color, borderWidth: 1 }}>
            <Text style={[type.body, { textAlign: 'center' }]}>
              {investigateMsg.name} is {investigateMsg.isMafia ? '🔪 MAFIA' : '✅ NOT Mafia'}.
            </Text>
          </Card>
        )}

        {me.alive && roleKnown === 'town' && (
          <Card><Text style={[type.body, { textAlign: 'center' }]}>😴 You're asleep. Wait for daylight.</Text></Card>
        )}

        {!!notice && <Card><Text style={type.body}>{notice}</Text></Card>}
      </ScrollView>
    )
  }

  // ── Day: discuss / vote ──
  const discussing = state.phase === 'discuss'
  const voting = state.phase === 'vote'
  const timeLeft = discussing ? Math.max(0, state.discussUntil - now) : voting ? Math.max(0, state.voteUntil - now) : 0
  const myVote = state.votes[meId]

  return (
    <ScrollView contentContainerStyle={styles.pad}>
      <Card style={styles.dayCard}>
        <Text style={styles.sunIcon}>☀️</Text>
        <Text style={[type.display, { textAlign: 'center' }]}>Day {state.dayNumber}</Text>
        {state.nightResult && (
          <Text style={[type.body, { textAlign: 'center', marginTop: 6 }]}>
            {state.nightResult.killed
              ? `${state.players[state.nightResult.killed]?.name} was found eliminated.`
              : 'No one was eliminated last night.'}
          </Text>
        )}
      </Card>

      <Card style={{ alignItems: 'center' }}>
        <Pill text={discussing ? 'DISCUSSION' : 'VOTING'} color={discussing ? colors.accent : colors.danger} />
        <Text style={[type.display, { marginTop: 8 }]}>{formatClock(timeLeft)}</Text>
        <Text style={[type.caption, { textAlign: 'center', marginTop: 4 }]}>
          {discussing ? 'Talk it out — who seems suspicious? Voting opens soon.' : 'Vote to eliminate a suspect. Majority decides.'}
        </Text>
      </Card>

      {!me.alive && <Card><Text style={type.body}>💀 You're eliminated. You can watch but not vote.</Text></Card>}

      <Card>
        <Text style={[type.label, { marginBottom: 6 }]}>Alive ({alive.length})</Text>
        {alive.map(([id, p]) => (
          <PlayerRow key={id}
            player={{ username: id === meId ? `${p.name} (you)` : p.name, avatar: avatarOf(id) }}
            subtitle={state.votes[id] !== undefined ? 'Voted ✓' : voting && me.alive ? '' : ''}
            right={voting && me.alive && myVote === undefined && id !== meId
              ? <Btn title="Vote" size="sm" variant="danger" onPress={() => { buzz('select'); room.sendAction({ type: 'vote', target: id }) }} />
              : myVote === id ? <Pill text="YOUR VOTE" color={colors.danger} /> : null}
          />
        ))}
      </Card>

      {voting && me.alive && myVote === undefined && (
        <Btn title="Skip vote" onPress={() => { buzz('select'); room.sendAction({ type: 'vote', target: 'skip' }) }} />
      )}
      {voting && me.alive && myVote !== undefined && (
        <Text style={[type.caption, { textAlign: 'center' }]}>{myVote === 'skip' ? 'You skipped.' : 'Vote cast.'} Waiting for others…</Text>
      )}

      {dead.length > 0 && (
        <Card>
          <Text style={[type.label, { marginBottom: 6 }]}>Eliminated</Text>
          {dead.map(([id, p]) => (
            <PlayerRow key={id} player={{ username: p.name, avatar: avatarOf(id) }} dim />
          ))}
        </Card>
      )}

      {state.feed.length > 0 && (
        <Card>
          <Text style={[type.label, { marginBottom: 4 }]}>Event log</Text>
          {state.feed.map((f) => <Text key={f.id} style={[type.caption, { marginVertical: 2 }]}>{f.text}</Text>)}
        </Card>
      )}

      {!!notice && <Card><Text style={type.body}>{notice}</Text></Card>}
    </ScrollView>
  )
}

// ─── Summary ──────────────────────────────────────────────────────────────────
function Summary({ state, meId, roleKnown, avatarOf, isHost, room, snap, onExit }) {
  const isMafia = roleKnown === 'mafia'
  const iWon = (state.winner === 'mafia') === isMafia
  return (
    <ScrollView contentContainerStyle={styles.pad}>
      <View style={[styles.summaryBanner, { backgroundColor: state.winner === 'town' ? '#3b82f6' : '#ef4444' }]}>
        <Text style={styles.summaryIcon}>{state.winner === 'town' ? '🏠' : '🔪'}</Text>
        <Text style={styles.summaryTitle}>{state.winner === 'town' ? 'Town Wins!' : 'Mafia Wins!'}</Text>
        <Text style={styles.summarySub}>{iWon ? 'You were on the winning side!' : 'Better luck next time.'}</Text>
      </View>

      <Card>
        <Text style={[type.label, { marginBottom: 6 }]}>Day {state.dayNumber} · All roles revealed</Text>
        {Object.entries(state.players).map(([id, p]) => {
          const r = ROLES[roleKnown && id === meId ? roleKnown : 'town'] // Only host knows all roles; in practice secret ref is lost
          return (
            <PlayerRow key={id}
              player={{ username: id === meId ? `${p.name} (you)` : p.name, avatar: avatarOf(id) }}
              subtitle={`${p.alive ? 'Survived' : 'Eliminated'}`}
              dim={!p.alive}
            />
          )
        })}
      </Card>

      <Card>
        <Text style={[type.label, { marginBottom: 4 }]}>Event log</Text>
        {state.feed.map((f) => <Text key={f.id} style={[type.caption, { marginVertical: 2 }]}>{f.text}</Text>)}
      </Card>

      {isHost
        ? <Btn title="Play again" variant="primary" onPress={() => room.setInfo({ round: (snap.info.round || 0) + 1 })} />
        : <Text style={[type.caption, { textAlign: 'center' }]}>Waiting for the host to start another round…</Text>}
      <Btn title="Leave" onPress={onExit} style={{ marginTop: 12 }} />
    </ScrollView>
  )
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  pad: { padding: 12, paddingBottom: 40 },
  reveal: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28, borderRadius: radii.lg },
  revealIcon: { fontSize: 64, marginBottom: 12 },
  revealSmall: { ...type.body, color: 'rgba(255,255,255,0.8)', textAlign: 'center', marginTop: 8 },
  revealBig: { fontSize: 40, fontWeight: '800', letterSpacing: 2, color: '#ffffff', marginTop: 8 },
  revealCount: { fontSize: 72, fontWeight: '800', color: '#ffffff', marginTop: 20 },
  nightCard: { alignItems: 'center', paddingVertical: 24 },
  moonIcon: { fontSize: 48, marginBottom: 8 },
  dayCard: { alignItems: 'center', paddingVertical: 20 },
  sunIcon: { fontSize: 48, marginBottom: 8 },
  summaryBanner: { borderRadius: radii.lg, padding: 32, alignItems: 'center', marginBottom: 12 },
  summaryIcon: { fontSize: 56, marginBottom: 8 },
  summaryTitle: { fontSize: 32, fontWeight: '900', color: '#ffffff', letterSpacing: -0.5 },
  summarySub: { ...type.body, color: 'rgba(255,255,255,0.85)', marginTop: 6, textAlign: 'center' },
})
