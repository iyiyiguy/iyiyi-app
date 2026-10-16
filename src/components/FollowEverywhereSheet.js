import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  View, Text, Modal, Pressable, ScrollView, StyleSheet, AppState, Linking, Alert, Platform, ActivityIndicator,
} from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import * as Haptics from 'expo-haptics'
import { colors, font, radii, type } from '../theme'
import { PLATFORM_LABELS, socialUrl } from '../lib/socialLinks'
import SocialIcon from './SocialIcon'
import Avatar from './Avatar'
import { apiJson, post, del } from '../lib/api'
import { loadProfile } from '../lib/followCache'
import { maybeOfferPushAfterFollow } from '../lib/pushPrompt'
import { useT, translate } from '../i18n'
import strings from '../i18n/strings/followEverywhere'
import { logFollowEverywhere } from '../lib/attribution'

// One place to follow someone on every platform they've linked. Instagram, TikTok, Snapchat
// and most others don't let apps follow on your behalf, so the sheet steps through them: it
// opens the next platform (its own app when installed, the web otherwise), and when you come
// back to iYiYi it asks "Followed?" - Yes ticks it and moves straight on to the next one.
// Opening the sheet follows on iYiYi right away (that's the obvious intent). Each tick is
// saved to your account (so it shows under "Profiles followed", and they can see you
// followed them there via iYiYi), and you can come back and finish later.

// ---- shared helpers (also used by the person cards) ---------------------------------------

export const personId = (u) => u?.user_id ?? u?.id ?? null
export const isActiveStatus = (s) => s === 'accepted' || s === 'pending'

// Platforms someone is on, from whatever the payload carries: social_links [{ platform, value }]
// or a bare platforms list. null = the payload doesn't say (the sheet loads the profile).
export function platformsOf(user) {
  if (!user) return null
  const list = Array.isArray(user.social_links)
    ? user.social_links.filter((l) => l?.value).map((l) => l.platform)
    : Array.isArray(user.platforms) ? user.platforms : null
  if (!list) return null
  return Array.from(new Set(list.filter((p) => PLATFORM_LABELS[p])))
}

// "~40 ft" / "~0.3 mi" from any distance the API sends (meters, feet or miles), else null.
export function formatDistance(user) {
  if (!user) return null
  if (typeof user.distance_label === 'string' && user.distance_label) return user.distance_label
  const n = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() && Number.isFinite(Number(v)) ? Number(v) : null)
  let ft = null
  if (n(user.distance_ft) != null) ft = n(user.distance_ft)
  else if (n(user.distance_m) != null) ft = n(user.distance_m) * 3.28084
  else if (n(user.distance_miles) != null) ft = n(user.distance_miles) * 5280
  else if (n(user.distance) != null) ft = n(user.distance) * 3.28084
  if (ft == null || ft < 0) return null
  if (ft < 1000) return `~${Math.max(5, Math.round(ft / 5) * 5)} ft`
  const mi = ft / 5280
  return `~${mi < 10 ? mi.toFixed(1) : Math.round(mi)} mi`
}

