// Follow status for players met inside games (scoreboards, kill feed, results, the player
// sheet). One small in-memory cache so every Follow button for the same person agrees, and
// a toggle in one place updates the rest. Status: 'accepted' | 'pending' | null.
import { useEffect, useState } from 'react'
import { apiJson, post, del } from './api'

const status = new Map() // userId -> 'accepted' | 'pending' | null
const profiles = new Map() // userId -> profile json
const inflight = new Map()
const subs = new Set()
const emit = () => subs.forEach((fn) => fn())

export function loadProfile(userId) {
  if (!userId) return Promise.resolve(null)
  if (profiles.has(userId)) return Promise.resolve(profiles.get(userId))
  if (inflight.has(userId)) return inflight.get(userId)
  const p = apiJson(`/api/profiles/${userId}`)
    .then((json) => {
      profiles.set(userId, json)
      if (!status.has(userId)) status.set(userId, json?.is_following ? 'accepted' : json?.follow_status ?? null)
      emit()
      return json
    })
    .catch(() => null)
    .finally(() => inflight.delete(userId))
  inflight.set(userId, p)
  return p
}

export function getFollowStatus(userId) {
  return status.get(userId) ?? null
}

export async function toggleFollow(userId) {
  if (!userId) return null
  const was = status.get(userId) ?? null
  const active = was === 'accepted' || was === 'pending'
  status.set(userId, active ? null : 'accepted') // optimistic
  emit()
  try {
    if (active) {
      await del(`/api/profiles/follow/${userId}`)
      status.set(userId, null)
    } else {
      const res = await post(`/api/profiles/follow/${userId}`)
      status.set(userId, res?.status ?? 'accepted')
    }
  } catch {
    status.set(userId, was)
  }
  const prof = profiles.get(userId)
  if (prof) {
    const now = status.get(userId)
    const delta = (now === 'accepted' ? 1 : 0) - (was === 'accepted' ? 1 : 0)
    profiles.set(userId, { ...prof, is_following: now === 'accepted', follow_status: now, follower_count: Math.max(0, (prof.follower_count ?? 0) + delta) })
  }
  emit()
  return status.get(userId)
}

/** Live follow status + cached profile for one player. Loads the profile on first use. */
export function useFollow(userId) {
  const [, force] = useState(0)
  useEffect(() => {
    const fn = () => force((n) => n + 1)
    subs.add(fn)
    if (userId) loadProfile(userId)
    return () => { subs.delete(fn) }
  }, [userId])
  return {
    status: userId ? status.get(userId) ?? null : null,
    profile: userId ? profiles.get(userId) ?? null : null,
    loaded: userId ? profiles.has(userId) : false,
    toggle: () => toggleFollow(userId),
  }
}
