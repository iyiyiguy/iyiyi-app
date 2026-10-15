import { useRef, useState } from 'react'
import { View, Text, Pressable, Modal, ScrollView, StyleSheet, useWindowDimensions } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import * as Haptics from 'expo-haptics'
import { colors, font, radii, type } from '../theme'
import { TAGS } from '../lib/tags'
import GlassPanel from './GlassPanel'
import { GlassButton } from './GlassButton'
import { useT } from '../i18n'
import strings from '../i18n/strings/social'

// "Tags" pill button that opens a grid of tag tiles (multi-select, X to close) with
// Clear / Apply. The selection only takes effect when Apply is tapped; closing the
// dropdown any other way discards the draft. A count badge shows how many filters are on.
//
// Usage (reusable, e.g. on Map):
//   import TagDropdown from '../components/TagDropdown'
//   import { matchesTags } from '../lib/tags'
//   const [tags, setTags] = useState([])
//   <TagDropdown selected={tags} onApply={setTags} />
//   users.filter((u) => matchesTags(u, tags))
//
// Props:
//   selected   string[]               currently applied tags (default [])
//   onApply    (tags: string[]) => void  called with the new selection on Apply / Clear-all
//   tags       string[]               options (default: TAGS from lib/tags)
//   label      string                 button text (default 'Tags')
//   title      string                 dropdown heading (default 'Filter by tags')
//   style      ViewStyle              style for the trigger wrapper
//   disabled   boolean
//   compact    boolean                tighter trigger, no chevron (fits a one-line filter row)
//   noIcon     boolean                hide the tag icon on the trigger (very narrow rows)
export default function TagDropdown({
  selected = [],
  onApply,
  tags = TAGS,
  label: labelProp,
  title: titleProp,
  style,
  disabled = false,
  compact = false,
  noIcon = false,
}) {
  const t = useT(strings)
  const label = labelProp ?? t('tags')
  const title = titleProp ?? t('filterByTags')
  const triggerRef = useRef(null)
  const [open, setOpen] = useState(false)
  const [anchor, setAnchor] = useState(null)
  const [draft, setDraft] = useState([])
  const { width: screenW, height: screenH } = useWindowDimensions()
  const applied = Array.isArray(selected) ? selected : []
  const count = applied.length

  const show = () => {
    Haptics.selectionAsync().catch(() => {})
    setDraft(applied)
    const node = triggerRef.current
    if (node?.measureInWindow) {
      node.measureInWindow((x, y, w, h) => {
        setAnchor(Number.isFinite(y) ? { x, y, w, h } : null)
        setOpen(true)
      })
    } else {
      setAnchor(null)
      setOpen(true)
    }
  }

  const close = () => setOpen(false)

  const toggle = (tag) => {
    Haptics.selectionAsync().catch(() => {})
    setDraft((d) => (d.includes(tag) ? d.filter((x) => x !== tag) : [...d, tag]))
  }

  const apply = () => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {})
    // Keep the canonical order of the option list.
    onApply?.(tags.filter((x) => draft.includes(x)))
    setOpen(false)
  }

  // Panel geometry: drop down under the button when there's room, otherwise center.
  const panelW = Math.min(360, screenW - 32)
  // Tag grid: 3 columns on most phones, 2 on very narrow ones.
  const cols = panelW >= 330 ? 3 : 2
  const GRID_PAD = 12
  const GAP = 8
  const cellW = Math.floor((panelW - GRID_PAD * 2 - GAP * (cols - 1)) / cols)
  let panelPos
  if (anchor && screenH - (anchor.y + anchor.h + 8) > 300) {
    const top = anchor.y + anchor.h + 8
    const left = Math.min(Math.max(16, anchor.x), screenW - panelW - 16)
    panelPos = { top, left, maxHeight: Math.min(460, screenH - top - 32) }
  } else {
    panelPos = { top: Math.max(60, screenH * 0.14), left: (screenW - panelW) / 2, maxHeight: screenH * 0.7 }
  }

  return (
    <>
      <Pressable
        ref={triggerRef}
        onPress={show}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel={count ? t('labelSelectedA11y', { label, n: count }) : label}
        accessibilityState={{ disabled }}
        style={({ pressed }) => [style, { opacity: disabled ? 0.5 : 1 }, pressed && { transform: [{ scale: 0.96 }] }]}
      >
        {count > 0 ? (
          <View style={[styles.trigger, compact && styles.triggerCompact, styles.triggerActive]}>
            {noIcon ? null : <Ionicons name="pricetags" size={15} color={colors.ink} />}
            <Text style={[styles.triggerText, { color: colors.ink }]}>{label}</Text>
            <View style={styles.badge}><Text style={styles.badgeText}>{count}</Text></View>
          </View>
        ) : (
          <GlassPanel radius={radii.pill} animateIn={false}>
            <View style={[styles.trigger, compact && styles.triggerCompact]}>
              {noIcon ? null : <Ionicons name="pricetags-outline" size={15} color={colors.text} />}
              <Text style={styles.triggerText} numberOfLines={1}>{label}</Text>
              {compact ? null : <Ionicons name="chevron-down" size={13} color={colors.textMuted} />}
            </View>
          </GlassPanel>
        )}
      </Pressable>

      <Modal visible={open} transparent animationType="fade" onRequestClose={close} statusBarTranslucent>
        <Pressable style={styles.backdrop} onPress={close} accessibilityRole="button" accessibilityLabel={t('closeTags')} />
        <View style={[styles.panel, { width: panelW, top: panelPos.top, left: panelPos.left, maxHeight: panelPos.maxHeight }]}>
          <View style={styles.header}>
            <View style={{ flex: 1 }}>
              <Text style={type.headline}>{title}</Text>
              <Text style={type.caption}>{draft.length ? t('nSelected', { n: draft.length }) : t('any')}</Text>
            </View>
            <Pressable onPress={close} hitSlop={10} style={styles.closeBtn} accessibilityRole="button" accessibilityLabel={t('close')}>
              <Ionicons name="close" size={18} color={colors.text} />
            </Pressable>
          </View>
          {/* Apply / Clear sit at the top, right under the button that opened the menu. */}
          <View style={styles.footer}>
            <GlassButton size="sm" variant="glass" onPress={() => setDraft([])} disabled={draft.length === 0} style={{ flex: 1 }}>
              {t('clear')}
            </GlassButton>
            <GlassButton size="sm" variant="primary" onPress={apply} style={{ flex: 1 }}>
              {draft.length ? t('applyN', { n: draft.length }) : t('apply')}
            </GlassButton>
          </View>
          <ScrollView style={styles.list} contentContainerStyle={styles.grid} showsVerticalScrollIndicator>
            {tags.map((tag) => {
              const on = draft.includes(tag)
              return (
                <Pressable
                  key={tag}
                  onPress={() => toggle(tag)}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: on }}
                  style={({ pressed }) => [
                    styles.cell, { width: cellW }, on && styles.cellOn, pressed && { transform: [{ scale: 0.95 }] },
                  ]}
                >
                  {on ? <Ionicons name="checkmark-circle" size={15} color={colors.ink} /> : null}
                  <Text style={[styles.cellText, on && styles.cellTextOn]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75}>{tag}</Text>
                </Pressable>
              )
            })}
          </ScrollView>
        </View>
      </Modal>
    </>
  )
}