// Handle without the @ / URL wrapping, or null when it can't be read reliably.
function handleFrom(platform, value) {
  const v = String(value ?? '').trim()
  if (!v) return null
  if (!/^https?:\/\//i.test(v)) return v.replace(/^[@/]+/, '').split(/[/?#\s]/)[0] || null
  const path = v.replace(/^https?:\/\/[^/]+\/?/i, '').split(/[?#]/)[0]
  const seg = path.split('/').filter(Boolean)
  if (!seg.length) return null
  if (platform === 'snapchat' && seg[0] === 'add') return seg[1] ?? null
  if (platform === 'linkedin' && seg[0] === 'in') return seg[1] ?? null
  if (platform === 'tiktok' || platform === 'youtube') return seg[0].startsWith('@') ? seg[0].slice(1) : null
  return seg[0].replace(/^@/, '') || null
}

// The platform's own app, so its Follow button is right there. TikTok (and anything not listed)
// uses its https link, which the installed app claims as a universal / app link.
const NATIVE = {
  instagram: (h) => `instagram://user?username=${h}`,
  twitter: (h) => `twitter://user?screen_name=${h}`,
  snapchat: (h) => `snapchat://add/${h}`,
  youtube: (h) => (Platform.OS === 'ios' ? `youtube://www.youtube.com/@${h}` : null),
  telegram: (h) => `tg://resolve?domain=${h}`,
  twitch: (h) => `twitch://stream/${h}`,
  linkedin: (h) => (Platform.OS === 'ios' ? `linkedin://in/${h}` : null),
  spotify: (h) => `spotify:user:${h}`,
}

export function platformRows(socialLinks) {
  const seen = new Set()
  const out = []
  for (const l of Array.isArray(socialLinks) ? socialLinks : []) {
    if (!l?.value || !PLATFORM_LABELS[l.platform] || seen.has(l.platform)) continue
    const url = socialUrl(l.platform, l.value)
    if (!url) continue
    seen.add(l.platform)
    const handle = handleFrom(l.platform, l.value)
    out.push({ key: l.platform, platform: l.platform, value: l.value, handle, url, label: PLATFORM_LABELS[l.platform] })
  }
  return out
}

// Native app first; if it isn't installed (the OS rejects the scheme) the web profile.
export async function openPlatform(row) {
  const make = row.handle ? NATIVE[row.platform] : null
  const native = make ? make(encodeURIComponent(row.handle)) : null
  if (native) {
    try {
      await Linking.openURL(native)
      return true
    } catch {
      // Not installed: fall through to the web link.
    }
  }
  try {
    await Linking.openURL(row.url)
    return true
  } catch {
    Alert.alert(translate(strings, 'couldntOpenLink'), row.url)
    return false
  }
}

// Follows on iYiYi. Resolves the new status ('accepted' | 'pending'); throws on failure.
export async function followOnIyiyi(userId) {
  const res = await post(`/api/profiles/follow/${userId}`)
  return res?.status ?? 'accepted'
}

// ---- hook: one sheet per screen, opened from any card ---------------------------------------

// const fe = useFollowEverywhere({ onStatus, people, getStatus })
//   fe.open(user, { status, justFollowed })   user: any person shape ({ user_id | id, username, ... })
//   {fe.element}                               render once (inside a Modal if the cards are in one)
// people (optional) is the list the cards came from; the finish screen offers the next person
// in it you don't follow yet.
export function useFollowEverywhere({ onStatus, people, getStatus } = {}) {
  // The last target stays mounted after closing so the sheet can slide away.
  const [target, setTarget] = useState(null)
  const [visible, setVisible] = useState(false)
  const doneIds = useRef(new Set())
  const open = useCallback((user, opts = {}) => {
    if (!personId(user)) return
    setTarget({ user, status: opts.status, justFollowed: !!opts.justFollowed, key: `${personId(user)}:${Date.now()}` })
    setVisible(true)
  }, [])
  const close = useCallback(() => setVisible(false), [])

  const currentId = personId(target?.user)
  const next = useMemo(() => {
    if (!visible || !currentId || !Array.isArray(people)) return null
    const idx = people.findIndex((p) => personId(p) === currentId)
    const ordered = idx >= 0 ? [...people.slice(idx + 1), ...people.slice(0, idx)] : people
    return ordered.find((p) => {
      const id = personId(p)
      return id && id !== currentId && !doneIds.current.has(id) && !isActiveStatus(getStatus?.(id)) && !p.is_self
    }) ?? null
  }, [visible, people, currentId, getStatus])

  const element = (
    <FollowEverywhereSheet
      key={target?.key ?? 'none'}
      visible={visible && !!target}
      profile={target?.user ?? null}
      iyiyiStatus={target?.status}
      justFollowed={target?.justFollowed}
      onIyiyiStatus={(id, s) => {
        setTarget((t) => (t && personId(t.user) === id ? { ...t, status: s } : t))
        onStatus?.(id, s)
      }}
      onClose={() => { if (currentId) doneIds.current.add(currentId); close() }}
      nextPerson={next}
      onNextPerson={(u) => {
        if (currentId) doneIds.current.add(currentId)
        open(u, { status: getStatus?.(personId(u)) })
      }}
    />
  )
  return { open, close, element }
}

// ---- the sheet ----------------------------------------------------------------------------

export default function FollowEverywhereSheet({
  visible, onClose, profile, iyiyiStatus, onIyiyiStatus, justFollowed = false, autoFollow = true,
  distanceLabel, nextPerson, onNextPerson,
}) {
  const t = useT(strings)
  const id = personId(profile)
  const [loaded, setLoaded] = useState(null) // full profile, when the caller's object had no links
  const [localStatus, setLocalStatus] = useState(undefined)
  const [autoFollowed, setAutoFollowed] = useState(!!justFollowed)
  const [done, setDone] = useState({}) // platform -> true
  const [skipped, setSkipped] = useState({})
  const [current, setCurrent] = useState(null)
  const [confirm, setConfirm] = useState(null) // platform we're asking "followed?" about
  const [retry, setRetry] = useState(null) // answered "Not yet": offer to open it again
  const [toast, setToast] = useState(null) // { text, undo? }
  const awaitingRef = useRef(null) // platform opened, waiting for the user to come back
  const followedRef = useRef(!!justFollowed)
  const toastTimer = useRef(null)

  const merged = loaded ? { ...loaded, ...profile, social_links: profile?.social_links ?? loaded.social_links } : profile
  const name = merged?.username ?? ''
  const hasLinks = Array.isArray(profile?.social_links)
  const linksLoading = visible && !hasLinks && !loaded
  const rows = useMemo(() => platformRows(merged?.social_links), [merged?.social_links])

  const known = localStatus !== undefined
    ? localStatus
    : iyiyiStatus !== undefined
      ? iyiyiStatus
      : loaded ? (loaded.is_following ? 'accepted' : loaded.follow_status ?? null) : undefined
  const iyiyiActive = isActiveStatus(known)

  // Reopening the same sheet (UserProfile keeps one mounted) starts a fresh pass.
  const wasVisible = useRef(visible)
  useEffect(() => {
    if (visible && !wasVisible.current) {
      autoTried.current = false
      setLocalStatus(undefined)
      setSkipped({})
      setCurrent(null)
      setConfirm(null)
      setRetry(null)
      setToast(null)
      setAutoFollowed(!!justFollowed)
      followedRef.current = !!justFollowed
    }
    wasVisible.current = visible
  }, [visible]) // eslint-disable-line react-hooks/exhaustive-deps

  // Load the full profile when the card didn't carry the links, or we don't know yet whether
  // you follow them on iYiYi (needed before following automatically).
  const statusUnknown = iyiyiStatus === undefined
  useEffect(() => {
    if (!visible || !id || (hasLinks && !statusUnknown)) return undefined
    let alive = true
    loadProfile(id).then((p) => { if (alive) setLoaded(p || { social_links: [] }) })
    return () => { alive = false }
  }, [visible, id, hasLinks, statusUnknown])

  // Which platforms you've already ticked for this person.
  useEffect(() => {
    if (!visible || !id) return undefined
    let alive = true
    apiJson(`/api/platform-follows/status/${id}`)
      .then((d) => { if (alive) setDone(Object.fromEntries((d?.platforms ?? []).map((p) => [p, true]))) })
      .catch(() => {})
    return () => { alive = false }
  }, [visible, id])

  // Follow on iYiYi as soon as the sheet opens.
  const autoTried = useRef(false)
  useEffect(() => {
    if (!visible || !id || !autoFollow || autoTried.current || known === undefined) return
    autoTried.current = true
    if (isActiveStatus(known)) return
    setLocalStatus('accepted')
    followOnIyiyi(id)
      .then((s) => {
        followedRef.current = true
        setAutoFollowed(true)
        setLocalStatus(s)
        onIyiyiStatus?.(id, s)
      })
      .catch(() => {
        setLocalStatus(known ?? null)
        showToast(t('couldntFollow'))
      })
  }, [visible, id, autoFollow, known]) // eslint-disable-line react-hooks/exhaustive-deps

  // Coming back from the platform's app: ask whether the follow happened.
  useEffect(() => {
    if (!visible) return undefined
    let last = AppState.currentState
    const sub = AppState.addEventListener('change', (next) => {
      const wasAway = last === 'background' || last === 'inactive'
      last = next
      if (next === 'active' && wasAway && awaitingRef.current) {
        const p = awaitingRef.current
        awaitingRef.current = null
        setConfirm(p)
        Haptics.selectionAsync().catch(() => {})
      }
    })
    return () => sub.remove()
  }, [visible])

  useEffect(() => () => clearTimeout(toastTimer.current), [])

  const showToast = (text, undo) => {
    clearTimeout(toastTimer.current)
    setToast({ text, undo })
    toastTimer.current = setTimeout(() => setToast(null), 4500)
  }

  const label = (platform) => PLATFORM_LABELS[platform] ?? platform
  const firstPending = (doneMap, skipMap, after) => {
    const start = after ? rows.findIndex((r) => r.platform === after) + 1 : 0
    const ordered = [...rows.slice(start), ...rows.slice(0, start)]
    return ordered.find((r) => !doneMap[r.platform] && !skipMap[r.platform] && r.platform !== after)
      ?? ordered.find((r) => !doneMap[r.platform] && r.platform !== after)
      ?? null
  }
  const active = rows.find((r) => r.platform === current && !done[r.platform]) ?? firstPending(done, skipped, null)

  const savePlatform = async (platform, on) => {
    setDone((prev) => ({ ...prev, [platform]: on }))
    try {
      if (on) await post('/api/platform-follows', { followed_id: id, platform })
      else await del(`/api/platform-follows/${id}/${platform}`)
    } catch {
      setDone((prev) => ({ ...prev, [platform]: !on }))
      showToast(t('couldntSave'))
    }
  }

  const launch = (row) => {
    if (!row) return
    setCurrent(row.platform)
    setConfirm(null)
    awaitingRef.current = row.platform
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {})
    openPlatform(row).then((ok) => { if (!ok) awaitingRef.current = null })
  }

  const markFollowed = (platform) => {
    setConfirm(null)
    const nextDone = { ...done, [platform]: true }
    savePlatform(platform, true)
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {})
    setCurrent(firstPending(nextDone, skipped, platform)?.platform ?? null)
    showToast(t('marked', { platform: label(platform) }), () => {
      savePlatform(platform, false)
      setCurrent(platform)
      setToast(null)
    })
  }

  const toggleRow = (row) => {
    if (done[row.platform]) {
      savePlatform(row.platform, false)
      showToast(t('unmarked', { platform: row.label }), () => { savePlatform(row.platform, true); setToast(null) })
    } else {
      markFollowed(row.platform)
    }
  }

  const skip = (row) => {
    const nextSkip = { ...skipped, [row.platform]: true }
    setSkipped(nextSkip)
    setConfirm(null)
    setCurrent(firstPending(done, nextSkip, row.platform)?.platform ?? null)
  }

  const toggleIyiyi = () => {
    if (!id) return
    if (iyiyiActive) {
      Alert.alert(t('iyiyiUnfollow'), name ? `@${name}` : undefined, [
        { text: t('close'), style: 'cancel' },
        {
          text: t('iyiyiUnfollow'),
          style: 'destructive',
          onPress: async () => {
            const was = known
            setLocalStatus(null)
            try {
              await del(`/api/profiles/follow/${id}`)
              onIyiyiStatus?.(id, null)
            } catch {
              setLocalStatus(was)
              showToast(t('couldntSave'))
            }
          },
        },
      ])
      return
    }
    setLocalStatus('accepted')
    followOnIyiyi(id)
      .then((s) => { followedRef.current = true; setLocalStatus(s); onIyiyiStatus?.(id, s) })
      .catch(() => { setLocalStatus(null); showToast(t('couldntFollow')) })
  }

  const close = () => {
    awaitingRef.current = null
    onClose?.()
    // The "turn on notifications?" offer comes after a first follow - once the sheet is gone.
    if (followedRef.current) setTimeout(() => { maybeOfferPushAfterFollow() }, 400)
  }

  const total = rows.length + 1
  const doneCount = rows.filter((r) => done[r.platform]).length + (iyiyiActive ? 1 : 0)
  // (A pending request with nothing else to follow isn't "done": the note below explains.)
  const allDone = !linksLoading && iyiyiActive && rows.every((r) => done[r.platform]) && !(rows.length === 0 && known === 'pending')
  const left = total - doneCount
  // Attribution: one 'follow_everywhere' event per completed sheet (for ad optimisation).
  const loggedDone = useRef(false)
  useEffect(() => {
    if (allDone && !loggedDone.current) {
      loggedDone.current = true
      logFollowEverywhere(total)
    }
  }, [allDone, total])
  const confirmRow = confirm ? rows.find((r) => r.platform === confirm) : null
  const subtitle = distanceLabel
    ? t('subtitleDist', { dist: distanceLabel, n: total })
    : t('subtitle', { n: total })

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={close}>
      <View style={styles.screen}>
        <View style={styles.header}>
          <Avatar uri={merged?.avatar_url} name={name} size={44} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.title} numberOfLines={2}>{t('title', { name })}</Text>
            <Text style={type.caption} numberOfLines={1}>{linksLoading ? t('loading') : subtitle}</Text>
          </View>
          <Pressable onPress={close} hitSlop={12} accessibilityRole="button" accessibilityLabel={t('done')} style={styles.doneBtn}>
            <Text style={styles.doneText}>{t('done')}</Text>
          </Pressable>
        </View>

        {!linksLoading && rows.length > 0 ? (
          <View style={styles.progressWrap} accessible accessibilityRole="progressbar" accessibilityLabel={t('progressA11y', { done: doneCount, total })}>
            <View style={styles.progressTrack}>
              <View style={[styles.progressFill, { width: `${Math.round((doneCount / total) * 100)}%` }]} />
            </View>
            <Text style={styles.progressText}>{doneCount}/{total}</Text>
          </View>
        ) : null}

        <ScrollView contentContainerStyle={{ paddingBottom: 120 }}>
          {linksLoading ? (
            <ActivityIndicator style={{ marginTop: 40 }} color={colors.accent} />
          ) : allDone ? (
            <FinishCard
              t={t}
              name={name}
              total={total}
              hasOthers={rows.length > 0}
              nextPerson={nextPerson}
              onNextPerson={onNextPerson}
              onDone={close}
            />
          ) : confirmRow ? (
            <View style={styles.stepCard}>
              <View style={styles.stepIcon}><SocialIcon platform={confirmRow.platform} size={30} color={colors.text} /></View>
              <Text style={styles.stepTitle}>{t('backFrom', { platform: confirmRow.label })}</Text>
              <View style={styles.confirmRow}>
                <Pressable
                  onPress={() => markFollowed(confirmRow.platform)}
                  style={({ pressed }) => [styles.primary, { flex: 1 }, pressed && styles.pressed]}
                  accessibilityRole="button"
                  accessibilityLabel={`${t('yes')}, ${confirmRow.label}`}
                >
                  <Ionicons name="checkmark" size={18} color={colors.onBrand} />
                  <Text style={styles.primaryText}>{t('yes')}</Text>
                </Pressable>
                <Pressable
                  onPress={() => { setRetry(confirmRow.platform); setConfirm(null) }}
                  style={({ pressed }) => [styles.secondary, { flex: 1 }, pressed && styles.pressed]}
                  accessibilityRole="button"
                  accessibilityLabel={`${t('notYet')}, ${confirmRow.label}`}
                >
                  <Text style={styles.secondaryText}>{t('notYet')}</Text>
                </Pressable>
              </View>
            </View>
          ) : active ? (
            <View style={styles.stepCard}>
              <View style={styles.stepIcon}><SocialIcon platform={active.platform} size={30} color={colors.text} /></View>
              <Pressable
                onPress={() => launch(active)}
                style={({ pressed }) => [styles.primary, styles.primaryWide, pressed && styles.pressed]}
                accessibilityRole="button"
                accessibilityLabel={t('rowOpenA11y', { name, platform: active.label })}
              >
                <Text style={styles.primaryText}>
                  {retry === active.platform ? t('openAgain', { platform: active.label }) : t('openApp', { platform: active.label })}
                </Text>
                <Ionicons name="open-outline" size={16} color={colors.onBrand} />
              </Pressable>
              <Text style={styles.stepHelp}>{t('openHelp', { platform: active.label, handle: active.handle ? `@${active.handle}` : active.value })}</Text>
              {rows.filter((r) => !done[r.platform]).length > 1 ? (
                <Pressable onPress={() => skip(active)} hitSlop={8} style={styles.skip} accessibilityRole="button" accessibilityLabel={t('skip', { platform: active.label })}>
                  <Text style={styles.skipText}>{t('skip', { platform: active.label })}</Text>
                </Pressable>
              ) : null}
            </View>
          ) : rows.length === 0 ? (
            <View style={styles.stepCard}>
              <Text style={[type.caption, { textAlign: 'center' }]}>
                {known === 'pending' ? t('pendingNote', { name }) : t('noOthers', { name })}
              </Text>
            </View>
          ) : null}

          {/* Every platform with its status; tap a row to open it, the circle to tick it. */}
          {!linksLoading ? (
            <View style={styles.list}>
              <View style={styles.row}>
                <View style={styles.iconWrap}><Text style={styles.iyiyiMark}>iY</Text></View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={type.body}>iYiYi</Text>
                  <Text style={type.caption} numberOfLines={1}>
                    {known === 'pending' ? t('statusRequested') : iyiyiActive ? (autoFollowed ? t('iyiyiAuto') : t('statusFollowing')) : t('statusNotYet')}
                  </Text>
                </View>
                <CheckCircle
                  on={iyiyiActive}
                  pending={known === 'pending'}
                  onPress={toggleIyiyi}
                  label={iyiyiActive ? t('iyiyiUnfollow') : t('iyiyiFollow')}
                />
              </View>
              {rows.map((r) => {
                const isDone = !!done[r.platform]
                const status = isDone ? t('statusFollowing') : skipped[r.platform] ? t('statusSkipped') : t('statusNotYet')
                return (
                  <View key={r.key} style={styles.row}>
                    <Pressable
                      onPress={() => launch(r)}
                      style={({ pressed }) => [styles.rowMain, pressed && { opacity: 0.6 }]}
                      accessibilityRole="button"
                      accessibilityLabel={t('rowOpenA11y', { name, platform: r.label })}
                      accessibilityHint={status}
                    >
                      <View style={styles.iconWrap}><SocialIcon platform={r.platform} size={22} color={colors.text} /></View>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={type.body}>{r.label}</Text>
                        <Text style={type.caption} numberOfLines={1}>{r.handle ? `@${r.handle}` : r.value} · {status}</Text>
                      </View>
                    </Pressable>
                    <CheckCircle
                      on={isDone}
                      onPress={() => toggleRow(r)}
                      label={isDone ? t('unmarkA11y', { platform: r.label }) : t('markA11y', { platform: r.label })}
                    />
                  </View>
                )
              })}
              {!allDone && left > 0 && rows.length > 0 ? <Text style={styles.leftText}>{t('remaining', { n: left })}</Text> : null}
            </View>
          ) : null}
        </ScrollView>

        {toast ? (
          <View style={styles.toast} accessibilityLiveRegion="polite">
            <Text style={styles.toastText} numberOfLines={2}>{toast.text}</Text>
            {toast.undo ? (
              <Pressable onPress={toast.undo} hitSlop={10} accessibilityRole="button" accessibilityLabel={t('undo')} style={styles.toastBtn}>
                <Text style={styles.toastUndo}>{t('undo')}</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}
      </View>
    </Modal>
  )
}

function CheckCircle({ on, pending, onPress, label }) {
  return (
    <Pressable
      onPress={onPress}
      style={styles.checkHit}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: !!on }}
      accessibilityLabel={label}
    >
      <View style={[styles.check, on && styles.checkOn, pending && styles.checkPending]}>
        {on ? <Ionicons name={pending ? 'time-outline' : 'checkmark'} size={16} color="#fff" /> : null}
      </View>
    </Pressable>
  )
}

