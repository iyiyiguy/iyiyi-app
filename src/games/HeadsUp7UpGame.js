// Heads Up 7 Up — classic classroom game adapted for mobile (4–30 players; 2 pickers at 4, up to 7 from 14).
//
// 7 players are "pickers". Everyone else puts their head down (phone face-down).
// Each picker secretly taps one person. Tapped players then try to guess who
// tapped them. Correct guesses swap places with the picker.
// Host-authoritative via the existing Room system.
//
// Rules:
// - 7 pickers, or fewer with a small group (never more than half the room), so there
//   are always enough heads-down players. Each sitter can be tapped only once.
// - Who tapped whom stays host-only until the reveal: during guessing the shared state
//   only says *that* a sitter was tapped (tappedBy: true).
// - Scoring: a sitter who names their picker scores 1 and swaps in as a picker next
//   round; a picker who isn't caught scores 1 and stays a picker.
// - Host migration: pickers know their own tap, so a new host asks them ("hu_whois")
//   and carries on.
import React, { useEffect, useRef, useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import {
  recordRoundResult,
  useHostLoop, useRoomClock, useRoomSnapshot,
} from '../lib/multiplayer'
import { buzz } from '../lib/gamePrefs'
import { ST, StButton, stType, useStudioFonts } from './studio'
import {
  StBanner, StFeed, StGrid, StHero, StPlayerRow, StPlayerTile, StResultsFooter, StReveal, StRing, StScreen,
  StLabel, StSection, StSpectating, StStats, StTag,
} from './beside/studioKit'

// ─── Timing ───────────────────────────────────────────────────────────────────
const COUNTDOWN_MS = 5000
const PICK_MS = 30000
const GUESS_MS = 20000
const RECOVER_MS = 6000
const MAX_PICKERS = 7

function shuffled(arr) {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]] }
  return a
}

// ─── Engine (pure; `sec` = host-only { round, picks: { pickerId: sitterId } }) ─
export const pickerCountFor = (n) => Math.max(n >= 2 ? 1 : 0, Math.min(MAX_PICKERS, Math.floor(n / 2)))

function initialState(roster, info, now, shuffle = shuffled) {
  const ids = roster.map((p) => p.id)
  const n = ids.length
  const pickerCount = pickerCountFor(n)
  // Last round's pickers (with correct guessers swapped in) stay on; fill the rest at random.
  const carried = (Array.isArray(info._pickers) ? info._pickers : []).filter((id) => ids.includes(id)).slice(0, pickerCount)
  const fill = shuffle(ids.filter((id) => !carried.includes(id))).slice(0, pickerCount - carried.length)
  const pickers = new Set([...carried, ...fill])

  const players = {}
  for (const p of roster) {
    players[p.id] = {
      name: p.username,
      isPicker: pickers.has(p.id),
      tappedBy: null,    // sitter: true once tapped (the picker's id only at the reveal)
      pickedTarget: null, // picker: true once picked (the sitter's id only at the reveal)
      guess: null,        // sitter's guess of who tapped them
      correct: false,     // did the guess match?
      score: 0,           // points this round
    }
  }
  const scores = { ...(info._scores || {}) }
  for (const id of ids) if (typeof scores[id] !== 'number') scores[id] = 0

  return {
    game: 'heads-up',
    round: info.round,
    roundNumber: (info.round || 1),
    phase: 'countdown',
    startsAt: now + COUNTDOWN_MS,
    pickerCount,
    players,
    pickUntil: 0,
    guessUntil: 0,
    feed: [],
    results: null, // filled at reveal
    scores, // cumulative scores across rounds
    nextPickers: null,
  }
}

// Picker `from` taps `target`. Returns { state?, replies[] }.
function pickAction(s, sec, from, target) {
  const replies = []
  if (s.phase !== 'picking' || !s.players[from]?.isPicker || sec.picks[from]) return { replies }
  if (!s.players[target] || s.players[target].isPicker) return { replies }
  if (Object.values(sec.picks).includes(target)) {
    replies.push({ to: from, type: 'notice', data: { text: `Someone already tapped ${s.players[target].name}. Pick someone else.`, retry: true } })
    return { replies }
  }
  sec.picks[from] = target
  replies.push({ to: from, type: 'notice', data: { text: `You tapped ${s.players[target].name}. Keep a straight face.` } })
  return { state: { ...s, players: { ...s.players, [from]: { ...s.players[from], pickedTarget: true } } }, replies }
}

