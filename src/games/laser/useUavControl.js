// Shared UAV logic for every shooter (Laser Tag modes + Battle Royale).
//
//   • 1 free UAV per match + the purchased balance; the owner account is unlimited.
//   • A UAV lasts UAV_DURATION_MS and can't be stacked (calling is disabled while active).
//   • Calling one broadcasts 'lt_uav' { ms, ...payload() } so the room knows. Receivers
//     classify the sender with `classify(fromId, data)` → 'enemy' | 'team' | null.
//   • At 0 UAVs the call opens the purchase sheet instead (also outside of live play).
import { useCallback, useEffect, useRef, useState } from 'react'
import { buzz } from '../../lib/gamePrefs'
import { playSfx } from '../../lib/gunAudio'
import { FREE_UAVS_PER_MATCH, UAV_DURATION_MS, spendPurchasedUav, useUavInventory } from '../../lib/uav'

export function useUavControl({ room, matchKey, canUse, classify, alert, payload, onBeforeCall, teamLabel = 'A teammate' }) {
  const inv = useUavInventory()
  const [freeUsed, setFreeUsed] = useState(0)
  const [myUntil, setMyUntil] = useState(0)
  const [teamUntil, setTeamUntil] = useState(0)
  const [enemyUntil, setEnemyUntil] = useState(0)
  const [sheetOpen, setSheetOpen] = useState(false)
  const busy = useRef(false)
  const ctx = useRef({})
  ctx.current = { classify, alert, payload, onBeforeCall, teamLabel }

  useEffect(() => {
    setFreeUsed(0)
    setMyUntil(0)
    setTeamUntil(0)
    setEnemyUntil(0)
    setSheetOpen(false)
  }, [matchKey])

  useEffect(() => {
    if (!room) return undefined
    return room.onMessage('lt_uav', (d, from) => {
      try {
        const c = ctx.current
        const kind = c.classify?.(from, d)
        if (!kind) return
        const ms = Math.max(1000, Math.min(UAV_DURATION_MS, Number(d?.ms) || UAV_DURATION_MS))
        const until = Date.now() + ms
        if (kind === 'enemy') {
          setEnemyUntil(until)
          buzz('warning')
          c.alert?.({ title: 'Enemy UAV overhead', sub: 'They can see you on their map — keep moving', color: '#d4202f' }, 3000)
        } else if (kind === 'team') {
          setTeamUntil(until)
          c.alert?.({ title: `UAV online — ${Math.round(ms / 1000)}s`, sub: `${d?.name || c.teamLabel} called in a UAV`, color: '#1f7a9d' }, 3000)
        }
      } catch {
        // Ignore malformed messages.
      }
    })
  }, [room])

  const t = Date.now()
  const myMs = Math.max(0, myUntil - t)
  const uavActive = myMs > 0 || teamUntil > t
  const enemyMs = Math.max(0, enemyUntil - t)
  const freeLeft = Math.max(0, FREE_UAVS_PER_MATCH - freeUsed)
  const empty = !inv.owner && freeLeft <= 0 && inv.balance <= 0
  const count = inv.owner ? '∞' : freeLeft + inv.balance

  const callUav = useCallback(async () => {
    if (busy.current || myUntil > Date.now()) return
    try { ctx.current.onBeforeCall?.() } catch {}
    if (empty) { buzz('select'); setSheetOpen(true); return }
    if (!canUse) return
    busy.current = true
    try {
      if (!inv.owner) {
        if (freeLeft > 0) setFreeUsed((n) => n + 1)
        else if (!(await spendPurchasedUav())) { setSheetOpen(true); return }
      }
      setMyUntil(Date.now() + UAV_DURATION_MS)
      let extra = {}
      try { extra = ctx.current.payload?.() || {} } catch { extra = {} }
      try { room?.send('lt_uav', { ...extra, ms: UAV_DURATION_MS }) } catch {}
      playSfx('beep')
      buzz('success')
      ctx.current.alert?.({ title: `UAV online — ${Math.round(UAV_DURATION_MS / 1000)}s`, sub: 'Enemies are on your map', color: '#1f7a9d' }, 3000)
    } finally {
      busy.current = false
    }
  }, [myUntil, empty, canUse, inv.owner, freeLeft, room])

  return { inv, count, freeLeft, myMs, uavActive, enemyMs, empty, callUav, sheetOpen, setSheetOpen }
}
