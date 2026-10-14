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
//
// Like Among Us, a kill isn't announced: until the body is reported, living crew
// still see the victim listed as a normal player.
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { formatClock } from './MultiplayerUI'
import { StationImage } from './beside/StationImage'
import { ScanTask } from './beside/ScanTask'
import { PUZZLES } from './beside/Puzzles'
import * as engine from './beside/engine'
import {
  StBanner, StFeed, StGrid, StHero, StLabel, StLocationGate, StMvp, StPlayerRow, StPlayerTile, StResultsFooter,
  StReveal, StRing, StScreen, StSection, StSpectating, StStats, StTag,
} from './beside/studioKit'
import {
  bearingDeg, compassLabel, distanceMeters, formatDistance, offsetMeters, recordRoundResult,
  useHostLoop, useRoomClock, useRoomPositions, useRoomSnapshot, useSharedLocation,
} from '../lib/multiplayer'
import { buzz } from '../lib/gamePrefs'
import { FONT, ST, StBar, StButton, stGlow, stType, useStudioFonts, withAlpha } from './studio'

const roleColor = (imposter) => (imposter ? ST.enemy : ST.friendly)

export function BesideThemGame({ room, onExit }) {
  useStudioFonts()
  const snap = useRoomSnapshot(room)
  const positions = useRoomPositions(room)
  const now = useRoomClock(room, 500)
  const loc = useSharedLocation(room)
  const [myRole, setMyRole] = useState(null) // { round, role }
  const [showRole, setShowRole] = useState(false)
  const [activeTask, setActiveTask] = useState(null) // index
  const [killReadyAt, setKillReadyAt] = useState(null)
  const [pick, setPick] = useState(null) // { key, id } vote selection
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
  const area = snap?.info?.settings?.area || null
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
    if (phase === 'meeting' && prevPhase.current === 'playing') { buzz('warning'); setActiveTask(null) }
    prevPhase.current = phase
  }, [phase])
  useEffect(() => { setPick(null) }, [state?.meetingNo])
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
  }, [state, positions, myPos, meId])

  // ---- render ----
  if (!room || !snap) return null
  if (loc.status !== 'granted') return <StLocationGate status={loc.status} onExit={onExit} what="Beside Them" />
  if (!state) return <StSpectating title="Starting" text="Choosing the imposter…" />
  if (!me) return <StSpectating />

  const avatarOf = (id) => snap.roster.find((r) => r.id === id)?.avatar
  const nameOf = (id) => state.players[id]?.name || '?'
  const playerOf = (id) => ({ id, username: id === meId ? `${nameOf(id)} (you)` : nameOf(id), avatar: avatarOf(id) })
  const present = (id) => snap.roster.some((r) => r.id === id)

  if (state.phase === 'countdown') {
    const left = Math.max(0, Math.ceil((state.startsAt - now) / 1000))
    return (
      <StReveal
        kicker="Beside Them · your secret role"
        title={roleKnown ? (amImposter ? 'Imposter' : 'Crew') : 'Dealing'}
        color={roleKnown ? roleColor(amImposter) : ST.muted}
        icon={roleKnown ? (amImposter ? 'skull-outline' : 'construct-outline') : 'help-circle-outline'}
        body={roleKnown ? (amImposter ? 'Eliminate crew up close, sabotage comms, and don’t get caught. Your tasks are fake cover.' : 'Walk to your stations, scan them and solve the puzzles. Find the imposter.') : 'Getting your role…'}
        count={left}
        foot="Hide your screen"
      />
    )
  }

  if (state.phase === 'ended') return <Summary state={state} meId={meId} playerOf={playerOf} avatarOf={avatarOf} isHost={isHost} room={room} snap={snap} onExit={onExit} />

  if (state.phase === 'meeting' && state.meeting) {
    const m = state.meeting
    const discussing = now < m.discussUntil
    const myVote = m.votes[meId]
    const canVote = me.alive && !discussing && myVote === undefined
    const key = `m-${state.meetingNo}`
    const sel = pick?.key === key ? pick.id : null
    const vote = (target) => { buzz('select'); room.sendAction({ type: 'vote', target }) }
    const aliveIds = Object.keys(state.players).filter((id) => state.players[id].alive)
    const deadIds = Object.keys(state.players).filter((id) => !state.players[id].alive)
    const votedCount = Object.keys(m.votes).length
    const total = discussing ? state.discussMs : engine.VOTE_MS
    const left = Math.max(0, (discussing ? m.discussUntil : m.endsAt) - now)
    const c = m.kind === 'body' ? ST.enemy : ST.objective
    return (
      <StScreen>
        <StHero
          kicker={`${m.kind === 'body' ? 'Body reported' : 'Emergency meeting'} · ${discussing ? 'discussion' : 'voting'}`}
          color={c}
          title={m.kind === 'body' ? `${nameOf(m.body)} was found` : 'Who is it?'}
          sub={m.kind === 'body' ? `${nameOf(m.calledBy)} reported the body.` : `Called by ${nameOf(m.calledBy)}.`}
        />
        <View style={styles.ringRow}>
          <StRing size={78} color={c} progress={left / Math.max(1, total)} value={formatClock(left)} unit={discussing ? 'talk' : 'vote'} />
        </View>
        <Text style={[stType.small, { textAlign: 'center', marginBottom: 10 }]}>
          {discussing ? 'Talk it over — in person or in chat. Voting opens when the timer ends.' : 'Most votes is ejected. A tie, or Skip on top, ejects no one.'}
        </Text>
        <StSection label={`Alive · ${aliveIds.length}`} right={discussing ? null : `${votedCount} voted`}>
          <StGrid cols={3}>
            {aliveIds.map((id) => (
              <StPlayerTile
                key={id}
                player={playerOf(id)}
                tag={m.votes[id] !== undefined ? 'Voted' : id === m.calledBy ? (m.kind === 'body' ? 'Reported' : 'Called') : discussing ? 'Alive' : 'Deciding'}
                color={ST.enemy}
                selected={(canVote ? sel : myVote) === id}
                disabled={!canVote || id === meId}
                onPress={() => setPick({ key, id })}
              />
            ))}
          </StGrid>
        </StSection>
        {canVote ? (
          <View style={{ flexDirection: 'row', gap: 8, marginBottom: 10 }}>
            <StButton title={sel ? `Eject ${nameOf(sel)}` : 'Pick a suspect'} tone="danger" disabled={!sel} style={{ flex: 1 }} onPress={() => vote(sel)} />
            <StButton title="Skip" tone="ghost" style={{ width: 100 }} onPress={() => vote('skip')} />
          </View>
        ) : me.alive && !discussing ? (
          <StBanner icon="checkmark" color={ST.enemy} text={myVote === 'skip' ? 'You skipped. Waiting for others…' : `You voted for ${nameOf(myVote)}. Waiting for others…`} />
        ) : !me.alive ? (
          <StBanner icon="eye-outline" color={ST.muted} text="Ghosts can’t vote. Keep it quiet." />
        ) : null}
        {deadIds.length ? (
          <StSection label="Out">
            {deadIds.map((id) => <StPlayerRow key={id} player={playerOf(id)} dim subtitle={state.players[id].ejected ? 'Ejected' : 'Eliminated'} />)}
          </StSection>
        ) : null}
      </StScreen>
    )
  }

  // ---- playing ----
  const sabotaged = !!state.sabotage
  const myTasks = state.tasks[meId] || []
  const lm = state.lastMeeting
  // Kill cooldown starts at round start and restarts after every meeting (host rule).
  const killReady = Math.max(killReadyAt || 0, state.startsAt + state.killCooldownMs, lm?.at ? lm.at + state.killCooldownMs : 0)
  const killWait = Math.max(0, killReady - now)
  const meetingWait = Math.max(0, state.meetingReadyAt - now)
  const nearBody = Object.entries(state.bodies).find(([, b]) => !b.reported && engine.within(myPos, b, engine.REPORT_RANGE_M))
  const atAnyStation = stations.some((st) => engine.within(myPos, st, engine.STATION_RANGE_M))
  const task = activeTask != null ? myTasks[activeTask] : null
  const doneCount = myTasks.filter((t) => t.done).length
  const hereIndex = myTasks.findIndex((t) => !t.done && stationById[t.stationId] && engine.within(myPos, stationById[t.stationId], engine.STATION_RANGE_M))
  const hereStation = hereIndex >= 0 ? stationById[myTasks[hereIndex].stationId] : null
  const hideDeaths = me.alive && !amImposter
  const shownAlive = (o) => o.alive || (hideDeaths && !o.ejected && state.bodies[o.id] && !state.bodies[o.id].reported)
  const list = [...others].sort((a, b) => (shownAlive(b) - shownAlive(a)) || (a.d - b.d))

  return (
    <StScreen keyboardShouldPersistTaps="handled">
      <View style={styles.topRow}>
        <Pressable
          onPress={() => setShowRole((v) => !v)}
          accessibilityRole="button"
          accessibilityLabel="Show or hide your role"
          style={[styles.roleChip, showRole && roleKnown ? { backgroundColor: withAlpha(roleColor(amImposter), 0.14), borderLeftColor: roleColor(amImposter) } : null]}
        >
          <Text style={[stType.label, showRole && roleKnown ? { color: roleColor(amImposter) } : null]}>Your role</Text>
          <Text style={[stType.name, { fontSize: 18 }]}>{showRole && roleKnown ? (amImposter ? 'IMPOSTER' : 'CREW') : roleKnown ? 'TAP TO PEEK' : '…'}</Text>
        </Pressable>
        <View style={{ flex: 1, alignItems: 'flex-end' }}>
          <StLabel>{sabotaged ? 'Crew tasks · comms down' : `Crew tasks · ${Math.round(state.progress * 100)}%`}</StLabel>
          <StBar value={sabotaged ? 0 : state.progress} color={ST.health} height={8} style={{ width: '100%', maxWidth: 160, marginTop: 4 }} />
        </View>
      </View>

      {sabotaged && (
        <StBanner solid color={ST.enemy} icon="radio-outline" text={`Comms down · ${formatClock(state.sabotage.until - now)}`} sub="Progress and player distances are hidden. Fix it at any station.">
          {me.alive && atAnyStation ? <StButton title="Fix comms" tone="white" height={38} onPress={() => { buzz('medium'); room.sendAction({ type: 'fix' }) }} style={{ marginTop: 8 }} /> : null}
        </StBanner>
      )}
      {!!notice && <StBanner text={notice} color={ST.objective} icon="information-circle-outline" />}
      {!me.alive && <StBanner icon="eye-outline" color={ST.muted} text={`You’re a ghost. You can’t vote or call meetings${amImposter ? '' : ', but your tasks still count'}.`} />}
      {lm && now - lm.at < 25000 && (
        <StBanner
          icon={lm.ejected ? 'person-remove-outline' : 'remove-circle-outline'}
          color={lm.ejected ? (lm.wasImposter ? ST.health : ST.enemy) : ST.muted}
          text={lm.ejected ? `${nameOf(lm.ejected)} was ejected. They were ${lm.wasImposter ? '' : 'not '}the imposter.` : `No one was ejected (${lm.skip} skipped).`}
        />
      )}

      <StationMap area={area} stations={stations} myPos={myPos} tasks={myTasks} />

      <StSection label={`${amImposter ? 'Cover tasks · don’t count' : 'Your tasks'} · ${doneCount} of ${myTasks.length}`}>
        {myTasks.map((t, i) => {
          const st = stationById[t.stationId]
          if (!st) return null
          const d = myPos ? distanceMeters(myPos, st) : Infinity
          const here = engine.within(myPos, st, engine.STATION_RANGE_M)
          return (
            <Pressable
              key={`${t.stationId}-${i}`}
              onPress={!t.done && here && state.phase === 'playing' ? () => setActiveTask(i) : undefined}
              style={[styles.taskRow, t.done && { opacity: 0.55 }, here && !t.done && { borderColor: ST.objective }]}
              accessibilityRole={!t.done && here ? 'button' : undefined}
              accessibilityLabel={`${st.name}, ${PUZZLES[t.puzzle]}${t.done ? ', done' : here ? ', you’re here' : ''}`}
            >
              <View style={[styles.taskMark, t.done ? { backgroundColor: ST.health, borderColor: ST.health } : { borderColor: ST.objective }]} />
              <StationImage room={room} station={st} assets={snap.assets} style={styles.taskImg} />
              <View style={{ flex: 1, minWidth: 0, marginLeft: 10 }}>
                <Text style={[stType.name, { fontSize: 14, fontFamily: FONT.ui }]} numberOfLines={1}>{st.name} · {PUZZLES[t.puzzle]}</Text>
                <Text style={[stType.small, { fontSize: 11 }]} numberOfLines={1}>{t.done ? 'Done' : here ? 'You’re here — scan it' : myPos ? `${compassLabel(bearingDeg(myPos, st))} · ${formatDistance(d)}` : '—'}</Text>
              </View>
              <Text style={[stType.label, { color: t.done ? ST.health : here ? ST.objective : ST.muted }]}>{t.done ? 'Done' : here ? 'Here' : formatDistance(d)}</Text>
            </Pressable>
          )
        })}
      </StSection>

      {me.alive ? (
        <View style={styles.actionGrid}>
          <Pressable
            onPress={nearBody ? () => { buzz('heavy'); room.sendAction({ type: 'report', body: nearBody[0] }) } : undefined}
            disabled={!nearBody}
            accessibilityRole="button"
            accessibilityState={{ disabled: !nearBody }}
            accessibilityLabel={nearBody ? `Report ${nameOf(nearBody[0])}’s body` : 'Report body, no body nearby'}
            style={({ pressed }) => [styles.bigBtn, { backgroundColor: ST.enemy, borderColor: ST.enemy, opacity: nearBody ? (pressed ? 0.85 : 1) : 0.35 }, nearBody && stGlow(ST.enemy, 14)]}
          >
            <Text style={[stType.button, { color: '#fff' }]}>Report body</Text>
            <Text style={[styles.bigSub, { color: '#fff' }]} numberOfLines={1}>{nearBody ? `${nameOf(nearBody[0])} is here` : `Within ${formatDistance(engine.REPORT_RANGE_M)}`}</Text>
          </Pressable>
          <Pressable
            onPress={() => { buzz('heavy'); room.sendAction({ type: 'meeting' }) }}
            disabled={me.emergencies <= 0 || meetingWait > 0 || sabotaged}
            accessibilityRole="button"
            accessibilityState={{ disabled: me.emergencies <= 0 || meetingWait > 0 || sabotaged }}
            accessibilityLabel="Call an emergency meeting"
            style={({ pressed }) => [styles.bigBtn, { borderColor: ST.objective, opacity: me.emergencies <= 0 || meetingWait > 0 || sabotaged ? 0.4 : pressed ? 0.8 : 1 }]}
          >
            <Text style={[stType.button, { color: ST.objective }]}>Emergency</Text>
            <Text style={styles.bigSub} numberOfLines={1}>
              {me.emergencies <= 0 ? 'Used' : sabotaged ? 'Fix comms first' : meetingWait > 0 ? `Ready in ${Math.ceil(meetingWait / 1000)} s` : `${me.emergencies} left`}
            </Text>
          </Pressable>
        </View>
      ) : null}

      <StButton
        title={hereStation ? `Scan station · ${hereStation.name}` : 'Walk to a task station'}
        disabled={!hereStation || state.phase !== 'playing'}
        onPress={() => setActiveTask(hereIndex)}
        left={<Ionicons name="scan-outline" size={18} color={ST.ink} />}
        style={{ marginBottom: 10 }}
      />
      {amImposter && me.alive ? (
        <View style={{ flexDirection: 'row', gap: 8, marginBottom: 10 }}>
          <View style={[styles.killChip, { borderColor: killWait > 0 ? ST.line : ST.enemy }]}>
            <Text style={stType.label}>Eliminate</Text>
            <Text style={[stType.num, { fontSize: 18, color: killWait > 0 ? ST.muted : ST.enemy }]}>{killWait > 0 ? `${Math.ceil(killWait / 1000)} s` : 'READY'}</Text>
          </View>
          <StButton title="Sabotage comms" tone="outline" color={ST.enemy} disabled={sabotaged} style={{ flex: 1 }} onPress={() => room.sendAction({ type: 'sabotage' })} />
        </View>
      ) : null}

      <StSection label="Players" right={amImposter && me.alive ? `Range ~${Math.round(engine.KILL_RANGE_M * 3.28)} ft` : null}>
        {list.map((o) => {
          const showAlive = shownAlive(o)
          const canKill = amImposter && me.alive && o.alive && present(o.id) && killWait === 0 && o.pos && myPos && engine.within(myPos, o.pos, engine.KILL_RANGE_M)
          return (
            <StPlayerRow
              key={o.id}
              player={{ id: o.id, username: o.name, avatar: avatarOf(o.id) }}
              dim={!showAlive || !present(o.id)}
              subtitle={!present(o.id) ? 'Disconnected' : o.ejected ? 'Ejected' : !showAlive ? 'Eliminated' : sabotaged ? '—' : o.pos ? `${formatDistance(o.d)} away` : 'No location yet'}
              right={amImposter && me.alive && o.alive
                ? <StButton title="Kill" tone="danger" height={34} disabled={!canKill} style={{ minWidth: 64, paddingHorizontal: 10 }} onPress={() => room.sendAction({ type: 'kill', target: o.id })} />
                : null}
            />
          )
        })}
      </StSection>

      <StFeed items={state.feed} />

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
    </StScreen>
  )
}