const allPicked = (s, sec, presentIds) => Object.keys(s.players)
  .filter((id) => s.players[id].isPicker && (!presentIds || presentIds.has(id)))
  .every((id) => sec.picks[id])

// Picking → guessing: auto-pick for pickers who ran out of time, then tell the tapped.
function revealTaps(s, sec, t, shuffle = shuffled) {
  const players = { ...s.players }
  const pickers = Object.keys(players).filter((id) => players[id].isPicker)
  const sitters = Object.keys(players).filter((id) => !players[id].isPicker)
  const tapped = new Set(Object.values(sec.picks))
  for (const pid of pickers) {
    if (sec.picks[pid]) continue
    const available = sitters.filter((id) => !tapped.has(id))
    if (!available.length) continue
    const pick = shuffle(available)[0]
    sec.picks[pid] = pick
    tapped.add(pick)
  }
  const replies = []
  for (const [pickerId, targetId] of Object.entries(sec.picks)) {
    if (!players[targetId] || !players[pickerId]) continue
    players[targetId] = { ...players[targetId], tappedBy: true }
    players[pickerId] = { ...players[pickerId], pickedTarget: true }
    replies.push({ to: targetId, type: 'tapped', data: {} })
  }
  return { state: { ...s, phase: 'guessing', players, guessUntil: t + GUESS_MS }, replies }
}

function guessAction(s, from, target) {
  const me = s.players[from]
  if (s.phase !== 'guessing' || !me?.tappedBy || me.guess || !s.players[target]?.isPicker) return null
  return { ...s, players: { ...s.players, [from]: { ...me, guess: target } } }
}

const allGuessed = (s, presentIds) => Object.keys(s.players)
  .filter((id) => s.players[id].tappedBy && (!presentIds || presentIds.has(id)))
  .every((id) => s.players[id].guess)

function resolveGuesses(s, sec) {
  const players = { ...s.players }
  const feed = []
  const scores = { ...s.scores }
  const tappedBy = {}
  for (const [pickerId, targetId] of Object.entries(sec.picks)) tappedBy[targetId] = pickerId
  const nextPickers = Object.keys(players).filter((id) => players[id].isPicker)
  let correctCount = 0
  for (const [pickerId, targetId] of Object.entries(sec.picks)) {
    const sitter = players[targetId]
    if (!sitter || !players[pickerId]) continue
    const correct = sitter.guess === pickerId
    players[targetId] = { ...sitter, tappedBy: pickerId, correct, score: correct ? 1 : 0 }
    players[pickerId] = { ...players[pickerId], pickedTarget: targetId, score: correct ? 0 : 1 }
    const winner = correct ? targetId : pickerId
    scores[winner] = (scores[winner] || 0) + 1
    if (correct) {
      correctCount += 1
      nextPickers[nextPickers.indexOf(pickerId)] = targetId // swap places
      feed.push({ id: `correct-${targetId}`, text: `${sitter.name} caught ${players[pickerId].name} and swaps in.` })
    } else {
      feed.push({ id: `wrong-${targetId}`, text: sitter.guess
        ? `${sitter.name} guessed ${players[sitter.guess]?.name || '?'} — it was ${players[pickerId].name}.`
        : `${sitter.name} didn’t guess — it was ${players[pickerId].name}.` })
    }
  }
  const tappedCount = Object.keys(tappedBy).length
  feed.unshift({ id: `summary-${s.roundNumber}`, text: `Round ${s.roundNumber}: ${correctCount}/${tappedCount} caught their picker.` })
  return { ...s, phase: 'reveal', players, results: { correctCount, tappedCount }, feed: feed.slice(0, 20), scores, nextPickers }
}

// Pure rules, exported for headless tests.
export const headsUpEngine = { pickerCountFor, initialState, pickAction, allPicked, revealTaps, guessAction, allGuessed, resolveGuesses }

