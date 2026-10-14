// Beside Them — real-world social deduction (4+ players).
//
// Crew walk to task stations (auto GPS waypoints, QR markers or photographed
// objects, or spots the host walked to and placed — see beside/Setup.js) and solve a
// short puzzle. A secret imposter eliminates crew up close with a hold (1.5 s by
// default, host setting: instant / 1 / 1.5 / 2 s), can sabotage comms, and fakes tasks.
//
// Floors: every phone with a barometer calibrates at the start spot during the countdown
// ("stand near the host") and sends its altitude to the host (bt_alt) every 2 s and on
// each action (`alt`). The host refuses tasks on another floor (walk & place stations)
// and eliminations through floors. No barometer: floors are ignored for that phone.
// Bodies can be reported, everyone gets one emergency meeting, and meetings run a
// discussion then a vote.
//
// The imposter's screen looks exactly like the crew's: no Kill / Sabotage buttons,
// no "cover task" labels. Secret actions live behind a hold on the role chip
// ("Hold to peek"), which opens the same sheet for everyone.
//
// Roles are private: the host tells each player only their own role with a
// message addressed to them. If the host drops, the new host asks everyone for
// their role ("whois") to recover the imposter's identity.
//
// Like Among Us, a kill isn't announced: until the body is reported, living crew
// still see the victim listed as a normal player.
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Animated, Easing, Modal, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { formatClock } from './MultiplayerUI'
import { StationImage } from './beside/StationImage'
import { ScanTask } from './beside/ScanTask'
import { QrScanSheet } from './beside/QrScan'
import { PUZZLES } from './beside/Puzzles'
import { TermHeader, TermScreen, pad2 } from './beside/terminal'
import { Toy } from './beside/toys'
import * as engine from './beside/engine'
import { SETUP_TAG, calibrate, readAlt, refTag, restoreRef, useBaro } from './beside/baro'
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
const NEARBY_M = 10
const CALIBRATE_AT_MS = 1500 // countdown time left when phones take their floor reference
const ALT_SEND_MS = 2000
const roundAlt = (a) => Math.round(a * 10) / 10

