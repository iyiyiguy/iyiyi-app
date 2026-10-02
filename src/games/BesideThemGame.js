// Beside Them — real-world social deduction (4+ players).
//
// Crew walk to real task stations (photos scanned in the lobby), scan the
// object and solve a short puzzle. A secret imposter eliminates crew up close,
// can sabotage comms, and fakes tasks. Bodies can be reported, everyone gets
// one emergency meeting, and meetings run a discussion then a vote.
//
// Roles are private: the host tells each player only their own role with a
// message addressed to them. If the host drops, the new host asks everyone for
// their role ("whois") to recover the imposter's identity.
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { Avatar, Btn, Card, LocationGate, Pill, PlayerRow, PlayerTap, Spectating, formatClock } from './MultiplayerUI'
import { StationImage } from './beside/StationImage'
import { ScanTask } from './beside/ScanTask'
import { PUZZLES } from './beside/Puzzles'
import * as engine from './beside/engine'
import {
  bearingDeg, compassLabel, distanceMeters, formatDistance, recordRoundResult,
  useHostLoop, useRoomClock, useRoomPositions, useRoomSnapshot, useSharedLocation,
} from '../lib/multiplayer'
import { buzz } from '../lib/gamePrefs'
import { colors, radii, type } from '../theme'

export function BesideThemGame({ room, onExit }) {
  const snap = useRoomSnapshot(room)
  const positions = useRoomPositions(room)
  const now = useRoomClock(room, 500)
  const loc = useSharedLocation(room)
  const [myRole, setMyRole] = useState(null) // { round, role }
  const [showRole, setShowRole] = useState(false)
  const [activeTask, setActiveTask] = useState(null) // index
  const [killReadyAt, setKillReadyAt] = useState(null)
  const [notice, setNotice] = useState(null)
  const noticeTimer = useRef(null)
  const secret = useRef(null) // host only
  const claims = useRef({ round: null, roles: {} }) // host only, after migration
  const lastRoleReq = useRef(0)

  const meId = snap?.me?.id
  const isHost = !!snap?.isHost
  const state = snap?.state?.game === 'beside' ? snap.state : null
  const round = state?.round
  const roleKnown = myRole && myRole.round === round ? myRole.role : null
  const amImposter = roleKnown === 'imposter'
  const me = state?.players?.[meId]
  const stations = snap?.info?.settings?.stations || []
  const stationById = useMemo(() => Object.fromEntries(stations.map((s) => [s.id, s])), [stations])

  const flash = (text) => {
    setNotice(text)
    clearTimeout(noticeTimer.current)
    noticeTimer.current = setTimeout(() => setNotice(null), 4000)
  }
  useEffect(() => () => clearTimeout(noticeTimer.current), [])

  // ---- messages for every player ----
  useEffect(() => {
    if (!room) return undefined
    const offs = [
      room.onMessage('role', (d) => {
        if (d && typeof d.round === 'number' && (d.role === 'imposter' || d.role === 'crew')) setMyRole({ round: d.round, role: d.role })
      }),
      room.onMessage('notice', (d) => { buzz('warning'); flash(String(d?.text || '')) }),
      room.onMessage('kill_ok', (d) => { buzz('heavy'); if (typeof d?.readyAt === 'number') setKillReadyAt(d.readyAt) }),
    ]
    return () => offs.forEach((off) => off())
  }, [room])

  useEffect(() => {
    if (!room) return undefined
    return room.onMessage('whois', (d, from) => {
      if (roleKnown && d?.round === round) room.send('iam', { round, role: roleKnown }, { to: from })
    })
  }, [room, roleKnown, round])

  useEffect(() => {
    if (!room || !state || roleKnown || !state.players[meId] || isHost) return
    const t = Date.now()
    if (t - lastRoleReq.current > 3000) {
      lastRoleReq.current = t
      room.send('role_req', { round }, { to: snap.hostId })
    }
  }, [room, state, roleKnown, meId, isHost, round, snap?.hostId, now])

  useEffect(() => {
    setKillReadyAt(null)
    setActiveTask(null)
    setShowRole(false)
  }, [round])

  const phase = state?.phase
  const prevPhase = useRef(phase)
  useEffect(() => {
    if (phase === 'meeting' && prevPhase.current === 'playing') buzz('warning')
    prevPhase.current = phase
  }, [phase])
  const alive = me?.alive
  const prevAlive = useRef(alive)
  useEffect(() => {
    if (prevAlive.current === true && alive === false && !me?.ejected) {
      buzz('error')
      setActiveTask(null)
      flash('You were eliminated. Crew ghosts can still finish tasks.')
    }
    prevAlive.current = alive
  }, [alive, me?.ejected])

  useEffect(() => {
    if (state?.phase === 'ended' && me && state.imposterId) {
      const won = (state.winner === 'imposter') === (state.imposterId === meId)
      recordRoundResult(room, { result: won ? 'win' : 'loss', score: me.tasksDone })
    }
  }, [state?.phase]) // eslint-disable-line react-hooks/exhaustive-deps

  // ---- host ----
  const notify = (to, type_, data) => {
    if (to === meId) room.emitter.emit(`msg:${type_}`, data, meId)
    else room.send(type_, data, { to })
  }
  const sendRole = (id, sec) => notify(id, 'role', { round: sec.round, role: id === sec.imposterId ? 'imposter' : 'crew' })

  useEffect(() => {
    if (!room || !isHost) return undefined
    const offs = [
      room.onMessage('role_req', (d, from) => {
        const sec = secret.current
        if (sec && d?.round === sec.round && room.getState()?.players?.[from]) sendRole(from, sec)
      }),
      room.onMessage('iam', (d, from) => {
        const s = room.getState()
        if (!s || d?.round !== s.round) return
        if (claims.current.round !== s.round) claims.current = { round: s.round, roles: {} }
        claims.current.roles[from] = d.role
        if (d.role === 'imposter' && !secret.current) {
          const t = room.now()
          secret.current = { round: s.round, imposterId: from, lastKillAt: t, sabotageReadyAt: t + 30000, voteLog: [] }
        }
      }),
    ]
    return () => offs.forEach((off) => off())
  }, [room, isHost]) // eslint-disable-line react-hooks/exhaustive-deps

  useHostLoop(room, isHost, {
    onTick: () => {
      const s = room.getState()
      const t = room.now()
      const roundNo = room.info.round || 0
      const presentIds = room.presentIds()
      if (roundNo > 0 && (!s || s.game !== 'beside' || s.round !== roundNo)) {
        const next = engine.initialState(room.roster, room.info, t)
        secret.current = engine.newSecret(next)
        room.publishState(next)
        for (const id of Object.keys(next.players)) sendRole(id, secret.current)
        return
      }
      if (!s || s.phase === 'ended') return
      if (!secret.current || secret.current.round !== s.round) {
        // Host migrated mid-round: recover the imposter from role claims.
        if (claims.current.round !== s.round) claims.current = { round: s.round, roles: {} }
        if (roleKnown) claims.current.roles[meId] = roleKnown
        if (roleKnown === 'imposter') secret.current = { round: s.round, imposterId: meId, lastKillAt: t, sabotageReadyAt: t + 30000, voteLog: [] }
        if (!secret.current || secret.current.round !== s.round) {
          room.send('whois', { round: s.round })
          const inGame = Object.keys(s.players).filter((id) => presentIds.has(id))
          if (inGame.length && inGame.every((id) => claims.current.roles[id] === 'crew')) {
            room.publishState({ ...s, phase: 'ended', meeting: null, winner: 'crew', reason: 'imposter-left' })
          }
          return
        }
      }
      const next = engine.tick(s, secret.current, { now: t, presentIds })
      if (next !== s) room.publishState(next)
    },
    onAction: (action, from) => {
      const s = room.getState()
      const sec = secret.current
      if (!s || s.game !== 'beside' || !sec || sec.round !== s.round) return
      const { state: next, reply } = engine.applyAction(s, sec, action, from, {
        now: room.now(),
        posOf: (id) => room.freshPosition(id),
        stations: room.info.settings?.stations || [],
        presentIds: room.presentIds(),
      })
      if (next !== s) room.publishState(next)
      if (reply) notify(from, reply.type, reply.data)
    },
  }, 500)

  const myPos = loc.coords
  const others = useMemo(() => {
    if (!state) return []
    return Object.keys(state.players)
      .filter((id) => id !== meId)
      .map((id) => {
        const p = positions?.[id]
        const fresh = p && Date.now() - p.at < 15000 ? p : null
        return { id, ...state.players[id], pos: fresh, d: fresh && myPos ? distanceMeters(myPos, fresh) : Infinity }
      })
      .sort((a, b) => (b.alive - a.alive) || (a.d - b.d))
  }, [state, positions, myPos, meId])

  // ---- render ----
  if (!room || !snap) return null
  if (loc.status !== 'granted') return <LocationGate status={loc.status} onExit={onExit} what="Beside Them" />
  if (!state) return <Spectating text="Starting…" />
  if (!me) return <Spectating />

  const avatarOf = (id) => snap.roster.find((r) => r.id === id)?.avatar
  const present = (id) => snap.roster.some((r) => r.id === id)

  if (state.phase === 'countdown') {
    const left = Math.max(0, Math.ceil((state.startsAt - now) / 1000))
    return (
      <View style={[styles.reveal, { backgroundColor: roleKnown ? (amImposter ? colors.crimson : colors.violet) : colors.inkSurfaceRaised }]}>
        <Text style={[styles.revealSmall, !roleKnown && { color: colors.textMuted }]}>Your secret role</Text>
        <Text style={[styles.revealBig, !roleKnown && { color: colors.text }]}>{roleKnown ? (amImposter ? 'IMPOSTER' : 'CREW') : '…'}</Text>
        <Text style={[styles.revealSmall, !roleKnown && { color: colors.textMuted }]}>
          {roleKnown ? (amImposter ? 'Eliminate crew up close, sabotage comms, and don’t get caught. Your tasks are fake cover.' : 'Walk to your stations, scan them and solve the puzzles. Find the imposter.') : 'Getting your role…'}
        </Text>
        <Text style={[styles.revealCount, !roleKnown && { color: colors.text }]}>{left}</Text>
        <Text style={[styles.revealSmall, !roleKnown && { color: colors.textMuted }]}>Hide your screen!</Text>
      </View>
    )
  }

  if (state.phase === 'ended') return <Summary state={state} meId={meId} avatarOf={avatarOf} isHost={isHost} room={room} snap={snap} onExit={onExit} />

  if (state.phase === 'meeting' && state.meeting) {
    const m = state.meeting
    const discussing = now < m.discussUntil
    const myVote = m.votes[meId]
    const vote = (target) => { buzz('select'); room.sendAction({ type: 'vote', target }) }
    return (
      <ScrollView contentContainerStyle={styles.pad}>
        <Text style={[type.display, { textAlign: 'center' }]}>{m.kind === 'body' ? 'Body reported' : 'Emergency meeting'}</Text>
        <Text style={[type.caption, { textAlign: 'center', marginTop: 4 }]}>
          {m.kind === 'body' ? `${state.players[m.calledBy]?.name} found ${state.players[m.body]?.name}.` : `Called by ${state.players[m.calledBy]?.name}.`}
        </Text>
        <Card style={{ marginTop: 12, alignItems: 'center' }}>
          <Text style={type.label}>{discussing ? 'Discussion' : 'Voting'}</Text>
          <Text style={type.display}>{formatClock((discussing ? m.discussUntil : m.endsAt) - now)}</Text>
          <Text style={[type.caption, { textAlign: 'center' }]}>
            {discussing ? 'Talk it over (in person or in chat 💬). Voting opens when the timer ends.' : 'More than half of the living players must agree to eject someone.'}
          </Text>
        </Card>
        <Card>
          {Object.keys(state.players).filter((id) => state.players[id].alive).map((id) => (
            <PlayerRow
              key={id}
              player={{ username: id === meId ? `${state.players[id].name} (you)` : state.players[id].name, avatar: avatarOf(id) }}
              subtitle={m.votes[id] !== undefined ? 'Voted ✓' : discussing ? '' : 'Deciding…'}
              right={me.alive && !discussing && myVote === undefined && id !== meId
                ? <Btn title="Vote" size="sm" variant="primary" onPress={() => vote(id)} />
                : myVote === id ? <Pill text="YOUR VOTE" color={colors.magenta} /> : null}
            />
          ))}
        </Card>
        {me.alive
          ? !discussing && (myVote === undefined
            ? <Btn title="Skip vote" onPress={() => vote('skip')} />
            : <Text style={[type.caption, { textAlign: 'center' }]}>{myVote === 'skip' ? 'You skipped.' : 'Vote cast.'} Waiting for others…</Text>)
          : <Text style={[type.caption, { textAlign: 'center' }]}>Ghosts can’t vote.</Text>}
      </ScrollView>
    )
  }

  // ---- playing ----
  const sabotaged = !!state.sabotage
  const myTasks = state.tasks[meId] || []
  const killReady = killReadyAt ?? (state.startsAt + state.killCooldownMs)
  const killWait = Math.max(0, killReady - now)
  const meetingWait = Math.max(0, state.meetingReadyAt - now)
  const lm = state.lastMeeting
  const nearBody = Object.entries(state.bodies).find(([, b]) => !b.reported && engine.within(myPos, b, engine.REPORT_RANGE_M))
  const atAnyStation = stations.some((st) => engine.within(myPos, st, engine.STATION_RANGE_M))
  const task = activeTask != null ? myTasks[activeTask] : null

  return (
    <ScrollView contentContainerStyle={styles.pad} keyboardShouldPersistTaps="handled">
      <Pressable onPress={() => setShowRole((v) => !v)} accessibilityRole="button" accessibilityLabel="Show or hide your role">
        <View style={[styles.role, { backgroundColor: showRole && roleKnown ? (amImposter ? colors.crimson : colors.violet) : colors.inkSurfaceRaised }]}>
          {showRole && roleKnown ? (
            <>
              <Text style={styles.roleTitle}>{amImposter ? '🎭 Imposter' : '🧑‍🚀 Crew'}</Text>
              <Text style={styles.roleSub}>{amImposter ? 'Eliminate, sabotage, blend in.' : 'Do your tasks. Find the imposter.'} Tap to hide.</Text>
            </>
          ) : (
            <Text style={[type.body, { textAlign: 'center' }]}>{roleKnown ? 'Tap to see your role' : 'Getting your role…'}</Text>
          )}
        </View>
      </Pressable>

      {sabotaged && (
        <View style={[styles.alert, { backgroundColor: colors.crimson }]}>
          <Text style={styles.alertText}>📡 Comms down · {formatClock(state.sabotage.until - now)}</Text>
          <Text style={styles.alertSub}>Progress and player distances are hidden. Fix it at any station.</Text>
          {me.alive && atAnyStation && <Btn title="Fix comms" size="sm" onPress={() => { buzz('medium'); room.sendAction({ type: 'fix' }) }} style={{ marginTop: 8 }} />}
        </View>
      )}
      {nearBody && me.alive && (
        <View style={[styles.alert, { backgroundColor: colors.danger }]}>
          <Text style={styles.alertText}>☠️ {state.players[nearBody[0]]?.name}’s body is here</Text>
          <Btn title="Report body" size="sm" onPress={() => { buzz('heavy'); room.sendAction({ type: 'report', body: nearBody[0] }) }} style={{ marginTop: 8 }} />
        </View>
      )}
      {!me.alive && <Card><Text style={type.body}>👻 You’re a ghost. You can’t vote or call meetings{amImposter ? '' : ', but your tasks still count'}.</Text></Card>}
      {!!notice && <Card><Text style={type.body}>{notice}</Text></Card>}
      {lm && now - lm.at < 25000 && (
        <Card>
          <Text style={type.body}>
            {lm.ejected ? `${state.players[lm.ejected]?.name} was ejected. They were ${lm.wasImposter ? '' : 'not '}the imposter.` : `No one was ejected (${lm.skip} skipped).`}
          </Text>
        </Card>
      )}

      <Card>
        <Text style={type.label}>Crew task progress</Text>
        {sabotaged ? (
          <Text style={[type.caption, { marginTop: 6 }]}>Unavailable while comms are down</Text>
        ) : (
          <View style={styles.track}><View style={[styles.fill, { width: `${Math.round(state.progress * 100)}%` }]} /></View>
        )}
      </Card>

      <Card>
        <Text style={[type.label, { marginBottom: 6 }]}>{amImposter ? 'Cover tasks (don’t count)' : 'Your tasks'}</Text>
        {myTasks.map((t, i) => {
          const st = stationById[t.stationId]
          if (!st) return null
          const d = myPos ? distanceMeters(myPos, st) : Infinity
          const here = engine.within(myPos, st, engine.STATION_RANGE_M)
          return (
            <View key={`${t.stationId}-${i}`} style={styles.taskRow}>
              <StationImage room={room} station={st} assets={snap.assets} style={styles.taskImg} />
              <View style={{ flex: 1, marginLeft: 10 }}>
                <Text style={[type.body, t.done && styles.doneText]} numberOfLines={1}>{st.name}</Text>
                <Text style={type.caption}>{t.done ? 'Done ✓' : `${PUZZLES[t.puzzle]} · ${here ? 'You’re here' : myPos ? `${formatDistance(d)} ${compassLabel(bearingDeg(myPos, st))}` : '—'}`}</Text>
              </View>
              {!t.done && <Btn title="Scan" size="sm" variant="primary" disabled={!here || state.phase !== 'playing'} onPress={() => setActiveTask(i)} />}
            </View>
          )
        })}
      </Card>

      <Card>
        <Text style={[type.label, { marginBottom: 4 }]}>Players</Text>
        {amImposter && me.alive && (
          <Text style={[type.caption, { marginBottom: 4 }]}>
            {killWait > 0 ? `Eliminate ready in ${Math.ceil(killWait / 1000)}s` : `Get within about ${Math.round(engine.KILL_RANGE_M * 3.28)} ft to eliminate.`}
          </Text>
        )}
        {others.map((o) => {
          const canKill = amImposter && me.alive && o.alive && present(o.id) && killWait === 0 && o.pos && myPos && engine.within(myPos, o.pos, engine.KILL_RANGE_M)
          return (
            <PlayerRow
              key={o.id}
              player={{ username: o.name, avatar: avatarOf(o.id) }}
              dim={!o.alive || !present(o.id)}
              subtitle={!present(o.id) ? 'Disconnected' : o.ejected ? 'Ejected' : !o.alive ? '' : sabotaged ? '—' : o.pos ? `${formatDistance(o.d)} away` : 'No location yet'}
              right={amImposter && me.alive && o.alive
                ? <Btn title="Eliminate" size="sm" variant="danger" disabled={!canKill} onPress={() => room.sendAction({ type: 'kill', target: o.id })} />
                : null}
            />
          )
        })}
      </Card>

      {me.alive && (
        <View style={{ gap: 10 }}>
          <Btn
            title={me.emergencies <= 0 ? 'Emergency meeting used' : meetingWait > 0 ? `Emergency meeting (${Math.ceil(meetingWait / 1000)}s)` : 'Emergency meeting'}
            variant="primary"
            disabled={me.emergencies <= 0 || meetingWait > 0 || sabotaged}
            onPress={() => { buzz('heavy'); room.sendAction({ type: 'meeting' }) }}
          />
          {amImposter && <Btn title="Sabotage comms" variant="danger" disabled={sabotaged} onPress={() => room.sendAction({ type: 'sabotage' })} />}
        </View>
      )}
      {state.feed.length > 0 && (
        <Card style={{ marginTop: 12 }}>
          {state.feed.map((f) => <Text key={f.id} style={[type.caption, { marginVertical: 2 }]}>{f.text}</Text>)}
        </Card>
      )}

      <ScanTask
        visible={!!task && !task.done}
        room={room}
        station={task ? stationById[task.stationId] : null}
        assets={snap.assets}
        puzzle={task?.puzzle}
        fake={amImposter}
        onClose={() => setActiveTask(null)}
        onDone={() => {
          const i = activeTask
          setActiveTask(null)
          room.sendAction({ type: 'task', index: i })
        }}
      />
    </ScrollView>
  )
}

