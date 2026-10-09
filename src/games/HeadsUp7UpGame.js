// Heads Up 7 Up — classic classroom game adapted for mobile (8–30 players).
//
// 7 players are "pickers". Everyone else puts their head down (phone face-down).
// Each picker secretly taps one person. Tapped players then try to guess who
// tapped them. Correct guesses swap places with the picker.
// Host-authoritative via the existing Room system.
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { Avatar, Btn, Card, Pill, PlayerRow, Spectating, formatClock } from './MultiplayerUI'
import {
  recordRoundResult,
  useHostLoop, useRoomClock, useRoomSnapshot,
} from '../lib/multiplayer'
import { buzz } from '../lib/gamePrefs'
import { colors, radii, type } from '../theme'

// ─── Timing ───────────────────────────────────────────────────────────────────
const COUNTDOWN_MS = 5000
const PICK_MS = 30000
const GUESS_MS = 20000

function shuffled(arr) {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]] }
  return a
}

// ─── Engine ───────────────────────────────────────────────────────────────────
function initialState(roster, info, now) {
  const ids = roster.map((p) => p.id)
  const n = ids.length
  const pickerCount = Math.min(7, Math.floor(n / 2)) // At least half sit
  const shuffledIds = shuffled(ids)
  const pickers = new Set(shuffledIds.slice(0, pickerCount))

  const players = {}
  for (const p of roster) {
    players[p.id] = {
      name: p.username,
      isPicker: pickers.has(p.id),
      tappedBy: null,    // who tapped this sitter (null if untapped or if picker)
      pickedTarget: null, // who this picker chose (null if sitter or not yet chosen)
      guess: null,        // sitter's guess of who tapped them
      correct: false,     // did the guess match?
      score: 0,
    }
  }

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
    scores: info._scores || {}, // cumulative scores across rounds
  }
}