export function BesideThemGame({ room, onExit }) {
  useStudioFonts()
  const snap = useRoomSnapshot(room)
  const positions = useRoomPositions(room)
  const now = useRoomClock(room, 500)
  const loc = useSharedLocation(room)
  const [myRole, setMyRole] = useState(null) // { round, role }
  const [activeTask, setActiveTask] = useState(null) // index
  const [scannedCode, setScannedCode] = useState(null) // QR code that opened the active task
  const [qrOpen, setQrOpen] = useState(false)
  const [qrError, setQrError] = useState(null)
  const [sheet, setSheet] = useState(false) // the "hold to peek" role / covert sheet
  const [covertNote, setCovertNote] = useState(null)
  const [killReadyAt, setKillReadyAt] = useState(null)
  const [pick, setPick] = useState(null) // { key, id } vote selection
  const [notice, setNotice] = useState(null)
  const noticeTimer = useRef(null)
  const secret = useRef(null) // host only
  const claims = useRef({ round: null, roles: {} }) // host only, after migration
  const lastRoleReq = useRef(0)
  const alts = useRef({}) // host only: { [id]: { alt, at } }
  const myAltRef = useRef(null)
  const calibratedFor = useRef(null)
  const lastAltSent = useRef(0)
  const baro = useBaro(!!room)

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
  const holdMs = engine.holdMsOf(state?.killHoldMs)

  // ---- floors ----
  // Players: altitude vs the reference they took at the start spot this round. The
  // original host keeps its lobby reference (stations were placed against it) and
  // subtracts its own reading at the start spot (state.altBase).
  const roundTag = state ? `round-${state.round}-${state.startedAt}` : null
  const myAlt = !state || baro.status === 'none' || !engine.finiteAlt(baro.alt) ? null
    : baro.tag === roundTag ? baro.alt
      : baro.tag === SETUP_TAG && state.altBy === meId && engine.finiteAlt(state.altBase) ? baro.alt - state.altBase
        : null
  myAltRef.current = myAlt
  const withAlt = (a) => (engine.finiteAlt(myAlt) ? { ...a, alt: roundAlt(myAlt) } : a)

  useEffect(() => {
    if (!room || !state || state.phase !== 'countdown' || calibratedFor.current === roundTag) return
    if (baro.status !== 'ready' || state.startsAt - now > CALIBRATE_AT_MS) return
    if (isHost && !state.altBy) {
      if (refTag() !== SETUP_TAG) {
        const st = snap.info.settings || {}
        const placed = stations.some((x) => engine.finiteAlt(x.alt))
        if (!(placed && st.altRefBy === meId && restoreRef(st.altRefP, SETUP_TAG))) calibrate(SETUP_TAG)
      }
      const base = readAlt()
      if (!engine.finiteAlt(base)) return // try again on the next clock tick
      calibratedFor.current = roundTag
      const s = room.getState()
      // (Also right after the countdown, if the tick turned it into 'playing' meanwhile.)
      if (s && s.round === state.round && (s.phase === 'countdown' || s.phase === 'playing') && !s.altBy) room.publishState({ ...s, altBase: roundAlt(base), altBy: meId })
    } else {
      if (calibrate(roundTag) === false) return
      calibratedFor.current = roundTag
    }
  }, [room, state, now, baro.status, roundTag, isHost, meId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Everyone but the host tells the host their altitude every couple of seconds.
  useEffect(() => {
    if (!room || isHost || !state || !snap?.hostId || (state.phase !== 'playing' && state.phase !== 'meeting')) return
    const t = Date.now()
    if (t - lastAltSent.current < ALT_SEND_MS) return
    lastAltSent.current = t
    room.send('bt_alt', { round: state.round, alt: engine.finiteAlt(myAlt) ? roundAlt(myAlt) : null }, { to: snap.hostId })
  }, [room, isHost, state?.phase, state?.round, snap?.hostId, now]) // eslint-disable-line react-hooks/exhaustive-deps

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
      // Imposter-only feedback: shown inside the covert sheet, never as a banner.
      room.onMessage('covert', (d) => { buzz('warning'); setCovertNote({ text: String(d?.text || ''), at: Date.now() }) }),
      room.onMessage('kill_ok', (d) => {
        buzz('heavy')
        if (typeof d?.readyAt === 'number') setKillReadyAt(d.readyAt)
        setCovertNote(null)
        setSheet(false) // get the covert sheet off the screen right away
      }),
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
    setSheet(false)
    setCovertNote(null)
  }, [round])

  const phase = state?.phase
  const prevPhase = useRef(phase)
  useEffect(() => {
    if (phase === 'meeting' && prevPhase.current === 'playing') { buzz('warning'); setActiveTask(null); setSheet(false); setQrOpen(false) }
    prevPhase.current = phase
  }, [phase])
  useEffect(() => { setPick(null) }, [state?.meetingNo])
  const alive = me?.alive
  const prevAlive = useRef(alive)
  useEffect(() => {
    if (prevAlive.current === true && alive === false && !me?.ejected) {
      // Long buzz: the victim sits down where they are (see VictimCard).
      buzz('error')
      const t1 = setTimeout(() => buzz('heavy'), 250)
      const t2 = setTimeout(() => buzz('heavy'), 500)
      const t3 = setTimeout(() => buzz('error'), 800)
      setActiveTask(null)
      setSheet(false)
      setQrOpen(false)
      prevAlive.current = alive
      return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3) }
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
      room.onMessage('bt_alt', (d, from) => {
        const s = room.getState()
        if (!s || d?.round !== s.round) return
        alts.current[from] = { alt: engine.actionAlt(d), at: Date.now() }
      }),
    ]
    return () => offs.forEach((off) => off())
  }, [room, isHost]) // eslint-disable-line react-hooks/exhaustive-deps

  const altOf = (id) => {
    if (id === meId) return myAltRef.current
    const a = alts.current[id]
    return a && Date.now() - a.at < engine.ALT_STALE_MS ? a.alt : null
  }
  useHostLoop(room, isHost, {
    onTick: () => {
      const s = room.getState()
      const t = room.now()
      const roundNo = room.info.round || 0
      const presentIds = room.presentIds()
      if (roundNo > 0 && (!s || s.game !== 'beside' || s.round !== roundNo)) {
        const next = engine.initialState(room.roster, room.info, t)
        secret.current = engine.newSecret(next)
        alts.current = {}
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
      const next = engine.tick(s, secret.current, { now: t, presentIds, posOf: (id) => room.freshPosition(id), altOf })
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
        altOf,
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
        body={roleKnown
          ? (amImposter
            ? `Hold your role chip for secret moves. Eliminate by ${holdMs ? `holding on someone within arm’s reach for ${holdMs / 1000} s` : 'tapping someone within arm’s reach'}. Your tasks don’t count, so fake them well.`
            : 'Walk to your stations and crack the puzzles. Watch who’s beside you. Find the imposter.')
          : 'Getting your role…'}
        count={left}
        foot={baro.status === 'none' || baro.status === 'checking' ? 'Hide your screen' : 'Hide your screen · stand near the host'}
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
      <TermScreen tone={c}>
        {(reduce) => (
          <StScreen style={{ backgroundColor: 'transparent' }}>
            <TermHeader
              left={`Meeting ${pad2(state.meetingNo)}`}
              segments={[m.kind === 'body' ? 'Body reported' : 'Emergency protocol', discussing ? 'Channel open' : 'Ballot open']}
              color={c}
              reduce={reduce}
            />
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
        )}
      </TermScreen>
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
  const gpsStations = stations.filter(engine.hasPos)
  const qrStations = stations.filter((st) => engine.stationKind(st) === 'qr')
  const altBase = state.altBase
  // GPS / walk & place stations: in range (and on the same floor for walk & place).
  const isHere = (st) => !!st && engine.stationKind(st) !== 'qr' && engine.atStation(myPos, st, null, myAlt, altBase)
  const atAnyStation = gpsStations.some(isHere)
  const task = activeTask != null ? myTasks[activeTask] : null
  const doneCount = myTasks.filter((t) => t.done).length
  const hereIndex = myTasks.findIndex((t) => !t.done && isHere(stationById[t.stationId]))
  const floorsOn = engine.finiteAlt(altBase) && stations.some((st) => engine.stationKind(st) === 'place' && engine.finiteAlt(st.alt))
  const floorNote = !floorsOn ? null
    : baro.status === 'none' ? 'This phone has no barometer, so floors are ignored for you. Check each station’s floor label.'
      : baro.status === 'ready' && myAlt === null ? 'Floor check is off on this phone (it missed the start calibration).' : null
  const hereStation = hereIndex >= 0 ? stationById[myTasks[hereIndex].stationId] : null
  const hideDeaths = me.alive && !amImposter
  const shownAlive = (o) => o.alive || (hideDeaths && !o.ejected && state.bodies[o.id] && !state.bodies[o.id].reported)
  // No live distances (a free radar): just "nearby" / "far". Sorted by name, not distance.
  const list = [...others].sort((a, b) => (shownAlive(b) - shownAlive(a)) || a.name.localeCompare(b.name))

  // Victim: a calm full-screen card until the body is found (or a meeting is called).
  if (!me.alive && !me.ejected && state.bodies[meId] && !state.bodies[meId].reported) {
    return <VictimCard />
  }

  const openTask = (i, code) => { setScannedCode(code || null); setActiveTask(i) }
  const onQrScan = ({ id, code }) => {
    const st = stationById[id]
    if (!st || engine.stationKind(st) !== 'qr' || st.code !== code) { buzz('warning'); setQrError('That code isn’t from this game.'); return }
    if (sabotaged && me.alive) {
      buzz('medium'); room.sendAction(withAlt({ type: 'fix', code })); setQrOpen(false); return
    }
    const i = myTasks.findIndex((t) => !t.done && t.stationId === id)
    if (i < 0) {
      buzz('warning')
      setQrError(myTasks.some((t) => t.stationId === id) ? `${st.name}: you’ve done this one.` : `${st.name} isn’t one of your stations.`)
      return
    }
    buzz('medium')
    setQrOpen(false)
    setQrError(null)
    openTask(i, code)
  }
  const fixComms = () => {
    if (atAnyStation) { buzz('medium'); room.sendAction(withAlt({ type: 'fix' })) } else if (qrStations.length) { setQrError(null); setQrOpen(true) }
  }

  const covertTargets = amImposter && me.alive
    ? list.filter((o) => o.alive && present(o.id)).map((o) => ({ ...o, block: engine.killBlock(myPos, o.pos) }))
    : []

  const mainButton = qrStations.length && !hereStation
    ? { title: 'Scan a station code', icon: 'qr-code-outline', onPress: () => { setQrError(null); setQrOpen(true) }, disabled: state.phase !== 'playing' }
    : { title: hereStation ? `Start task · ${hereStation.name}` : 'Walk to a task station', icon: hereStation ? 'flash-outline' : 'navigate-outline', onPress: () => openTask(hereIndex), disabled: !hereStation || state.phase !== 'playing' }

  return (
    <StScreen keyboardShouldPersistTaps="handled">
      <View style={styles.topRow}>
        <Pressable
          onPress={() => flash('Hold the chip to peek at your role.')}
          onLongPress={() => { buzz('select'); setSheet(true) }}
          delayLongPress={450}
          accessibilityRole="button"
          accessibilityLabel="Your role. Hold to peek"
          accessibilityActions={[{ name: 'longpress', label: 'Peek at your role' }]}
          onAccessibilityAction={(e) => { if (e.nativeEvent.actionName === 'longpress') setSheet(true) }}
          style={({ pressed }) => [styles.roleChip, pressed && { backgroundColor: 'rgba(255,255,255,0.1)' }]}
        >
          <Text style={stType.label}>Your role</Text>
          <Text style={[stType.name, { fontSize: 18 }]}>{roleKnown ? 'HOLD TO PEEK' : '…'}</Text>
        </Pressable>
        <View style={{ flex: 1, alignItems: 'flex-end' }}>
          <StLabel>{sabotaged ? 'Crew tasks · comms down' : `Crew tasks · ${Math.round(state.progress * 100)}%`}</StLabel>
          <StBar value={sabotaged ? 0 : state.progress} color={ST.health} height={8} style={{ width: '100%', maxWidth: 160, marginTop: 4 }} />
        </View>
      </View>

      {sabotaged && (
        <StBanner solid color={ST.enemy} icon="radio-outline" text={`Comms down · ${formatClock(state.sabotage.until - now)}`} sub={qrStations.length ? 'Progress is hidden. Scan any station code to fix it.' : 'Progress is hidden. Fix it at any station.'}>
          {me.alive && (atAnyStation || qrStations.length) ? <StButton title={atAnyStation ? 'Fix comms' : 'Scan a code to fix'} tone="white" height={38} onPress={fixComms} style={{ marginTop: 8 }} /> : null}
        </StBanner>
      )}
      {!!notice && <StBanner text={notice} color={ST.objective} icon="information-circle-outline" />}
      {!me.alive && <StBanner icon="eye-outline" color={ST.muted} text="You’re a ghost. You can’t vote or call meetings, but your tasks still count." />}
      {floorNote ? <StBanner icon="layers-outline" color={ST.muted} text={floorNote} /> : null}
      {lm && now - lm.at < 25000 && (
        <StBanner
          icon={lm.ejected ? 'person-remove-outline' : 'remove-circle-outline'}
          color={lm.ejected ? (lm.wasImposter ? ST.health : ST.enemy) : ST.muted}
          text={lm.ejected ? `${nameOf(lm.ejected)} was ejected. They were ${lm.wasImposter ? '' : 'not '}the imposter.` : `No one was ejected (${lm.skip} skipped).`}
        />
      )}

      {gpsStations.length ? <StationMap area={area} stations={gpsStations} myPos={myPos} tasks={myTasks} /> : null}

      <StSection label={`Your tasks · ${doneCount} of ${myTasks.length}`} right={floorsOn && engine.finiteAlt(myAlt) ? `You: ${engine.floorLabel(myAlt)}` : null}>
        {myTasks.map((t, i) => {
          const st = stationById[t.stationId]
          if (!st) return null
          const kind = engine.stationKind(st)
          const isQr = kind === 'qr'
          const d = myPos && !isQr ? distanceMeters(myPos, st) : Infinity
          const here = isHere(st)
          const stAlt = kind === 'place' ? engine.stationAlt(st, altBase) : null
          const floorTxt = engine.finiteAlt(stAlt) ? engine.floorLabel(stAlt) : null
          const otherFloor = kind === 'place' && !here && engine.placeBlock(myPos, st, myAlt, altBase) === 'floor'
          const status = t.done ? 'Done'
            : isQr ? `Find code ${pad2(st.no || 0)} and scan it`
              : here ? (kind === 'photo' ? 'You’re here — scan it' : 'You’re here — start the task')
                : otherFloor ? `On ${floorTxt} — go ${stAlt > myAlt ? 'up' : 'down'}`
                  : myPos ? `${floorTxt ? `${floorTxt} · ` : ''}${compassLabel(bearingDeg(myPos, st))} · ${formatDistance(d)}` : (floorTxt || '—')
          return (
            <Pressable
              key={`${t.stationId}-${i}`}
              onPress={!t.done && state.phase === 'playing' ? (here ? () => openTask(i) : isQr ? () => { setQrError(null); setQrOpen(true) } : undefined) : undefined}
              style={[styles.taskRow, t.done && { opacity: 0.55 }, here && !t.done && { borderColor: ST.objective }]}
              accessibilityRole={!t.done && (here || isQr) ? 'button' : undefined}
              accessibilityLabel={`${st.name}, ${PUZZLES[t.puzzle]}, ${status}`}
            >
              <View style={[styles.taskMark, t.done ? { backgroundColor: ST.health, borderColor: ST.health } : { borderColor: ST.objective }]} />
              {kind === 'photo' || (kind === 'place' && (st.photo || st.url))
                ? <StationImage room={room} station={st} assets={snap.assets} style={styles.taskImg} />
                : <View style={[styles.taskImg, styles.toyBox]}>{st.toy ? <Toy kind={st.toy} size={30} /> : <Ionicons name={st.icon || 'flag-outline'} size={18} color={ST.objective} />}</View>}
              <View style={{ flex: 1, minWidth: 0, marginLeft: 10 }}>
                <Text style={[stType.name, { fontSize: 14, fontFamily: FONT.ui }]} numberOfLines={1}>{st.name} · {PUZZLES[t.puzzle]}</Text>
                <Text style={[stType.small, { fontSize: 11 }]} numberOfLines={1}>{status}</Text>
              </View>
              <Text style={[stType.label, { color: t.done ? ST.health : here ? ST.objective : ST.muted }]}>{t.done ? 'Done' : here ? 'Here' : isQr ? 'Scan' : otherFloor ? (stAlt > myAlt ? 'Up' : 'Down') : formatDistance(d)}</Text>
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
        title={mainButton.title}
        disabled={mainButton.disabled}
        onPress={mainButton.onPress}
        left={<Ionicons name={mainButton.icon} size={18} color={ST.ink} />}
        style={{ marginBottom: 10 }}
      />

      <StSection label="Players">
        {list.map((o) => {
          const showAlive = shownAlive(o)
          const near = o.pos && myPos && engine.within(myPos, o.pos, NEARBY_M)
          return (
            <StPlayerRow
              key={o.id}
              player={{ id: o.id, username: o.name, avatar: avatarOf(o.id) }}
              dim={!showAlive || !present(o.id)}
              subtitle={!present(o.id) ? 'Disconnected' : o.ejected ? 'Ejected' : !showAlive ? 'Eliminated' : sabotaged ? '—' : !o.pos ? 'No signal' : near ? 'Nearby' : 'Far'}
            />
          )
        })}
      </StSection>

      <StFeed items={state.feed} />

      <RoleSheet
        visible={sheet}
        onClose={() => setSheet(false)}
        roleKnown={roleKnown}
        imposter={amImposter}
        alive={me.alive}
        killWait={killWait}
        holdMs={holdMs}
        myPos={myPos}
        targets={covertTargets}
        sabotaged={sabotaged}
        note={covertNote && Date.now() - covertNote.at < 6000 ? covertNote.text : null}
        onSabotage={() => { buzz('medium'); room.sendAction({ type: 'sabotage' }) }}
        onKillStart={(id) => { setCovertNote(null); room.sendAction(withAlt({ type: 'kill_start', target: id })) }}
        onKillCancel={(id) => room.sendAction({ type: 'kill_cancel', target: id })}
        onKillDone={(id) => room.sendAction(withAlt({ type: 'kill_done', target: id }))}
        onKillNow={(id) => { setCovertNote(null); room.sendAction(withAlt({ type: 'kill', target: id })) }}
      />

      <QrScanSheet
        visible={qrOpen}
        onClose={() => { setQrOpen(false); setQrError(null) }}
        onScan={onQrScan}
        title={sabotaged ? 'Scan any code to fix comms' : 'Scan a station'}
        error={qrError}
      />

      <ScanTask
        visible={!!task && !task.done}
        room={room}
        station={task ? stationById[task.stationId] : null}
        stationNo={task ? (stationById[task.stationId]?.no || stations.findIndex((st) => st.id === task.stationId) + 1) : 0}
        assets={snap.assets}
        puzzle={task?.puzzle}
        scannedCode={scannedCode}
        onClose={() => { setActiveTask(null); setScannedCode(null) }}
        onDone={({ code } = {}) => {
          const i = activeTask
          setActiveTask(null)
          setScannedCode(null)
          room.sendAction(withAlt(code ? { type: 'task', index: i, code } : { type: 'task', index: i }))
        }}
      />
    </StScreen>
  )
}

// Calm full-screen card for the player who was just eliminated. The body is the player:
// they sit down where they are so "report body" works in real life.
function VictimCard() {
  return (
    <View style={styles.victim} accessibilityRole="alert" accessibilityLabel="You've been eliminated. Sit down where you are and wait.">
      <SafeAreaView style={styles.victimInner} edges={['top', 'bottom']}>
        <View style={styles.victimIcon}>
          <Ionicons name="moon-outline" size={46} color="#cfd8ff" />
        </View>
        <Text style={styles.victimKicker}>Beside Them</Text>
        <Text style={styles.victimTitle}>You’ve been eliminated</Text>
        <Text style={styles.victimBody}>Sit down right where you are and wait quietly.</Text>
        <Text style={styles.victimSub}>No hints, no pointing. When someone finds you, or a meeting is called, you’ll become a ghost and can keep doing tasks.</Text>
        <View style={styles.victimRule} />
        <Text style={styles.victimFoot}>Stay put · stay quiet</Text>
      </SafeAreaView>
    </View>
  )
}

// The "hold to peek" sheet: same frame for every role. Crew see their role and a tip;
// the imposter also gets the covert controls (cooldown, sabotage, hold-to-eliminate).
function RoleSheet({ visible, onClose, roleKnown, imposter, alive, killWait, holdMs, myPos, targets, sabotaged, note, onSabotage, onKillStart, onKillCancel, onKillDone, onKillNow }) {
  const color = roleKnown ? roleColor(imposter) : ST.muted
  const weak = engine.weakFix(myPos)
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.sheetScrim} onPress={onClose} accessibilityLabel="Hide role" />
      <View style={styles.sheet}>
        <SafeAreaView edges={['bottom']}>
          <View style={[styles.sheetRole, { borderLeftColor: color }]}>
            <Text style={stType.label}>Your role · keep it hidden</Text>
            <Text style={[stType.display, { color, fontSize: 30, lineHeight: 34 }]}>{roleKnown ? (imposter ? 'IMPOSTER' : 'CREW') : '…'}</Text>
          </View>
          {imposter && alive ? (
            <ScrollView style={{ maxHeight: 360 }} contentContainerStyle={{ paddingBottom: 6 }}>
              <View style={{ flexDirection: 'row', gap: 8, marginBottom: 10 }}>
                <View style={styles.covertChip}>
                  <Text style={stType.label}>Eliminate</Text>
                  <Text style={[stType.num, { fontSize: 18, color: killWait > 0 ? ST.muted : ST.enemy }]}>{killWait > 0 ? `${Math.ceil(killWait / 1000)} s` : weak ? 'WEAK GPS' : 'READY'}</Text>
                </View>
                <StButton title="Sabotage comms" tone="outline" color={ST.enemy} disabled={sabotaged} height={48} style={{ flex: 1 }} onPress={onSabotage} />
              </View>
              {note ? <Text style={[stType.small, styles.covertNote]}>{note}</Text> : null}
              {weak && killWait === 0 ? <Text style={[stType.small, styles.covertNote]}>Signal too weak to eliminate (±{Math.round(myPos.acc)} m). Move somewhere with open sky.</Text> : null}
              <Text style={[stType.label, { marginBottom: 6 }]}>{holdMs ? `Hold on someone within arm’s reach · ${holdMs / 1000} s` : 'Tap someone within arm’s reach'}</Text>
              {targets.length ? targets.map((o) => (
                <HoldTarget
                  key={o.id}
                  name={o.name}
                  status={o.block === null ? 'In reach' : o.block === 'weak' ? 'Weak signal' : o.block === 'noloc' ? 'No signal' : 'Too far'}
                  disabled={killWait > 0 || o.block !== null}
                  holdMs={holdMs}
                  onNow={() => onKillNow(o.id)}
                  onStart={() => onKillStart(o.id)}
                  onCancel={() => onKillCancel(o.id)}
                  onDone={() => onKillDone(o.id)}
                />
              )) : <Text style={stType.small}>No one around.</Text>}
            </ScrollView>
          ) : (
            <Text style={[stType.small, { marginBottom: 12 }]}>
              {!roleKnown ? 'Getting your role…' : imposter ? 'You’re out. Watch quietly.' : 'Do your tasks and notice who’s beside you. Report bodies, and call a meeting if something feels off.'}
            </Text>
          )}
          <StButton title="Hide" tone="ghost" onPress={onClose} style={{ marginTop: 8 }} />
        </SafeAreaView>
      </View>
    </Modal>
  )
}

// Press and hold: the ring fills over holdMs; releasing early cancels. holdMs 0 (instant):
// a single tap sends 'kill' (the host still checks range, signal and floor).
function HoldTarget({ name, status, disabled, holdMs, onNow, onStart, onCancel, onDone }) {
  const v = useRef(new Animated.Value(0)).current
  const anim = useRef(null)
  const holding = useRef(false)
  const [state, setState] = useState('idle') // idle | holding
  const stop = (cancelled) => {
    anim.current?.stop()
    anim.current = null
    v.setValue(0)
    if (holding.current && cancelled) onCancel()
    holding.current = false
    setState('idle')
  }
  useEffect(() => () => anim.current?.stop(), [])
  useEffect(() => { if (disabled && holding.current) stop(true) }, [disabled]) // eslint-disable-line react-hooks/exhaustive-deps
  const start = () => {
    if (disabled) return
    if (!holdMs) { buzz('heavy'); onNow(); return }
    holding.current = true
    setState('holding')
    buzz('select')
    onStart()
    anim.current = Animated.timing(v, { toValue: 1, duration: holdMs, easing: Easing.linear, useNativeDriver: true })
    anim.current.start(({ finished }) => {
      if (!finished || !holding.current) return
      holding.current = false
      anim.current = null
      buzz('heavy')
      onDone()
      v.setValue(0)
      setState('idle')
    })
  }
  return (
    <Pressable
      onPressIn={holdMs ? start : undefined}
      onPress={holdMs ? undefined : start}
      onPressOut={() => { if (holding.current) stop(true) }}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={holdMs ? `Hold to eliminate ${name}` : `Eliminate ${name}`}
      accessibilityState={{ disabled }}
      style={[styles.holdRow, disabled && { opacity: 0.45 }]}
    >
      <View style={styles.holdRing}>
        <Animated.View style={[styles.holdFill, { transform: [{ scale: v }] }]} />
        <Ionicons name="finger-print-outline" size={20} color={ST.text} />
      </View>
      <View style={{ flex: 1, marginLeft: 10 }}>
        <Text style={[stType.name, { fontSize: 15 }]} numberOfLines={1}>{name}</Text>
        <Text style={[stType.small, { fontSize: 11 }]}>{state === 'holding' ? 'Holding… stay close' : holdMs || disabled ? status : `${status} · tap`}</Text>
      </View>
    </Pressable>
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
  toyBox: { borderRadius: ST.radius, backgroundColor: 'rgba(124,231,255,0.1)', alignItems: 'center', justifyContent: 'center' },
  victim: { flex: 1, backgroundColor: '#1b2350' },
  victimInner: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28 },
  victimIcon: { width: 96, height: 96, borderRadius: 48, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(207,216,255,0.12)', marginBottom: 22 },
  victimKicker: { ...stType.label, color: 'rgba(207,216,255,0.7)', marginBottom: 6 },
  victimTitle: { ...stType.title, color: '#ffffff', fontSize: 30, lineHeight: 36, textAlign: 'center' },
  victimBody: { fontFamily: FONT.uiSemi, fontSize: 20, lineHeight: 26, color: '#e6ebff', textAlign: 'center', marginTop: 14 },
  victimSub: { ...stType.small, color: 'rgba(230,235,255,0.75)', textAlign: 'center', marginTop: 10, maxWidth: 320 },
  victimRule: { width: 60, height: 2, backgroundColor: 'rgba(207,216,255,0.35)', marginVertical: 24 },
  victimFoot: { ...stType.label, color: 'rgba(207,216,255,0.8)' },
  sheetScrim: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.55)' },
  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: 16, paddingBottom: 8, backgroundColor: ST.ground2, borderTopWidth: 1, borderTopColor: ST.lineStrong },
  sheetRole: { borderLeftWidth: 3, paddingLeft: 10, marginBottom: 12 },
  covertChip: { width: 110, paddingHorizontal: 10, justifyContent: 'center', borderWidth: 1, borderColor: ST.line, borderRadius: ST.radius },
  covertNote: { color: ST.objective, marginBottom: 8 },
  holdRow: { flexDirection: 'row', alignItems: 'center', padding: 8, marginBottom: 6, borderRadius: ST.radius, backgroundColor: ST.cell, borderWidth: 1, borderColor: ST.line },
  holdRing: { width: 46, height: 46, borderRadius: 23, borderWidth: 2, borderColor: withAlpha(ST.enemy, 0.7), alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  holdFill: { ...StyleSheet.absoluteFill, borderRadius: 23, backgroundColor: withAlpha(ST.enemy, 0.55) },
})
