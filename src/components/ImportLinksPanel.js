import { useState } from 'react'
import { View, Text, TextInput, Pressable, StyleSheet, ActivityIndicator, ScrollView } from 'react-native'
import { LinearGradient } from 'expo-linear-gradient'
import { colors, gradients, radii, type } from '../theme'
import { fetchImportedLinks } from '../lib/importLinks'
import { PLATFORM_LABELS } from '../lib/socialLinks'
import SocialIcon from './SocialIcon'
import GlassPanel from './GlassPanel'

// Paste a Linktree (or Beacons, Bio.link, Carrd, Bitly, Stan, Taplink...) link, review
// what was found, and hand the selected links to onImport({ social_links, websites }).
// onSkip is optional (shown during onboarding).
export default function ImportLinksPanel({ onImport, onSkip, importLabel = 'Add to my profile', intro }) {
  const [url, setUrl] = useState('')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [found, setFound] = useState(null)
  const [off, setOff] = useState(new Set()) // keys the user unchecked

  const find = async () => {
    if (!url.trim() || loading) return
    setError('')
    setFound(null)
    setOff(new Set())
    setLoading(true)
    try {
      setFound(await fetchImportedLinks(url.trim()))
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  const rows = found
    ? [
        ...(found.social_links ?? []).map((l, i) => ({ key: `s${i}`, kind: 'social', platform: l.platform, label: PLATFORM_LABELS[l.platform] ?? l.platform, value: l.value })),
        ...(found.websites ?? []).map((w, i) => ({ key: `w${i}`, kind: 'web', label: 'Website', value: w })),
      ]
    : []
  const selected = rows.filter((r) => !off.has(r.key))

  const toggle = (key) => setOff((prev) => {
    const next = new Set(prev)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    return next
  })

  const confirm = async () => {
    if (selected.length === 0 || saving) return
    setSaving(true)
    setError('')
    try {
      await onImport({
        social_links: selected.filter((r) => r.kind === 'social').map((r) => ({ platform: r.platform, value: r.value })),
        websites: selected.filter((r) => r.kind === 'web').map((r) => r.value),
      })
    } catch (e) {
      setError(e.message || 'Could not save those links')
    } finally {
      setSaving(false)
    }
  }

  return (
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 30 }}>
      {intro ? <Text style={styles.intro}>{intro}</Text> : null}
      <GlassPanel radius={radii.md} style={{ marginHorizontal: 20 }}>
        <TextInput
          style={styles.input}
          value={url}
          onChangeText={setUrl}
          placeholder="linktr.ee/yourname"
          placeholderTextColor={colors.textFaint}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          returnKeyType="go"
          onSubmitEditing={find}
        />
      </GlassPanel>
      <Text style={styles.supported}>Works with Linktree, Beacons, Bio.link, Carrd, Bitly, Stan, Taplink and more.</Text>

      <Pressable onPress={find} disabled={!url.trim() || loading} style={{ opacity: !url.trim() || loading ? 0.5 : 1 }}>
        <LinearGradient colors={gradients.brand} style={styles.button}>
          {loading ? <ActivityIndicator color={colors.onBrand} /> : <Text style={styles.buttonText}>Find my links</Text>}
        </LinearGradient>
      </Pressable>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      {found && (
        <View style={styles.results}>
          <Text style={type.label}>Found {rows.length} link{rows.length === 1 ? '' : 's'} - uncheck any you don't want</Text>
          {rows.map((r) => {
            const on = !off.has(r.key)
            return (
              <Pressable key={r.key} onPress={() => toggle(r.key)} style={styles.row}>
                <View style={[styles.check, on && styles.checkOn]}>{on ? <Text style={styles.checkMark}>✓</Text> : null}</View>
                <View style={styles.iconWrap}>
                  {r.kind === 'social' ? <SocialIcon platform={r.platform} size={18} color={colors.text} /> : <Text>🔗</Text>}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={type.body}>{r.label}</Text>
                  <Text style={type.caption} numberOfLines={1}>{r.value}</Text>
                </View>
              </Pressable>
            )
          })}
          <Pressable onPress={confirm} disabled={selected.length === 0 || saving} style={{ opacity: selected.length === 0 || saving ? 0.5 : 1 }}>
            <LinearGradient colors={gradients.brand} style={styles.button}>
              {saving ? <ActivityIndicator color={colors.onBrand} /> : <Text style={styles.buttonText}>{importLabel} ({selected.length})</Text>}
            </LinearGradient>
          </Pressable>
        </View>
      )}

      {onSkip ? (
        <Pressable onPress={onSkip} style={styles.skip}>
          <Text style={styles.skipText}>Skip for now</Text>
        </Pressable>
      ) : null}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  intro: { ...type.caption, marginHorizontal: 20, marginBottom: 12, lineHeight: 19 },
  input: { paddingHorizontal: 16, paddingVertical: 14, color: colors.text },
  supported: { ...type.caption, marginHorizontal: 20, marginTop: 8, marginBottom: 6 },
  button: { marginHorizontal: 20, marginTop: 14, paddingVertical: 15, borderRadius: radii.pill, alignItems: 'center' },
  buttonText: { color: colors.onBrand, fontWeight: '700', fontSize: 16 },
  error: { color: colors.danger, marginHorizontal: 20, marginTop: 12, textAlign: 'center' },
  results: { marginTop: 22 },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 20,
    borderBottomWidth: 1, borderBottomColor: colors.hairline,
  },
  check: { width: 22, height: 22, borderRadius: 6, borderWidth: 1.5, borderColor: colors.textFaint, alignItems: 'center', justifyContent: 'center' },
  checkOn: { backgroundColor: colors.magenta, borderColor: colors.magenta },
  checkMark: { color: colors.onBrand, fontSize: 14, fontWeight: '800' },
  iconWrap: { width: 26, alignItems: 'center' },
  skip: { alignItems: 'center', paddingVertical: 20 },
  skipText: { color: colors.textMuted, fontWeight: '600' },
})