// ─── Component ────────────────────────────────────────────────────────────────
export function HeadsUp7UpGame({ room, onExit }) {
  useStudioFonts()
  const snap = useRoomSnapshot(room)
  const now = useRoomClock(room, 500)
  const [myInfo, setMyInfo] = useState(null) // { round, isPicker }
  const [myTap, setMyTap] = useState(null) // picker: { round, target } (answers a new host's hu_whois)
  const [pick, setPick] = useState(null) // { key, id } local selection
  const [notice, setNotice] = useState(null)
  const noticeTimer = useRef(null)
  const secret = useRef(null) // host only: { round, picks: { pickerId: targetId } }
  const recovery = useRef({ round: null, since: 0, picks: {} }) // host only, after migration

  const meId = snap?.me?.id
  const isHost = !!snap?.isHost
  const state = snap?.state?.game === 'heads-up' ? snap.state : null
  const round = state?.round

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
      room.onMessage('role_hu', (d) => {
        if (d && typeof d.round === 'number') setMyInfo({ round: d.round, isPicker: !!d.isPicker })
      }),
      room.onMessage('notice', (d) => {
        buzz('warning')
        flash(String(d?.text || ''))
        if (d?.retry) setMyTap(null) // the host turned the pick down: pick again
      }),
      room.onMessage('tapped', () => { buzz('heavy'); flash('Someone tapped you. Heads up — guess who.') }),
    ]
    return () => offs.forEach((off) => off())
  }, [room])

  useEffect(() => {
    if (!room) return undefined
    return room.onMessage('hu_whois', (d, from) => {
      if (myTap && d?.round === round && myTap.round === round) room.send('hu_iam', { round, target: myTap.target }, { to: from })
    })
  }, [room, myTap, round])

  useEffect(() => { setMyInfo(null) }, [round])
  const phaseKey = state ? `${state.round}-${state.phase}` : ''
  useEffect(() => { setPick(null) }, [phaseKey])

  // Record result
  useEffect(() => {
    if (state?.phase === 'reveal' && state.results && meId) {
      const me = state.players[meId]
      if (me && (me.tappedBy || me.isPicker)) recordRoundResult(room, { result: me.score > 0 ? 'win' : 'loss', score: me.score })
    }
  }, [state?.phase]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Host logic ──
  const notify = (to, t, data) => {
    if (to === meId) room.emitter.emit(`msg:${t}`, data, meId)
    else room.send(t, data, { to })
  }
  const send = (replies) => { for (const r of replies) notify(r.to, r.type, r.data) }

  useEffect(() => {
    if (!room || !isHost) return undefined
    const offs = [
      room.onMessage('role_req_hu', (d, from) => {
        const s = room.getState()
        if (s && d?.round === s.round) notify(from, 'role_hu', { round: s.round, isPicker: !!s.players[from]?.isPicker })
      }),
      room.onMessage('hu_iam', (d, from) => {
        const s = room.getState()
        if (!s || d?.round !== s.round || !s.players[from]?.isPicker || !s.players[d.target]) return
        if (recovery.current.round !== s.round) recovery.current = { round: s.round, since: room.now(), picks: {} }
        recovery.current.picks[from] = d.target
      }),
    ]
    return () => offs.forEach((off) => off())
  }, [room, isHost]) // eslint-disable-line react-hooks/exhaustive-deps

  useHostLoop(room, isHost, {
    onTick: () => {
      const s = room.getState()
      const t = room.now()
      const roundNo = room.info.round || 0
      if (roundNo > 0 && (!s || s.game !== 'heads-up' || s.round !== roundNo)) {
        const next = initialState(room.roster, room.info, t)
        secret.current = { round: roundNo, picks: {} }
        room.publishState(next)
        for (const id of Object.keys(next.players)) notify(id, 'role_hu', { round: roundNo, isPicker: next.players[id].isPicker })
        return
      }
      if (!s || s.phase === 'reveal') return
      if (!secret.current || secret.current.round !== s.round) {
        // Host migrated mid-round.
        if (s.phase === 'countdown' || s.phase === 'picking') {
          // Picks so far are lost: let the pickers pick again.
          secret.current = { round: s.round, picks: {} }
          const players = {}
          for (const [id, p] of Object.entries(s.players)) players[id] = { ...p, pickedTarget: null }
          room.publishState({ ...s, players, pickUntil: s.phase === 'picking' ? t + PICK_MS : s.pickUntil })
          return
        }
        // Guessing: pickers know their own tap.
        if (recovery.current.round !== s.round) recovery.current = { round: s.round, since: t, picks: {} }
        if (myTap?.round === s.round) recovery.current.picks[meId] = myTap.target
        const present = room.presentIds()
        const pickers = Object.keys(s.players).filter((id) => s.players[id].isPicker && present.has(id))
        if (pickers.every((id) => recovery.current.picks[id]) || t - recovery.current.since > RECOVER_MS) {
          secret.current = { round: s.round, picks: { ...recovery.current.picks } }
        } else {
          room.send('hu_whois', { round: s.round })
        }
        return
      }
      const sec = secret.current

      // Countdown → picking
      if (s.phase === 'countdown' && t >= s.startsAt) {
        room.publishState({ ...s, phase: 'picking', pickUntil: t + PICK_MS })
        return
      }

      // Picking → guessing (auto-pick for any picker who didn't choose)
      if (s.phase === 'picking' && (t >= s.pickUntil || allPicked(s, sec, room.presentIds()))) {
        const r = revealTaps(s, sec, t)
        room.publishState(r.state)
        send(r.replies)
        return
      }

      // Guessing → reveal
      if (s.phase === 'guessing' && (t >= s.guessUntil || allGuessed(s, room.presentIds()))) {
        room.publishState(resolveGuesses(s, sec))
      }
    },
    onAction: (action, from) => {
      const s = room.getState()
      const sec = secret.current
      if (!s || s.game !== 'heads-up' || !sec || sec.round !== s.round || !action) return

      if (action.type === 'pick') {
        const r = pickAction(s, sec, from, action.target)
        send(r.replies)
        if (!r.state) return
        if (allPicked(r.state, sec, room.presentIds())) {
          const rv = revealTaps(r.state, sec, room.now())
          room.publishState(rv.state)
          send(rv.replies)
        } else {
          room.publishState(r.state)
        }
      }

      if (action.type === 'guess') {
        const next = guessAction(s, from, action.target)
        if (!next) return
        room.publishState(allGuessed(next, room.presentIds()) ? resolveGuesses(next, sec) : next)
      }
    },
  }, 500)

  // ── Render ──
  if (!room || !snap) return null
  if (!state) return <StSpectating title="Starting" text="Choosing the pickers…" />
  const me = state.players[meId]
  if (!me) return <StSpectating />

  const avatarOf = (id) => snap.roster.find((r) => r.id === id)?.avatar
  const nameOf = (id) => state.players[id]?.name || '?'
  const playerOf = (id) => ({ id, username: id === meId ? `${nameOf(id)} (you)` : nameOf(id), avatar: avatarOf(id) })
  const isPicker = myInfo?.round === round ? myInfo.isPicker : me.isPicker
  const ids = Object.keys(state.players)
  const pickers = ids.filter((id) => state.players[id].isPicker)
  const sitters = ids.filter((id) => !state.players[id].isPicker)
  const myScore = state.scores?.[meId] || 0
  const kicker = `Round ${state.roundNumber}`

  // ── Countdown ──
  if (state.phase === 'countdown') {
    return (
      <StReveal
        kicker={`Heads Up 7 Up · ${kicker} · you are`}
        title={isPicker ? 'A picker' : 'Heads down'}
        color={isPicker ? ST.objective : ST.friendly}
        icon={isPicker ? 'hand-left-outline' : 'eye-off-outline'}
        body={isPicker ? 'You’ll secretly tap one person. Don’t let them guess it was you.' : 'Put your head down and your phone face-down. Someone might tap you.'}
        count={Math.max(0, Math.ceil((state.startsAt - now) / 1000))}
        foot={`${state.pickerCount} picker${state.pickerCount === 1 ? '' : 's'} · ${sitters.length} heads down`}
      />
    )
  }

  // ── Picking phase ──
  if (state.phase === 'picking') {
    const timeLeft = Math.max(0, state.pickUntil - now)
    const ring = <StRing size={74} progress={timeLeft / PICK_MS} color={ST.objective} value={Math.ceil(timeLeft / 1000)} />
    if (isPicker) {
      const alreadyPicked = !!me.pickedTarget || myTap?.round === round
      const sel = pick?.key === 'pick' ? pick.id : null
      return (
        <StScreen>
          <StHero kicker={`${kicker} · you are a picker`} color={ST.objective} title="Tap someone" sub="Pick one person with their head down. They’ll try to guess it was you." />
          <View style={styles.ringRow}>{ring}</View>
          {alreadyPicked ? (
            <StBanner icon="checkmark" color={ST.objective} text={myTap?.round === round ? `You tapped ${nameOf(myTap.target)}.` : 'You’ve made your pick.'} sub="Keep a straight face. Waiting for the other pickers…" />
          ) : (
            <>
              <StLabel>Heads down · {sitters.length}</StLabel>
              <StGrid cols={2} style={{ marginTop: 6 }}>
                {sitters.map((id) => (
                  <StPlayerTile key={id} compact player={playerOf(id)} color={ST.objective} selected={sel === id} onPress={() => setPick({ key: 'pick', id })} />
                ))}
              </StGrid>
              <StButton
                title={sel ? `Tap ${nameOf(sel)}` : 'Choose someone'}
                tone="objective"
                disabled={!sel}
                style={{ marginTop: 8, marginBottom: 10 }}
                onPress={() => { buzz('select'); setMyTap({ round, target: sel }); room.sendAction({ type: 'pick', target: sel }) }}
              />
            </>
          )}
          {!!notice && <StBanner text={notice} color={ST.objective} icon="information-circle-outline" />}
          <Text style={[stType.small, { color: 'rgba(242,244,247,0.55)' }]}>Long-press a player for their iYiYi profile.</Text>
        </StScreen>
      )
    }
    // Sitter during picking
    return (
      <StScreen scroll={false} style={styles.center}>
        <Ionicons name="eye-off-outline" size={44} color={ST.friendly} />
        <Text style={[stType.kicker, { marginTop: 14 }]}>{kicker} · heads down</Text>
        <Text style={[stType.display, { textAlign: 'center' }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.5}>Heads down</Text>
        <Text style={[stType.body, { textAlign: 'center', marginTop: 8, maxWidth: 320 }]}>The pickers are choosing. Phone face-down, eyes closed — you’ll feel a buzz if you’re tapped.</Text>
        <View style={{ marginTop: 22 }}>{ring}</View>
      </StScreen>
    )
  }

  // ── Guessing phase ──
  if (state.phase === 'guessing') {
    const timeLeft = Math.max(0, state.guessUntil - now)
    const wasTapped = !!me.tappedBy
    const hasGuessed = !!me.guess
    const sel = pick?.key === 'guess' ? pick.id : null
    const tappedIds = ids.filter((id) => state.players[id].tappedBy)
    return (
      <StScreen>
        <StHero
          kicker={wasTapped ? `${kicker} · you were tapped` : isPicker ? `${kicker} · you are a picker` : `${kicker} · heads up`}
          color={ST.objective}
          title={wasTapped ? 'Who tapped you?' : isPicker ? 'Straight face' : 'Not tapped'}
          sub={wasTapped ? 'Guess right and you swap in as a picker.' : isPicker ? 'The tapped players are guessing. Don’t give it away.' : 'You weren’t tapped this round. Watch the guesses.'}
        />
        <View style={styles.ringRow}><StRing size={74} progress={timeLeft / GUESS_MS} color={ST.objective} value={Math.ceil(timeLeft / 1000)} /></View>

        {wasTapped && !hasGuessed ? (
          <>
            <StLabel>The {pickers.length} picker{pickers.length === 1 ? '' : 's'}</StLabel>
            <StGrid cols={2} style={{ marginTop: 6 }}>
              {pickers.map((id) => (
                <StPlayerTile key={id} compact player={playerOf(id)} color={ST.objective} selected={sel === id} onPress={() => setPick({ key: 'guess', id })} />
              ))}
            </StGrid>
          </>
        ) : null}
        <StStats style={{ marginTop: 10 }} items={[
          { label: 'Your pts', value: String(myScore) },
          { label: 'Guessing', value: `${tappedIds.filter((id) => state.players[id].guess).length}/${tappedIds.length}` },
          { label: 'Players', value: String(ids.length) },
        ]} />
        {wasTapped && !hasGuessed ? (
          <StButton
            title={sel ? `Lock in ${nameOf(sel)}` : 'Pick a picker'}
            tone="objective"
            disabled={!sel}
            style={{ marginBottom: 10 }}
            onPress={() => { buzz('select'); room.sendAction({ type: 'guess', target: sel }) }}
          />
        ) : null}
        {wasTapped && hasGuessed ? <StBanner icon="lock-closed-outline" color={ST.objective} text={`You guessed ${nameOf(me.guess)}.`} sub="Waiting for the others…" /> : null}
        {!wasTapped ? (
          <StSection label="Tapped players">
            {tappedIds.map((id) => (
              <StPlayerRow key={id} player={playerOf(id)} subtitle={state.players[id].guess ? `Guessed ${nameOf(state.players[id].guess)}` : 'Thinking…'} right={state.players[id].guess ? <StTag text="Locked" color={ST.objective} /> : null} />
            ))}
          </StSection>
        ) : null}
        {!!notice && <StBanner text={notice} color={ST.objective} icon="information-circle-outline" />}
      </StScreen>
    )
  }

  // ── Reveal ──
  if (state.phase === 'reveal') {
    const sortedScores = Object.entries(state.scores || {})
      .filter(([id]) => state.players[id])
      .map(([id, sc]) => ({ id, score: sc }))
      .sort((a, b) => b.score - a.score)
    const top = sortedScores[0]?.score ?? 0
    const pairs = pickers.map((pid) => {
      const target = typeof state.players[pid].pickedTarget === 'string' ? state.players[pid].pickedTarget : null
      return { pid, target, caught: target ? !!state.players[target]?.correct : false }
    })
    const next = Array.isArray(state.nextPickers) ? state.nextPickers.filter((id) => state.players[id]) : null
    const r = state.results
    return (
      <StScreen>
        <StHero
          kicker={`Heads Up 7 Up · ${kicker} results`}
          color={ST.objective}
          title={r ? `${r.correctCount}/${r.tappedCount} caught` : 'Results'}
          sub={me.score > 0 ? (me.isPicker ? 'You weren’t caught. +1' : 'You caught your picker. +1') : me.tappedBy ? 'Not this time.' : me.isPicker ? 'You got caught.' : 'You weren’t tapped this round.'}
          big
        />
        <StSection label="This round">
          {pairs.map(({ pid, target, caught }) => (
            <StPlayerRow
              key={pid}
              player={playerOf(pid)}
              color={caught ? ST.enemy : ST.health}
              subtitle={target ? `Tapped ${nameOf(target)} · ${state.players[target]?.guess ? `guessed ${nameOf(state.players[target].guess)}` : 'no guess'}` : 'Didn’t tap anyone'}
              right={target ? <StTag text={caught ? 'Caught' : 'Fooled'} color={caught ? ST.enemy : ST.health} /> : null}
            />
          ))}
        </StSection>
        {next?.length ? (
          <StSection label="Next round’s pickers">
            <Text style={stType.body}>{next.map(nameOf).join(' · ')}</Text>
          </StSection>
        ) : null}
        <StSection label="Scoreboard · follow on iYiYi">
          {sortedScores.map((sc) => (
            <StPlayerRow
              key={sc.id}
              player={playerOf(sc.id)}
              subtitle={sc.score === top && top > 0 ? 'Leading' : null}
              subtitleColor={ST.objective}
              right={<Text style={[stType.num, styles.score, sc.score === top && top > 0 && { color: ST.objective }]}>{sc.score}</Text>}
            />
          ))}
        </StSection>
        <StFeed items={state.feed} label="Guesses" max={20} />
        <StResultsFooter
          isHost={isHost}
          againTitle="Next round"
          waiting="Waiting for the host to start the next round…"
          onAgain={() => room.setInfo({ round: (snap.info.round || 0) + 1, _scores: state.scores, _pickers: next || undefined })}
          onExit={onExit}
        />
      </StScreen>
    )
  }

  return null
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center', padding: 24 },
  ringRow: { alignItems: 'center', marginBottom: 12 },
  score: { fontSize: 20, minWidth: 30, textAlign: 'right' },
})