const REASONS = {
  'imposter-left': 'The imposter left the game.',
  ejected: 'The crew voted out the imposter!',
  tasks: 'The crew finished every task!',
  outnumbered: 'The imposter outnumbered the crew.',
}

function Summary({ state, meId, avatarOf, isHost, room, snap, onExit }) {
  const imp = state.players[state.imposterId]
  const iWon = state.imposterId ? (state.winner === 'imposter') === (state.imposterId === meId) : state.winner === 'crew'
  const mvp = state.mvp ? state.players[state.mvp] : null
  const correct = state.stats?.correctVotes || {}
  return (
    <ScrollView contentContainerStyle={styles.pad}>
      <Text style={[type.display, { textAlign: 'center' }]}>{state.winner === 'crew' ? 'Crew wins' : 'Imposter wins'}</Text>
      <Text style={[type.body, { textAlign: 'center', marginVertical: 6 }]}>{REASONS[state.reason] || ''}</Text>
      <Text style={[type.title, { textAlign: 'center', marginBottom: 12, color: iWon ? colors.success : colors.danger }]}>{iWon ? 'You won!' : 'You lost'}</Text>
      <Card>
        <Text style={type.label}>The imposter was</Text>
        {imp ? <PlayerRow player={{ id: state.imposterId, username: imp.name, avatar: avatarOf(state.imposterId) }} right={<Text style={{ fontSize: 22 }}>🎭</Text>} /> : <Text style={type.caption}>A player who left the game.</Text>}
      </Card>
      {mvp && (
        <Card>
          <Text style={type.label}>MVP</Text>
          <PlayerTap player={{ id: state.mvp, username: mvp.name, avatar: avatarOf(state.mvp) }} style={styles.mvp}>
            <Avatar uri={avatarOf(state.mvp)} name={mvp.name} size={50} />
            <View style={{ flex: 1, marginLeft: 12 }}>
              <Text style={type.title}>{mvp.name}</Text>
              <Text style={type.caption}>{state.mvp === state.imposterId ? 'Imposter' : `${mvp.tasksDone} tasks · ${correct[state.mvp] || 0} correct votes`}</Text>
            </View>
            <Text style={{ fontSize: 28 }}>⭐</Text>
          </PlayerTap>
        </Card>
      )}
      <Card>
        <Text style={[type.label, { marginBottom: 4 }]}>Everyone</Text>
        {Object.entries(state.players).map(([id, p]) => (
          <PlayerRow
            key={id}
            player={{ id, username: id === meId ? `${p.name} (you)` : p.name, avatar: avatarOf(id) }}
            subtitle={`${id === state.imposterId ? 'Imposter' : 'Crew'} · ${p.ejected ? 'ejected' : p.alive ? 'survived' : 'eliminated'} · ${p.tasksDone} tasks · ${correct[id] || 0} correct votes`}
          />
        ))}
      </Card>
      {isHost
        ? <Btn title="Play again" variant="primary" onPress={() => room.setInfo({ round: (snap.info.round || 0) + 1 })} />
        : <Text style={[type.caption, { textAlign: 'center' }]}>Waiting for the host to start another round…</Text>}
      <Btn title="Leave" onPress={onExit} style={{ marginTop: 12 }} />
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  pad: { padding: 12, paddingBottom: 40 },
  reveal: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28 },
  revealSmall: { ...type.body, color: colors.onBrandMuted, textAlign: 'center', marginTop: 8 },
  revealBig: { fontSize: 48, fontWeight: '800', letterSpacing: 3, color: colors.onBrand, marginTop: 8 },
  revealCount: { fontSize: 72, fontWeight: '800', color: colors.onBrand, marginTop: 20 },
  role: { borderRadius: radii.md, padding: 16, marginBottom: 12, minHeight: 64, justifyContent: 'center' },
  roleTitle: { ...type.title, color: colors.onBrand },
  roleSub: { ...type.caption, color: colors.onBrandMuted, marginTop: 4 },
  alert: { borderRadius: radii.md, padding: 14, marginBottom: 12 },
  alertText: { ...type.body, fontWeight: '700', color: colors.onBrand },
  alertSub: { ...type.caption, color: colors.onBrandMuted, marginTop: 4 },
  track: { height: 10, borderRadius: 5, backgroundColor: colors.hairline, overflow: 'hidden', marginTop: 8 },
  fill: { height: 10, borderRadius: 5, backgroundColor: colors.success },
  taskRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8 },
  taskImg: { width: 52, height: 52 },
  doneText: { color: colors.textFaint, textDecorationLine: 'line-through' },
  mvp: { flexDirection: 'row', alignItems: 'center', marginTop: 8 },
})