// North-up map of the play area: my task stations (objective, done = green), other
// stations (outline) and me (friendly triangle). Other players are never drawn.
function StationMap({ area, stations, myPos, tasks }) {
  const { width } = useWindowDimensions()
  const w = Math.max(240, width - 24)
  const h = Math.min(260, Math.round(w * 0.7))
  const center = area || myPos || stations[0]
  if (!center) return null
  const far = Math.max(30, ...stations.map((st) => distanceMeters(center, st)), myPos ? distanceMeters(center, myPos) : 0)
  const radiusM = (area ? Math.max(area.r, far) : far) * 1.15
  const scale = (Math.min(w, h) / 2 - 14) / radiusM
  const place = (p) => {
    const { x, y } = offsetMeters(center, p)
    return { left: w / 2 + x * scale, top: h / 2 - y * scale }
  }
  const mine = {}
  for (const t of tasks) mine[t.stationId] = mine[t.stationId] || (t.done ? 'done' : 'todo')
  for (const t of tasks) if (!t.done) mine[t.stationId] = 'todo'
  const me = myPos ? place(myPos) : null
  const ar = area ? area.r * scale : 0
  return (
    <View style={[styles.map, { width: w, height: h }]} accessibilityLabel="Map of task stations">
      <View style={[styles.mapStripe, { top: h / 2 - 9, left: 0, width: w, height: 18 }]} />
      <View style={[styles.mapStripe, { left: w / 2 - 9, top: 0, width: 18, height: h }]} />
      {area ? <View style={[styles.areaRing, { left: w / 2 - ar, top: h / 2 - ar, width: ar * 2, height: ar * 2, borderRadius: ar }]} /> : null}
      <Text style={[stType.label, { position: 'absolute', top: 6, left: 8 }]}>N ↑</Text>
      {stations.map((st) => {
        const p = place(st)
        const kind = mine[st.id]
        const right = p.left > w * 0.62
        return (
          <View key={st.id} pointerEvents="none" style={[styles.station, { top: p.top - 6 }, right ? { right: w - p.left - 6, flexDirection: 'row-reverse' } : { left: p.left - 6 }]}>
            <View style={[
              styles.diamond,
              kind === 'done' ? { backgroundColor: ST.health } : kind === 'todo' ? [{ backgroundColor: ST.objective }, stGlow(ST.objective, 10)] : { borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.4)' },
            ]} />
            <Text style={[styles.stationLabel, right ? { marginRight: 4 } : { marginLeft: 4 }, !kind && { color: ST.muted }]} numberOfLines={1}>{st.name.toUpperCase()}</Text>
          </View>
        )
      })}
      {me ? <View pointerEvents="none" style={[styles.meArrow, { left: Math.max(0, Math.min(w - 14, me.left - 7)), top: Math.max(0, Math.min(h - 18, me.top - 9)) }]} /> : null}
    </View>
  )
}