function FinishCard({ t, name, total, hasOthers, nextPerson, onNextPerson, onDone }) {
  const nextName = nextPerson?.username
  const nextCount = platformsOf(nextPerson)
  return (
    <View style={styles.finish}>
      <View style={styles.finishBadge}><Ionicons name="checkmark" size={34} color="#fff" /></View>
      <Text style={styles.finishTitle}>{hasOthers ? t('allDone', { name, n: total }) : t('allDoneOne', { name })}</Text>
      {!hasOthers ? <Text style={[type.caption, { textAlign: 'center', marginTop: 4 }]}>{t('noOthers', { name })}</Text> : null}
      {nextPerson && onNextPerson ? (
        <Pressable
          onPress={() => onNextPerson(nextPerson)}
          style={({ pressed }) => [styles.nextCard, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel={t('nextNearby', { name: nextName ?? '' })}
        >
          <Avatar uri={nextPerson.avatar_url} name={nextName} size={36} />
          <Text style={[type.body, { flex: 1, ...font.semibold }]} numberOfLines={1}>
            {t('nextNearby', { name: nextName ?? '' })}{nextCount && nextCount.length ? ` ×${nextCount.length + 1}` : ''}
          </Text>
          <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
        </Pressable>
      ) : null}
      <Pressable onPress={onDone} style={({ pressed }) => [styles.secondary, styles.primaryWide, { marginTop: 14 }, pressed && styles.pressed]} accessibilityRole="button" accessibilityLabel={t('done')}>
        <Text style={styles.secondaryText}>{t('done')}</Text>
      </Pressable>
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.ink },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingTop: 22, paddingBottom: 12, gap: 12 },
  title: { ...type.headline, fontSize: 19, lineHeight: 24 },
  doneBtn: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 4 },
  doneText: { color: colors.accent, ...font.bold, fontSize: 16 },
  progressWrap: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 20, paddingBottom: 6 },
  progressTrack: { flex: 1, height: 6, borderRadius: 3, backgroundColor: colors.hairline, overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: 3, backgroundColor: colors.success },
  progressText: { ...type.caption, color: colors.textMuted, ...font.semibold, fontVariant: ['tabular-nums'] },
  stepCard: {
    marginHorizontal: 16, marginTop: 12, padding: 18, borderRadius: radii.lg, alignItems: 'center', gap: 12,
    backgroundColor: colors.inkSurfaceRaised, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.hairline,
  },
  stepIcon: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.glassFill },
  stepTitle: { ...type.headline, textAlign: 'center' },
  stepHelp: { ...type.caption, textAlign: 'center' },
  confirmRow: { flexDirection: 'row', gap: 10, alignSelf: 'stretch' },
  primary: {
    minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    paddingHorizontal: 20, borderRadius: radii.pill, backgroundColor: colors.magenta,
  },
  primaryWide: { alignSelf: 'stretch' },
  primaryText: { color: colors.onBrand, ...font.bold, fontSize: 16 },
  secondary: {
    minHeight: 48, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20, borderRadius: radii.pill,
    borderWidth: 1, borderColor: colors.hairline, backgroundColor: colors.glassFill,
  },
  secondaryText: { color: colors.text, ...font.semibold, fontSize: 16 },
  pressed: { opacity: 0.75, transform: [{ scale: 0.98 }] },
  skip: { minHeight: 44, justifyContent: 'center' },
  skipText: { color: colors.textMuted, ...font.semibold, fontSize: 14 },
  list: { marginTop: 18 },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: 20, paddingRight: 10, minHeight: 60,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.hairline,
  },
  rowMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
  iconWrap: { width: 32, alignItems: 'center' },
  iyiyiMark: { color: colors.accent, ...font.heavy, fontSize: 18 },
  checkHit: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  check: {
    width: 28, height: 28, borderRadius: 14, borderWidth: 1.5, borderColor: colors.textFaint,
    alignItems: 'center', justifyContent: 'center',
  },
  checkOn: { backgroundColor: colors.success, borderColor: colors.success },
  checkPending: { backgroundColor: colors.gold, borderColor: colors.gold },
  leftText: { ...type.caption, textAlign: 'center', marginTop: 14 },
  finish: { alignItems: 'center', paddingHorizontal: 24, paddingTop: 28 },
  finishBadge: { width: 72, height: 72, borderRadius: 36, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.success },
  finishTitle: { ...type.title, textAlign: 'center', marginTop: 16 },
  nextCard: {
    marginTop: 22, alignSelf: 'stretch', flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, minHeight: 56,
    borderRadius: radii.lg, backgroundColor: colors.inkSurfaceRaised, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.hairline,
  },
  toast: {
    position: 'absolute', left: 16, right: 16, bottom: 34, flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingLeft: 16, paddingRight: 8, minHeight: 48, borderRadius: radii.md, backgroundColor: colors.inkSurfaceRaised,
    borderWidth: StyleSheet.hairlineWidth, borderColor: colors.hairline,
    shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 12, shadowOffset: { width: 0, height: 6 }, elevation: 6,
  },
  toastText: { flex: 1, color: colors.text, fontSize: 14, ...font.medium },
  toastBtn: { minHeight: 44, minWidth: 44, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8 },
  toastUndo: { color: colors.accent, ...font.bold, fontSize: 15 },
})
