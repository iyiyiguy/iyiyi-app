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
import { useT } from '../i18n'
import B from '../i18n/strings/besideThem'
import { floorName, localizeBesideText, stationName } from './beside/text'

const roleColor = (imposter) => (imposter ? ST.enemy : ST.friendly)
const NEARBY_M = 10
const CALIBRATE_AT_MS = 1500 // countdown time left when phones take their floor reference
const ALT_SEND_MS = 2000
const roundAlt = (a) => Math.round(a * 10) / 10

export function BesideThemGame({ room, onExit }) {
  useStudioFonts()
  const t = useT(B)
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
    const tNow = Date.now()
    if (tNow - lastAltSent.current < ALT_SEND_MS) return
    lastAltSent.current = tNow
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
      room.onMessage('notice', (d) => { buzz('warning'); flash(localizeBesideText(String(d?.text || ''))) }),
      // Imposter-only feedback: shown inside the covert sheet, never as a banner.
      room.onMessage('covert', (d) => { buzz('warning'); setCovertNote({ text: localizeBesideText(String(d?.text || '')), at: Date.now() }) }),
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
    const tNow = Date.now()
    if (tNow - lastRoleReq.current > 3000) {
      lastRoleReq.current = tNow
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
          const tNow = room.now()
          secret.current = { round: s.round, imposterId: from, lastKillAt: tNow, sabotageReadyAt: tNow + 30000, voteLog: [] }
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
  if (loc.status !== 'granted') return <StLocationGate status={loc.status} onExit={onExit} what={t('name')} />
  if (!state) return <StSpectating title={t('starting')} text={t('choosing_imposter')} />
  if (!me) return <StSpectating />

  const avatarOf = (id) => snap.roster.find((r) => r.id === id)?.avatar
  const nameOf = (id) => state.players[id]?.name || '?'
  const playerOf = (id) => ({ id, username: id === meId ? t('name_you', { name: nameOf(id) }) : nameOf(id), avatar: avatarOf(id) })
  const present = (id) => snap.roster.some((r) => r.id === id)

  if (state.phase === 'countdown') {
    const left = Math.max(0, Math.ceil((state.startsAt - now) / 1000))
    return (
      <StReveal
        kicker={t('secret_role_kicker')}
        title={roleKnown ? (amImposter ? t('imposter') : t('crew')) : t('dealing')}
        color={roleKnown ? roleColor(amImposter) : ST.muted}
        icon={roleKnown ? (amImposter ? 'skull-outline' : 'construct-outline') : 'help-circle-outline'}
        body={roleKnown
          ? (amImposter
            ? (holdMs ? t('reveal_imposter_hold', { s: holdMs / 1000 }) : t('reveal_imposter_tap'))
            : t('reveal_crew'))
          : t('getting_role')}
        count={left}
        foot={baro.status === 'none' || baro.status === 'checking' ? t('hide_screen') : t('hide_screen_host')}
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
              left={t('meeting_n', { n: pad2(state.meetingNo) })}
              segments={[m.kind === 'body' ? t('body_reported') : t('emergency_protocol'), discussing ? t('channel_open') : t('ballot_open')]}
              color={c}
              reduce={reduce}
            />
            <StHero
              kicker={`${m.kind === 'body' ? t('body_reported') : t('emergency_meeting')} · ${discussing ? t('discussion') : t('voting')}`}
              color={c}
              title={m.kind === 'body' ? t('was_found', { name: nameOf(m.body) }) : t('who_is_it')}
              sub={m.kind === 'body' ? t('reported_the_body', { name: nameOf(m.calledBy) }) : t('called_by', { name: nameOf(m.calledBy) })}
            />
            <View style={styles.ringRow}>
              <StRing size={78} color={c} progress={left / Math.max(1, total)} value={formatClock(left)} unit={discussing ? t('unit_talk') : t('unit_vote')} />
            </View>
            <Text style={[stType.small, { textAlign: 'center', marginBottom: 10 }]}>
              {discussing ? t('talk_it_over') : t('vote_rules')}
            </Text>
            <StSection label={t('alive_n', { n: aliveIds.length })} right={discussing ? null : t('n_voted', { n: votedCount })}>
              <StGrid cols={3}>
                {aliveIds.map((id) => (
                  <StPlayerTile
                    key={id}
                    player={playerOf(id)}
                    tag={m.votes[id] !== undefined ? t('tag_voted') : id === m.calledBy ? (m.kind === 'body' ? t('tag_reported') : t('tag_called')) : discussing ? t('tag_alive') : t('tag_deciding')}
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
                <StButton title={sel ? t('eject_name', { name: nameOf(sel) }) : t('pick_suspect')} tone="danger" disabled={!sel} style={{ flex: 1 }} onPress={() => vote(sel)} />
                <StButton title={t('skip')} tone="ghost" style={{ width: 100 }} onPress={() => vote('skip')} />
              </View>
            ) : me.alive && !discussing ? (
              <StBanner icon="checkmark" color={ST.enemy} text={myVote === 'skip' ? t('you_skipped') : t('you_voted_for', { name: nameOf(myVote) })} />
            ) : !me.alive ? (
              <StBanner icon="eye-outline" color={ST.muted} text={t('ghosts_cant_vote')} />
            ) : null}
            {deadIds.length ? (
              <StSection label={t('out')}>
                {deadIds.map((id) => <StPlayerRow key={id} player={playerOf(id)} dim subtitle={state.players[id].ejected ? t('ejected') : t('eliminated')} />)}
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
  const doneCount = myTasks.filter((x) => x.done).length
  const hereIndex = myTasks.findIndex((x) => !x.done && isHere(stationById[x.stationId]))
  const floorsOn = engine.finiteAlt(altBase) && stations.some((st) => engine.stationKind(st) === 'place' && engine.finiteAlt(st.alt))
  const floorNote = !floorsOn ? null
    : baro.status === 'none' ? t('no_barometer') : baro.status === 'ready' && myAlt === null ? t('floor_check_off') : null
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
    if (!st || engine.stationKind(st) !== 'qr' || st.code !== code) { buzz('warning'); setQrError(t('code_not_this_game')); return }
    if (sabotaged && me.alive) {
      buzz('medium'); room.sendAction(withAlt({ type: 'fix', code })); setQrOpen(false); return
    }
    const i = myTasks.findIndex((x) => !x.done && x.stationId === id)
    if (i < 0) {
      buzz('warning')
      setQrError(myTasks.some((x) => x.stationId === id) ? t('done_this_one', { name: stationName(st) }) : t('not_your_station', { name: stationName(st) }))
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
    ? { title: t('scan_station_code'), icon: 'qr-code-outline', onPress: () => { setQrError(null); setQrOpen(true) }, disabled: state.phase !== 'playing' }
    : { title: hereStation ? t('start_task_at', { name: stationName(hereStation) }) : t('walk_to_station'), icon: hereStation ? 'flash-outline' : 'navigate-outline', onPress: () => openTask(hereIndex), disabled: !hereStation || state.phase !== 'playing' }

  return (
    <StScreen keyboardShouldPersistTaps="handled">
      <View style={styles.topRow}>
        <Pressable
          onPress={() => flash(t('hold_chip'))}
          onLongPress={() => { buzz('select'); setSheet(true) }}
          delayLongPress={450}
          accessibilityRole="button"
          accessibilityLabel={t('role_a11y')}
          accessibilityActions={[{ name: 'longpress', label: t('peek_role') }]}
          onAccessibilityAction={(e) => { if (e.nativeEvent.actionName === 'longpress') setSheet(true) }}
          style={({ pressed }) => [styles.roleChip, pressed && { backgroundColor: 'rgba(255,255,255,0.1)' }]}
        >
          <Text style={stType.label}>{t('your_role')}</Text>
          <Text style={[stType.name, { fontSize: 18 }]}>{roleKnown ? t('hold_to_peek') : '…'}</Text>
        </Pressable>
        <View style={{ flex: 1, alignItems: 'flex-end' }}>
          <StLabel>{sabotaged ? t('crew_tasks_down') : t('crew_tasks_pct', { n: Math.round(state.progress * 100) })}</StLabel>
          <StBar value={sabotaged ? 0 : state.progress} color={ST.health} height={8} style={{ width: '100%', maxWidth: 160, marginTop: 4 }} />
        </View>
      </View>

      {sabotaged && (
        <StBanner solid color={ST.enemy} icon="radio-outline" text={t('comms_down_time', { time: formatClock(state.sabotage.until - now) })} sub={qrStations.length ? t('progress_hidden_qr') : t('progress_hidden')}>
          {me.alive && (atAnyStation || qrStations.length) ? <StButton title={atAnyStation ? t('fix_comms') : t('scan_to_fix')} tone="white" height={38} onPress={fixComms} style={{ marginTop: 8 }} /> : null}
        </StBanner>
      )}
      {!!notice && <StBanner text={notice} color={ST.objective} icon="information-circle-outline" />}
      {!me.alive && <StBanner icon="eye-outline" color={ST.muted} text={t('ghost_note')} />}
      {floorNote ? <StBanner icon="layers-outline" color={ST.muted} text={floorNote} /> : null}
      {lm && now - lm.at < 25000 && (
        <StBanner
          icon={lm.ejected ? 'person-remove-outline' : 'remove-circle-outline'}
          color={lm.ejected ? (lm.wasImposter ? ST.health : ST.enemy) : ST.muted}
          text={lm.ejected ? t(lm.wasImposter ? 'ejected_was_imp' : 'ejected_not_imp', { name: nameOf(lm.ejected) }) : t('no_one_ejected', { n: lm.skip })}
        />
      )}

      {gpsStations.length ? <StationMap area={area} stations={gpsStations} myPos={myPos} tasks={myTasks} /> : null}

      <StSection label={t('your_tasks_n', { n: doneCount, total: myTasks.length })} right={floorsOn && engine.finiteAlt(myAlt) ? t('you_floor', { floor: floorName(engine.floorIndex(myAlt)) }) : null}>
        {myTasks.map((task_, i) => {
          const st = stationById[task_.stationId]
          if (!st) return null
          const kind = engine.stationKind(st)
          const isQr = kind === 'qr'
          const d = myPos && !isQr ? distanceMeters(myPos, st) : Infinity
          const here = isHere(st)
          const stAlt = kind === 'place' ? engine.stationAlt(st, altBase) : null
          const floorTxt = engine.finiteAlt(stAlt) ? floorName(engine.floorIndex(stAlt)) : null
          const otherFloor = kind === 'place' && !here && engine.placeBlock(myPos, st, myAlt, altBase) === 'floor'
          const status = task_.done ? t('done')
            : isQr ? t('find_code_scan', { n: pad2(st.no || 0) })
              : here ? (kind === 'photo' ? t('here_scan') : t('here_start'))
                : otherFloor ? t(stAlt > myAlt ? 'on_floor_up' : 'on_floor_down', { floor: floorTxt })
                  : myPos ? `${floorTxt ? `${floorTxt} · ` : ''}${compassLabel(bearingDeg(myPos, st))} · ${formatDistance(d)}` : (floorTxt || '—')
          return (
            <Pressable
              key={`${task_.stationId}-${i}`}
              onPress={!task_.done && state.phase === 'playing' ? (here ? () => openTask(i) : isQr ? () => { setQrError(null); setQrOpen(true) } : undefined) : undefined}
              style={[styles.taskRow, task_.done && { opacity: 0.55 }, here && !task_.done && { borderColor: ST.objective }]}
              accessibilityRole={!task_.done && (here || isQr) ? 'button' : undefined}
              accessibilityLabel={`${stationName(st)}, ${PUZZLES[task_.puzzle]}, ${status}`}
            >
              <View style={[styles.taskMark, task_.done ? { backgroundColor: ST.health, borderColor: ST.health } : { borderColor: ST.objective }]} />
              {kind === 'photo' || (kind === 'place' && (st.photo || st.url))
                ? <StationImage room={room} station={st} assets={snap.assets} style={styles.taskImg} />
                : <View style={[styles.taskImg, styles.toyBox]}>{st.toy ? <Toy kind={st.toy} size={30} /> : <Ionicons name={st.icon || 'flag-outline'} size={18} color={ST.objective} />}</View>}
              <View style={{ flex: 1, minWidth: 0, marginLeft: 10 }}>
                <Text style={[stType.name, { fontSize: 14, fontFamily: FONT.ui }]} numberOfLines={1}>{stationName(st)} · {PUZZLES[task_.puzzle]}</Text>
                <Text style={[stType.small, { fontSize: 11 }]} numberOfLines={1}>{status}</Text>
              </View>
              <Text style={[stType.label, { color: task_.done ? ST.health : here ? ST.objective : ST.muted }]}>{task_.done ? t('done') : here ? t('here') : isQr ? t('scan') : otherFloor ? (stAlt > myAlt ? t('up') : t('down')) : formatDistance(d)}</Text>
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
            accessibilityLabel={nearBody ? t('report_body_a11y', { name: nameOf(nearBody[0]) }) : t('report_none_a11y')}
            style={({ pressed }) => [styles.bigBtn, { backgroundColor: ST.enemy, borderColor: ST.enemy, opacity: nearBody ? (pressed ? 0.85 : 1) : 0.35 }, nearBody && stGlow(ST.enemy, 14)]}
          >
            <Text style={[stType.button, { color: '#fff' }]}>{t('report_body')}</Text>
            <Text style={[styles.bigSub, { color: '#fff' }]} numberOfLines={1}>{nearBody ? t('is_here', { name: nameOf(nearBody[0]) }) : t('within_dist', { d: formatDistance(engine.REPORT_RANGE_M) })}</Text>
          </Pressable>
          <Pressable
            onPress={() => { buzz('heavy'); room.sendAction({ type: 'meeting' }) }}
            disabled={me.emergencies <= 0 || meetingWait > 0 || sabotaged}
            accessibilityRole="button"
            accessibilityState={{ disabled: me.emergencies <= 0 || meetingWait > 0 || sabotaged }}
            accessibilityLabel={t('call_meeting_a11y')}
            style={({ pressed }) => [styles.bigBtn, { borderColor: ST.objective, opacity: me.emergencies <= 0 || meetingWait > 0 || sabotaged ? 0.4 : pressed ? 0.8 : 1 }]}
          >
            <Text style={[stType.button, { color: ST.objective }]}>{t('emergency')}</Text>
            <Text style={styles.bigSub} numberOfLines={1}>
              {me.emergencies <= 0 ? t('used') : sabotaged ? t('fix_comms_first') : meetingWait > 0 ? t('ready_in_s', { n: Math.ceil(meetingWait / 1000) }) : t('n_left', { n: me.emergencies })}
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

      <StSection label={t('players')}>
        {list.map((o) => {
          const showAlive = shownAlive(o)
          const near = o.pos && myPos && engine.within(myPos, o.pos, NEARBY_M)
          return (
            <StPlayerRow
              key={o.id}
              player={{ id: o.id, username: o.name, avatar: avatarOf(o.id) }}
              dim={!showAlive || !present(o.id)}
              subtitle={!present(o.id) ? t('disconnected') : o.ejected ? t('ejected') : !showAlive ? t('eliminated') : sabotaged ? '—' : !o.pos ? t('no_signal') : near ? t('nearby') : t('far')}
            />
          )
        })}
      </StSection>

      <StFeed items={state.feed} localize={localizeBesideText} />

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
        title={sabotaged ? t('scan_any_fix') : t('scan_a_station')}
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
  const t = useT(B)
  return (
    <View style={styles.victim} accessibilityRole="alert" accessibilityLabel={t('victim_a11y')}>
      <SafeAreaView style={styles.victimInner} edges={['top', 'bottom']}>
        <View style={styles.victimIcon}>
          <Ionicons name="moon-outline" size={46} color="#cfd8ff" />
        </View>
        <Text style={styles.victimKicker}>{t('name')}</Text>
        <Text style={styles.victimTitle}>{t('victim_title')}</Text>
        <Text style={styles.victimBody}>{t('victim_body')}</Text>
        <Text style={styles.victimSub}>{t('victim_sub')}</Text>
        <View style={styles.victimRule} />
        <Text style={styles.victimFoot}>{t('victim_foot')}</Text>
      </SafeAreaView>
    </View>
  )
}

// The "hold to peek" sheet: same frame for every role. Crew see their role and a tip;
// the imposter also gets the covert controls (cooldown, sabotage, hold-to-eliminate).
function RoleSheet({ visible, onClose, roleKnown, imposter, alive, killWait, holdMs, myPos, targets, sabotaged, note, onSabotage, onKillStart, onKillCancel, onKillDone, onKillNow }) {
  const t = useT(B)
  const color = roleKnown ? roleColor(imposter) : ST.muted
  const weak = engine.weakFix(myPos)
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.sheetScrim} onPress={onClose} accessibilityLabel={t('hide_role')} />
      <View style={styles.sheet}>
        <SafeAreaView edges={['bottom']}>
          <View style={[styles.sheetRole, { borderLeftColor: color }]}>
            <Text style={stType.label}>{t('role_keep_hidden')}</Text>
            <Text style={[stType.display, { color, fontSize: 30, lineHeight: 34 }]}>{roleKnown ? (imposter ? t('imposter_caps') : t('crew_caps')) : '…'}</Text>
          </View>
          {imposter && alive ? (
            <ScrollView style={{ maxHeight: 360 }} contentContainerStyle={{ paddingBottom: 6 }}>
              <View style={{ flexDirection: 'row', gap: 8, marginBottom: 10 }}>
                <View style={styles.covertChip}>
                  <Text style={stType.label}>{t('eliminate')}</Text>
                  <Text style={[stType.num, { fontSize: 18, color: killWait > 0 ? ST.muted : ST.enemy }]}>{killWait > 0 ? t('n_s', { n: Math.ceil(killWait / 1000) }) : weak ? t('weak_gps') : t('ready')}</Text>
                </View>
                <StButton title={t('sabotage_comms')} tone="outline" color={ST.enemy} disabled={sabotaged} height={48} style={{ flex: 1 }} onPress={onSabotage} />
              </View>
              {note ? <Text style={[stType.small, styles.covertNote]}>{note}</Text> : null}
              {weak && killWait === 0 ? <Text style={[stType.small, styles.covertNote]}>{t('signal_too_weak', { n: Math.round(myPos.acc) })}</Text> : null}
              <Text style={[stType.label, { marginBottom: 6 }]}>{holdMs ? t('hold_someone', { s: holdMs / 1000 }) : t('tap_someone')}</Text>
              {targets.length ? targets.map((o) => (
                <HoldTarget
                  key={o.id}
                  name={o.name}
                  status={o.block === null ? t('in_reach') : o.block === 'weak' ? t('weak_signal') : o.block === 'noloc' ? t('no_signal') : t('too_far')}
                  disabled={killWait > 0 || o.block !== null}
                  holdMs={holdMs}
                  onNow={() => onKillNow(o.id)}
                  onStart={() => onKillStart(o.id)}
                  onCancel={() => onKillCancel(o.id)}
                  onDone={() => onKillDone(o.id)}
                />
              )) : <Text style={stType.small}>{t('no_one_around')}</Text>}
            </ScrollView>
          ) : (
            <Text style={[stType.small, { marginBottom: 12 }]}>
              {!roleKnown ? t('getting_role') : imposter ? t('youre_out') : t('crew_tip')}
            </Text>
          )}
          <StButton title={t('hide')} tone="ghost" onPress={onClose} style={{ marginTop: 8 }} />
        </SafeAreaView>
      </View>
    </Modal>
  )
}

// Press and hold: the ring fills over holdMs; releasing early cancels. holdMs 0 (instant):
// a single tap sends 'kill' (the host still checks range, signal and floor).
function HoldTarget({ name, status, disabled, holdMs, onNow, onStart, onCancel, onDone }) {
  const t = useT(B)
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
      accessibilityLabel={holdMs ? t('hold_eliminate_a11y', { name }) : t('eliminate_a11y', { name })}
      accessibilityState={{ disabled }}
      style={[styles.holdRow, disabled && { opacity: 0.45 }]}
    >
      <View style={styles.holdRing}>
        <Animated.View style={[styles.holdFill, { transform: [{ scale: v }] }]} />
        <Ionicons name="finger-print-outline" size={20} color={ST.text} />
      </View>
      <View style={{ flex: 1, marginLeft: 10 }}>
        <Text style={[stType.name, { fontSize: 15 }]} numberOfLines={1}>{name}</Text>
        <Text style={[stType.small, { fontSize: 11 }]}>{state === 'holding' ? t('holding_close') : holdMs || disabled ? status : t('status_tap', { status })}</Text>
      </View>
    </Pressable>
  )
}

// North-up map of the play area: my task stations (objective, done = green), other
// stations (outline) and me (friendly triangle). Other players are never drawn.
function StationMap({ area, stations, myPos, tasks }) {
  const t = useT(B)
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
  for (const x of tasks) mine[x.stationId] = mine[x.stationId] || (x.done ? 'done' : 'todo')
  for (const x of tasks) if (!x.done) mine[x.stationId] = 'todo'
  const me = myPos ? place(myPos) : null
  const ar = area ? area.r * scale : 0
  return (
    <View style={[styles.map, { width: w, height: h }]} accessibilityLabel={t('map_a11y')}>
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
            <Text style={[styles.stationLabel, right ? { marginRight: 4 } : { marginLeft: 4 }, !kind && { color: ST.muted }]} numberOfLines={1}>{stationName(st).toUpperCase()}</Text>
          </View>
        )
      })}
      {me ? <View pointerEvents="none" style={[styles.meArrow, { left: Math.max(0, Math.min(w - 14, me.left - 7)), top: Math.max(0, Math.min(h - 18, me.top - 9)) }]} /> : null}
    </View>
  )
}

const REASONS = {
  'imposter-left': 'reason_imposter_left',
  ejected: 'reason_ejected',
  tasks: 'reason_tasks',
  outnumbered: 'reason_outnumbered',
}

function Summary({ state, meId, playerOf, avatarOf, isHost, room, snap, onExit }) {
  const t = useT(B)
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
        kicker={`${t('name')} · ${REASONS[state.reason] ? t(REASONS[state.reason]) : t('round_over')}`}
        title={iWon ? t('victory') : t('defeat')}
        sub={state.winner === 'crew' ? t('crew_wins') : t('imposter_wins')}
        color={iWon ? winColor : ST.enemy}
        big
      />
      <StStats items={[
        { label: t('stat_crew_tasks'), value: `${Math.round((state.progress || 0) * 100)}%`, color: ST.health },
        { label: t('stat_meetings'), value: String(state.meetingNo || 0) },
        { label: t('stat_your_tasks'), value: String(mine?.tasksDone || 0) },
        { label: t('stat_good_votes'), value: String(correct[meId] || 0) },
      ]} />
      <StSection label={t('imposter_was')} accent={ST.enemy}>
        {imp
          ? <StPlayerRow player={playerOf(state.imposterId)} color={ST.enemy} subtitle={imp.ejected ? t('ejected') : imp.alive ? t('survived') : t('out')} right={<StTag text={t('imposter')} color={ST.enemy} solid />} />
          : <Text style={stType.small}>{t('player_left')}</Text>}
      </StSection>
      {mvp ? (
        <StMvp
          player={{ id: state.mvp, username: mvp.name, avatar: avatarOf(state.mvp) }}
          line={state.mvp === state.imposterId ? t('imposter') : t('tasks_votes', { n: mvp.tasksDone, v: correct[state.mvp] || 0 })}
        />
      ) : null}
      <StSection label={t('played_with')}>
        {ids.map((id) => {
          const p = state.players[id]
          const isImp = id === state.imposterId
          return (
            <StPlayerRow
              key={id}
              player={playerOf(id)}
              color={roleColor(isImp)}
              subtitle={`${p.ejected ? t('ejected') : p.alive ? t('survived') : t('eliminated')} · ${t('tasks_votes', { n: p.tasksDone, v: correct[id] || 0 })}`}
              right={<StTag text={isImp ? t('imposter') : t('crew')} color={roleColor(isImp)} />}
            />
          )
        })}
      </StSection>
      <StFeed items={state.feed} localize={localizeBesideText} />
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