const REASONS = {
  'imposter-left': 'The imposter left the game',
  ejected: 'The crew voted out the imposter',
  tasks: 'The crew finished every task',
  outnumbered: 'The imposter outnumbered the crew',
}

function Summary({ state, meId, playerOf, avatarOf, isHost, room, snap, onExit }) {
  const imp = state.players[state.imposterId]
  const iWon = state.imposterId ? (state.winner === 'imposter') === (state.imposterId === meId) : state.winner === 'crew'
  const mvp = state.mvp ? state.players[state.mvp] : null
  const correct = state.stats?.correctVotes || {}
  const winColor = state.winner === 'crew' ? ST.friendly : ST.enemy
  const ids = Object.keys(state.players)
  const mine = state.players[meId]
  return (
    <StScreen>
      <StHero
        kicker={`Beside Them · ${REASONS[state.reason] || 'round over'}`}
        title={iWon ? 'Victory' : 'Defeat'}
        sub={state.winner === 'crew' ? 'Crew wins' : 'Imposter wins'}
        color={iWon ? winColor : ST.enemy}
        big
      />
      <StStats items={[
        { label: 'Crew tasks', value: `${Math.round((state.progress || 0) * 100)}%`, color: ST.health },
        { label: 'Meetings', value: String(state.meetingNo || 0) },
        { label: 'Your tasks', value: String(mine?.tasksDone || 0) },
        { label: 'Good votes', value: String(correct[meId] || 0) },
      ]} />
      <StSection label="The imposter was" accent={ST.enemy}>
        {imp
          ? <StPlayerRow player={playerOf(state.imposterId)} color={ST.enemy} subtitle={imp.ejected ? 'Ejected' : imp.alive ? 'Survived' : 'Out'} right={<StTag text="Imposter" color={ST.enemy} solid />} />
          : <Text style={stType.small}>A player who left the game.</Text>}
      </StSection>
      {mvp ? (
        <StMvp
          player={{ id: state.mvp, username: mvp.name, avatar: avatarOf(state.mvp) }}
          line={state.mvp === state.imposterId ? 'Imposter' : `${mvp.tasksDone} tasks · ${correct[state.mvp] || 0} correct votes`}
        />
      ) : null}
      <StSection label="Played with · follow on iYiYi">
        {ids.map((id) => {
          const p = state.players[id]
          const isImp = id === state.imposterId
          return (
            <StPlayerRow
              key={id}
              player={playerOf(id)}
              color={roleColor(isImp)}
              subtitle={`${p.ejected ? 'Ejected' : p.alive ? 'Survived' : 'Eliminated'} · ${p.tasksDone} tasks · ${correct[id] || 0} correct votes`}
              right={<StTag text={isImp ? 'Imposter' : 'Crew'} color={roleColor(isImp)} />}
            />
          )
        })}
      </StSection>
      <StFeed items={state.feed} />
      <StResultsFooter isHost={isHost} onAgain={() => room.setInfo({ round: (snap.info.round || 0) + 1 })} onExit={onExit} />
    </StScreen>
  )
}

