// A post's description under it (feed card / viewer). #hashtags and @mentions are highlighted;
// long captions show 2 lines with "more". The caption comes with the item, or from mediaMeta for
// posts loaded through the API (which doesn't return the newer columns).
import { useState } from 'react'
import { Text, StyleSheet } from 'react-native'
import { useMediaMeta } from '../lib/mediaMeta'
import { useT } from '../i18n'
import strings from '../i18n/strings/editor'

export function captionParts(text) {
  return String(text || '').split(/([#@][^\s#@.,!?;:()"']+)/).filter(Boolean)
}

export default function PostCaption({ item, color = '#f2f4f7', accent = '#ffb21e', lines = 2, style }) {
  const t = useT(strings)
  const metaId = !item?.caption && item?.kind !== 'youtube' && /^\d+$/.test(String(item?.id ?? '')) ? item.id : null
  const meta = useMediaMeta(metaId)
  const text = item?.caption || meta?.caption || ''
  const [open, setOpen] = useState(false)
  if (!text) return null
  const long = text.length > 90 || text.split('\n').length > lines
  return (
    <Text
      style={[st.text, { color }, style]}
      numberOfLines={open ? undefined : lines}
      onPress={long ? () => setOpen((o) => !o) : undefined}
      accessibilityHint={long ? (open ? t('showLess') : t('showMore')) : undefined}
    >
      {captionParts(text).map((p, i) => (/^[#@]/.test(p) ? <Text key={i} style={[st.tag, { color: accent }]}>{p}</Text> : p))}
    </Text>
  )
}

const st = StyleSheet.create({
  text: { fontSize: 14, lineHeight: 19 },
  tag: { fontWeight: '700' },
})