// ─── Component ────────────────────────────────────────────────────────────────
export function HeadsUp7UpGame({ room, onExit }) {
  const snap = useRoomSnapshot(room)
  const now = useRoomClock(room, 500)
  const [myInfo, setMyInfo] = useState(null) // { round, isPicker }
  const [notice, setNotice] = useState(null)
  const noticeTimer = useRef(null)
  const secret = useRef(null) // host only: { round, picks: { pickerId: targetId } }

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
      room.onMessage('notice', (d) => { buzz('warning'); flash(String(d?.text || '')) }),
      room.onMessage('tapped', () => { buzz('heavy'); flash('Someone tapped you! Get ready to guess.') }),
    ]
    return () => offs.forEach((off) => off())
  }, [room])

  useEffect(() => { setMyInfo(null) }, [round])

  // Record result
  useEffect(() => {
    if (state?.phase === 'reveal' && state.results && meId) {
      const me = state.players[meId]
      if (me) recordRoundResult(room, { result: me.correct ? 'win' : 'loss', score: me.score })
    }
  }, [state?.phase]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Host logic ──
  const notify = (to, t, data) => {
    if (to === meId) room.emitter.emit(`msg:${t}`, data, meId)
    else room.send(t, data, { to })
  }

  useEffect(() => {
    if (!room || !isHost) return undefined
    return room.onMessage('role_req_hu', (d, from) => {
      const s = room.getState()
      if (s && d?.round === s.round) notify(from, 'role_hu', { round: s.round, isPicker: !!s.players[from]?.isPicker })
    })
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
      if (!s) return
      const sec = secret.current
      if (!sec || sec.round !== s.round) return

      // Countdown → picking
      if (s.phase === 'countdown' && t >= s.startsAt) {
        room.publishState({ ...s, phase: 'picking', pickUntil: t + PICK_MS })
        return
      }

      // Picking → guessing (auto-pick for any picker who didn't choose)
      if (s.phase === 'picking' && t >= s.pickUntil) {
        const players = { ...s.players }
        const pickers = Object.keys(players).filter((id) => players[id].isPicker)
        const sitters = Object.keys(players).filter((id) => !players[id].isPicker)
        const tapped = new Set(Object.values(sec.picks))

        for (const pid of pickers) {
          if (!sec.picks[pid] && sitters.length > 0) {
            const available = sitters.filter((id) => !tapped.has(id))
            if (available.length > 0) {
              const pick = shuffled(available)[0]
              sec.picks[pid] = pick
              tapped.add(pick)
            }
          }
        }

        for (const [pickerId, targetId] of Object.entries(sec.picks)) {
          players[targetId] = { ...players[targetId], tappedBy: pickerId }
          players[pickerId] = { ...players[pickerId], pickedTarget: targetId }
          notify(targetId, 'tapped', {})
        }

        room.publishState({ ...s, phase: 'guessing', players, guessUntil: t + GUESS_MS })
        return
      }

      // Guessing → reveal
      if (s.phase === 'guessing' && t >= s.guessUntil) {
        resolveGuesses(s, sec)
        return
      }
    },
    onAction: (action, from) => {
      const s = room.getState()
      const sec = secret.current
      if (!s || s.game !== 'heads-up' || !sec || sec.round !== s.round) return

      if (action.type === 'pick' && s.phase === 'picking' && s.players[from]?.isPicker && !sec.picks[from]) {
        const target = action.target
        if (!s.players[target] || s.players[target].isPicker) return
        if (Object.values(sec.picks).includes(target)) return // already tapped
        sec.picks[from] = target
        notify(from, 'notice', { text: `You tapped ${s.players[target].name}. Wait for everyone.` })
        // Check if all pickers have picked
        const pickers = Object.keys(s.players).filter((id) => s.players[id].isPicker)
        if (pickers.every((id) => sec.picks[id])) {
          // Advance to guessing immediately
          const players = { ...s.players }
          for (const [pickerId, targetId] of Object.entries(sec.picks)) {
            players[targetId] = { ...players[targetId], tappedBy: pickerId }
            players[pickerId] = { ...players[pickerId], pickedTarget: targetId }
            notify(targetId, 'tapped', {})
          }
          room.publishState({ ...s, phase: 'guessing', players, guessUntil: room.now() + GUESS_MS })
        }
      }

      if (action.type === 'guess' && s.phase === 'guessing' && s.players[from]?.tappedBy && !s.players[from].guess) {
        const newPlayers = { ...s.players, [from]: { ...s.players[from], guess: action.target } }
        room.publishState({ ...s, players: newPlayers })
        // Check if all tapped players have guessed
        const tappedIds = Object.keys(newPlayers).filter((id) => newPlayers[id].tappedBy)
        if (tappedIds.every((id) => newPlayers[id].guess)) {
          resolveGuesses({ ...s, players: newPlayers }, sec)
        }
      }
    },
  }, 500)

  function resolveGuesses(s, sec) {
    const players = { ...s.players }
    const feed = []
    const scores = { ...s.scores }

    for (const [id, p] of Object.entries(players)) {
      if (p.tappedBy && p.guess) {
        const correct = p.guess === p.tappedBy
        players[id] = { ...players[id], correct, score: correct ? 1 : 0 }
        if (!scores[id]) scores[id] = 0
        if (correct) {
          scores[id]++
          feed.push({ id: `correct-${id}`, text: `✅ ${p.name} correctly guessed ${players[p.tappedBy]?.name || '?'}!` })
        } else {
          feed.push({ id: `wrong-${id}`, text: `❌ ${p.name} guessed wrong. It was ${players[p.tappedBy]?.name || '?'}.` })
        }
      }
    }

    const correctCount = Object.values(players).filter((p) => p.correct).length
    const tappedCount = Object.values(players).filter((p) => p.tappedBy).length
    feed.unshift({ id: `summary-${s.roundNumber}`, text: `Round ${s.roundNumber}: ${correctCount}/${tappedCount} correct guesses.` })

    room.publishState({ ...s, phase: 'reveal', players, results: { correctCount, tappedCount }, feed: feed.slice(0, 20), scores })
  }

  // ── Render ──
  if (!room || !snap) return null
  if (!state) return <Spectating text="Starting…" />
  const me = state.players[meId]
  if (!me) return <Spectating />

  const avatarOf = (id) => snap.roster.find((r) => r.id === id)?.avatar
  const isPicker = myInfo?.round === round ? myInfo.isPicker : me.isPicker
  const pickers = Object.entries(state.players).filter(([, p]) => p.isPicker)
  const sitters = Object.entries(state.players).filter(([, p]) => !p.isPicker)

  // ── Countdown ──
  if (state.phase === 'countdown') {
    const left = Math.max(0, Math.ceil((state.startsAt - now) / 1000))
    return (
      <View style={[styles.reveal, { backgroundColor: isPicker ? '#8b5cf6' : '#3b82f6' }]}>
        <Text style={styles.revealIcon}>{isPicker ? '👆' : '😴'}</Text>
        <Text style={styles.revealSmall}>You are a</Text>
        <Text style={styles.revealBig}>{isPicker ? 'PICKER' : 'SITTER'}</Text>
        <Text style={styles.revealSmall}>
          {isPicker ? 'You'll secretly tap someone. Don't let them guess it was you!' : 'Put your head down. Someone will tap you.'}
        </Text>
        <Text style={styles.revealCount}>{left}</Text>
      </View>
    )
  }

  // ── Picking phase ──
  if (state.phase === 'picking') {
    const timeLeft = Math.max(0, state.pickUntil - now)
    if (isPicker) {
      const alreadyPicked = !!me.pickedTarget
      return (
        <ScrollView contentContainerStyle={styles.pad}>
          <Card style={styles.phaseCard}>
            <Text style={styles.phaseIcon}>👆</Text>
            <Text style={[type.display, { textAlign: 'center' }]}>Choose someone to tap</Text>
            <Text style={[type.display, { textAlign: 'center', marginTop: 8 }]}>{formatClock(timeLeft)}</Text>
          </Card>
          {alreadyPicked ? (
            <Card><Text style={[type.body, { textAlign: 'center' }]}>✓ You've made your pick. Waiting for other pickers…</Text></Card>
          ) : (
            <Card>
              <Text style={[type.label, { marginBottom: 6 }]}>Sitters (tap one)</Text>
              {sitters.map(([id, p]) => (
                <PlayerRow key={id} player={{ username: p.name, avatar: avatarOf(id) }}
                  right={<Btn title="Tap" size="sm" variant="primary" onPress={() => { buzz('select'); room.sendAction({ type: 'pick', target: id }) }} />}
                />
              ))}
            </Card>
          )}
          {!!notice && <Card><Text style={type.body}>{notice}</Text></Card>}
        </ScrollView>
      )
    }
    // Sitter during picking
    return (
      <View style={[styles.reveal, { backgroundColor: colors.inkSurfaceRaised }]}>
        <Text style={styles.revealIcon}>😴</Text>
        <Text style={[type.display, { textAlign: 'center' }]}>Heads down!</Text>
        <Text style={[type.body, { textAlign: 'center', marginTop: 8, color: colors.textMuted }]}>
          The pickers are choosing. Keep your eyes closed…
        </Text>
        <Text style={[type.display, { textAlign: 'center', marginTop: 16 }]}>{formatClock(timeLeft)}</Text>
      </View>
    )
  }

  // ── Guessing phase ──
  if (state.phase === 'guessing') {
    const timeLeft = Math.max(0, state.guessUntil - now)
    const wasTapped = !!me.tappedBy
    const hasGuessed = !!me.guess

    return (
      <ScrollView contentContainerStyle={styles.pad}>
        <Card style={styles.phaseCard}>
          <Text style={styles.phaseIcon}>🤔</Text>
          <Text style={[type.display, { textAlign: 'center' }]}>Heads Up!</Text>
          <Text style={[type.display, { textAlign: 'center', marginTop: 8 }]}>{formatClock(timeLeft)}</Text>
          <Text style={[type.caption, { textAlign: 'center', marginTop: 4 }]}>
            {wasTapped ? 'You were tapped! Guess who did it.' : isPicker ? 'Wait for guesses. Keep a straight face!' : 'You weren't tapped this round.'}
          </Text>
        </Card>

        {wasTapped && !hasGuessed && (
          <Card>
            <Text style={[type.label, { marginBottom: 6 }]}>Who tapped you?</Text>
            {pickers.map(([id, p]) => (
              <PlayerRow key={id} player={{ username: p.name, avatar: avatarOf(id) }}
                right={<Btn title="Guess" size="sm" variant="primary" onPress={() => { buzz('select'); room.sendAction({ type: 'guess', target: id }) }} />}
              />
            ))}
          </Card>
        )}

        {wasTapped && hasGuessed && (
          <Card><Text style={[type.body, { textAlign: 'center' }]}>✓ Guess submitted! Waiting for others…</Text></Card>
        )}

        {!!notice && <Card><Text style={type.body}>{notice}</Text></Card>}
      </ScrollView>
    )
  }

  // ── Reveal ──
  if (state.phase === 'reveal') {
    const sortedScores = Object.entries(state.scores)
      .map(([id, s]) => ({ id, name: state.players[id]?.name || id, score: s }))
      .sort((a, b) => b.score - a.score)

    return (
      <ScrollView contentContainerStyle={styles.pad}>
        <Card style={styles.phaseCard}>
          <Text style={styles.phaseIcon}>🎉</Text>
          <Text style={[type.display, { textAlign: 'center' }]}>Results</Text>
          {state.results && (
            <Text style={[type.body, { textAlign: 'center', marginTop: 6 }]}>
              {state.results.correctCount}/{state.results.tappedCount} guessed correctly!
            </Text>
          )}
        </Card>

        <Card>
          <Text style={[type.label, { marginBottom: 6 }]}>This round</Text>
          {state.feed.map((f) => <Text key={f.id} style={[type.body, { marginVertical: 3 }]}>{f.text}</Text>)}
        </Card>

        {sortedScores.length > 0 && (
          <Card>
            <Text style={[type.label, { marginBottom: 6 }]}>Scoreboard</Text>
            {sortedScores.map((s, i) => (
              <PlayerRow key={s.id}
                player={{ username: s.id === meId ? `${s.name} (you)` : s.name, avatar: avatarOf(s.id) }}
                right={<View style={styles.scoreBadge}>
                  <Text style={styles.scoreText}>{s.score}</Text>
                </View>}
                subtitle={i === 0 ? '👑 Leading' : ''}
              />
            ))}
          </Card>
        )}

        {isHost
          ? <Btn title="Next round" variant="primary" onPress={() => room.setInfo({ round: (snap.info.round || 0) + 1, _scores: state.scores })} />
          : <Text style={[type.caption, { textAlign: 'center' }]}>Waiting for the host to start the next round…</Text>}
        <Btn title="Leave" onPress={onExit} style={{ marginTop: 12 }} />
      </ScrollView>
    )
  }

  return null
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  pad: { padding: 12, paddingBottom: 40 },
  reveal: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28, borderRadius: radii.lg },
  revealIcon: { fontSize: 64, marginBottom: 12 },
  revealSmall: { ...type.body, color: 'rgba(255,255,255,0.8)', textAlign: 'center', marginTop: 8 },
  revealBig: { fontSize: 40, fontWeight: '800', letterSpacing: 2, color: '#ffffff', marginTop: 8 },
  revealCount: { fontSize: 72, fontWeight: '800', color: '#ffffff', marginTop: 20 },
  phaseCard: { alignItems: 'center', paddingVertical: 24 },
  phaseIcon: { fontSize: 48, marginBottom: 8 },
  scoreBadge: { backgroundColor: colors.magenta, borderRadius: radii.pill, paddingHorizontal: 12, paddingVertical: 4, minWidth: 36, alignItems: 'center' },
  scoreText: { ...type.body, fontWeight: '800', color: colors.onBrand },
})