const styles = StyleSheet.create({
  ringRow: { alignItems: 'center', marginBottom: 8 },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 10 },
  roleChip: { paddingVertical: 6, paddingHorizontal: 12, borderLeftWidth: 3, borderLeftColor: ST.lineStrong, backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: ST.radius, minWidth: 130 },
  map: { alignSelf: 'center', backgroundColor: '#18202a', borderWidth: 1, borderColor: ST.line, overflow: 'hidden', marginBottom: 10, borderRadius: ST.radius },
  mapStripe: { position: 'absolute', backgroundColor: 'rgba(255,255,255,0.05)' },
  areaRing: { position: 'absolute', borderWidth: 1, borderColor: withAlpha(ST.friendly, 0.35), borderStyle: 'dashed' },
  station: { position: 'absolute', flexDirection: 'row', alignItems: 'center' },
  diamond: { width: 12, height: 12, transform: [{ rotate: '45deg' }] },
  stationLabel: { fontFamily: FONT.ui, fontSize: 11, color: ST.text, paddingHorizontal: 4, backgroundColor: 'rgba(8,10,14,0.8)', maxWidth: 120 },
  meArrow: { position: 'absolute', width: 0, height: 0, borderLeftWidth: 7, borderRightWidth: 7, borderBottomWidth: 18, borderLeftColor: 'transparent', borderRightColor: 'transparent', borderBottomColor: ST.friendly },
  taskRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6, paddingHorizontal: 8, marginVertical: 2, backgroundColor: 'rgba(255,255,255,0.04)', borderRadius: ST.radius, borderWidth: 1, borderColor: 'transparent' },
  taskMark: { width: 10, height: 10, borderWidth: 1.5, marginRight: 8 },
  taskImg: { width: 36, height: 36 },
  actionGrid: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  bigBtn: { flex: 1, height: 64, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderRadius: ST.radius, paddingHorizontal: 6 },
  bigSub: { fontFamily: FONT.uiSemi, fontSize: 11, color: ST.text, marginTop: 2 },
  killChip: { width: 110, paddingHorizontal: 10, justifyContent: 'center', borderWidth: 1, borderRadius: ST.radius },
})