const styles = StyleSheet.create({
  trigger: { height: 36, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, borderRadius: radii.pill },
  triggerCompact: { paddingHorizontal: 10, gap: 4 },
  triggerActive: { backgroundColor: colors.text },
  triggerText: { fontSize: 14, ...font.semibold, color: colors.text },
  badge: {
    minWidth: 20, height: 20, borderRadius: 10, paddingHorizontal: 5, backgroundColor: colors.magenta,
    alignItems: 'center', justifyContent: 'center',
  },
  badgeText: { color: '#fff', fontSize: 12, ...font.bold },
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.28)' },
  panel: {
    position: 'absolute', borderRadius: radii.lg, backgroundColor: colors.inkSurface, overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth, borderColor: colors.hairline,
    shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 24, shadowOffset: { width: 0, height: 12 }, elevation: 12,
  },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 18, paddingTop: 14, paddingBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.hairline,
  },
  closeBtn: {
    width: 32, height: 32, borderRadius: 16, marginLeft: 12, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.hairline,
  },
  list: { flexGrow: 0, flexShrink: 1 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, padding: 12 },
  cell: {
    height: 42, borderRadius: radii.md ?? 12, paddingHorizontal: 8,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4,
    borderWidth: 1, borderColor: colors.hairline, backgroundColor: 'rgba(255,255,255,0.05)',
  },
  cellOn: { backgroundColor: colors.text, borderColor: colors.text },
  cellText: { fontSize: 14, ...font.medium, color: colors.text, flexShrink: 1, textAlign: 'center' },
  cellTextOn: { color: colors.ink, ...font.semibold },
  footer: {
    flexDirection: 'row', gap: 10, paddingHorizontal: 12, paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.hairline,
  },
})
