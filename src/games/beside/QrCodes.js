// Host view of the QR marker stations: one big code at a time (show it on your phone, or
// tape the printout up) plus Print / Share PDF of all codes, one per page half.
import React, { useMemo, useState } from 'react'
import { Alert, Modal, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import Svg, { Path, Rect } from 'react-native-svg'
import { ST, StButton, stType } from '../studio'
import { encodeQr, qrSvgPath, qrSvgString } from './qr'
import { qrPayload } from './engine'
import { pad2 } from './terminal'
import { Toy } from './toys'
import { useT } from '../../i18n'
import B from '../../i18n/strings/besideThem'
import { bt, stationName } from './text'

/** A station's QR code, black on white with a quiet zone. */
export function QrImage({ station, size = 220 }) {
  const t = useT(B)
  const qr = useMemo(() => { try { return encodeQr(qrPayload(station)) } catch { return null } }, [station])
  if (!qr) return null
  const n = qr.size + 8
  return (
    <Svg width={size} height={size} viewBox={`0 0 ${n} ${n}`} accessibilityLabel={t('qr_for', { name: stationName(station) })}>
      <Rect x={0} y={0} width={n} height={n} fill="#ffffff" />
      <Path d={qrSvgPath(qr, 4)} fill="#000000" />
    </Svg>
  )
}

const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))

export function qrPrintHtml(stations) {
  const cards = stations.map((st, i) => {
    let svg = ''
    try { svg = qrSvgString(encodeQr(qrPayload(st)), 300) } catch { svg = '' }
    return `<div class="card"><div class="no">${esc(bt('station_no', { n: pad2(st.no || i + 1) }))}</div>${svg}<div class="name">${esc(stationName(st))}</div><div class="hint">${esc(bt('print_hint'))}</div></div>`
  }).join('')
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    @page { margin: 12mm; }
    body { font-family: -apple-system, Roboto, Helvetica, Arial, sans-serif; margin: 0; }
    .card { page-break-inside: avoid; break-inside: avoid; text-align: center; border: 2px dashed #999; border-radius: 10px; padding: 14px; margin: 0 auto 14mm; width: 92mm; }
    .no { font-weight: 800; letter-spacing: 3px; font-size: 14px; }
    .name { font-weight: 800; font-size: 22px; margin-top: 6px; }
    .hint { color: #555; font-size: 11px; margin-top: 4px; }
    svg { display: block; margin: 8px auto 0; width: 70mm; height: 70mm; }
  </style></head><body>${cards}</body></html>`
}

export function QrCodesSheet({ visible, onClose, stations }) {
  const t = useT(B)
  const { width } = useWindowDimensions()
  const [i, setI] = useState(0)
  const [busy, setBusy] = useState(false)
  const list = stations || []
  const idx = Math.min(i, Math.max(0, list.length - 1))
  const st = list[idx]
  const size = Math.min(320, width - 64)

  const print = async (share) => {
    if (busy || !list.length) return
    setBusy(true)
    try {
      const Print = await import('expo-print')
      const html = qrPrintHtml(list)
      if (share) {
        const { uri } = await Print.printToFileAsync({ html })
        const Sharing = await import('expo-sharing')
        await Sharing.shareAsync(uri, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf', dialogTitle: t('codes_dialog') })
      } else {
        await Print.printAsync({ html })
      }
    } catch (e) {
      if (!/cancel/i.test(String(e?.message || ''))) Alert.alert(t('print_failed'), e?.message || t('try_share_pdf'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="fullScreen" onRequestClose={onClose}>
      <SafeAreaView style={styles.fill} edges={['top', 'bottom']}>
        <ScrollView contentContainerStyle={{ padding: 16, alignItems: 'center' }}>
          <Text style={[stType.kicker, { alignSelf: 'flex-start' }]}>{t('station_codes')} · {list.length}</Text>
          <Text style={[stType.small, { alignSelf: 'flex-start', marginBottom: 14 }]}>
            {t('codes_intro')}
          </Text>
          {st ? (
            <View style={styles.card}>
              <View style={styles.cardHead}>
                {st.toy ? <Toy kind={st.toy} size={34} /> : null}
                <View style={{ marginLeft: 8, flex: 1 }}>
                  <Text style={styles.cardNo}>{t('station_no', { n: pad2(st.no || idx + 1) })}</Text>
                  <Text style={styles.cardName} numberOfLines={1}>{stationName(st)}</Text>
                </View>
              </View>
              <QrImage station={st} size={size} />
            </View>
          ) : null}
          <View style={styles.pager}>
            <Pressable onPress={() => setI(Math.max(0, idx - 1))} disabled={idx === 0} hitSlop={10} accessibilityRole="button" accessibilityLabel={t('prev_code')} style={{ opacity: idx === 0 ? 0.3 : 1 }}>
              <Ionicons name="chevron-back" size={28} color={ST.text} />
            </Pressable>
            <Text style={[stType.label, { minWidth: 70, textAlign: 'center' }]}>{list.length ? `${idx + 1} / ${list.length}` : '—'}</Text>
            <Pressable onPress={() => setI(Math.min(list.length - 1, idx + 1))} disabled={idx >= list.length - 1} hitSlop={10} accessibilityRole="button" accessibilityLabel={t('next_code')} style={{ opacity: idx >= list.length - 1 ? 0.3 : 1 }}>
              <Ionicons name="chevron-forward" size={28} color={ST.text} />
            </Pressable>
          </View>
        </ScrollView>
        <View style={styles.foot}>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <StButton title={busy ? t('working') : t('print')} tone="objective" disabled={busy || !list.length} onPress={() => print(false)} left={<Ionicons name="print-outline" size={18} color={ST.ink} />} style={{ flex: 1 }} />
            <StButton title={t('share_pdf')} tone="outline" disabled={busy || !list.length} onPress={() => print(true)} left={<Ionicons name="share-outline" size={18} color={ST.friendly} />} style={{ flex: 1 }} />
          </View>
          <StButton title={t('done')} tone="ghost" onPress={onClose} style={{ marginTop: 10 }} />
        </View>
      </SafeAreaView>
    </Modal>
  )
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: ST.ground },
  card: { backgroundColor: '#ffffff', borderRadius: 10, padding: 14, alignItems: 'center' },
  cardHead: { flexDirection: 'row', alignItems: 'center', alignSelf: 'stretch', marginBottom: 8 },
  cardNo: { ...stType.label, color: '#333', letterSpacing: 2 },
  cardName: { ...stType.name, color: '#111', fontSize: 20 },
  pager: { flexDirection: 'row', alignItems: 'center', gap: 18, marginTop: 14 },
  foot: { padding: 16, borderTopWidth: 1, borderTopColor: ST.line },
})
