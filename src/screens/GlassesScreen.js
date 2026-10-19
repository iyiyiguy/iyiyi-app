// Settings > Meta glasses: link Meta Ray-Ban Display glasses to your iYiYi account. The glasses
// web app (iyiyi.xyz/glasses) shows a 6-letter code; you type it here. After that the glasses
// show people nearby, open profiles, and are your laser tag sights (head aim, pinch to fire).
import { useEffect, useState } from 'react'
import { View, Text, TextInput, Pressable, StyleSheet, ScrollView, ActivityIndicator, Alert, Share } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import BrandHeader from '../components/BrandHeader'
import GlassPanel from '../components/GlassPanel'
import { colors, radii, type } from '../theme'
import { claimGlassesCode, isGlassesLinked, setGlassesLinked, GLASSES_URL, XR_URL } from '../lib/glasses'
import { useT } from '../i18n'
import strings from '../i18n/strings/glasses'

export default function GlassesScreen({ navigation }) {
  const t = useT(strings)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [linked, setLinked] = useState(false)
  useEffect(() => { isGlassesLinked().then(setLinked) }, [])

  const submit = async () => {
    const c = code.toUpperCase().replace(/[^A-Z0-9]/g, '')
    if (c.length !== 6) { Alert.alert(t('codeShort')); return }
    setBusy(true)
    try {
      const ok = await claimGlassesCode(c)
      if (ok) { setLinked(true); setCode(''); Alert.alert(t('linkedTitle'), t('linkedBody')) }
      else Alert.alert(t('badCodeTitle'), t('badCodeBody'))
    } catch (e) {
      Alert.alert(t('failed'), e?.message || t('tryAgain'))
    } finally {
      setBusy(false)
    }
  }

  const step = (n, text) => (
    <View style={styles.step} key={n}>
      <View style={styles.num}><Text style={styles.numText}>{n}</Text></View>
      <Text style={[type.body, { flex: 1 }]}>{text}</Text>
    </View>
  )

  return (
    <View style={styles.screen}>
      <BrandHeader title={t('title')} onBack={() => navigation.goBack()} />
      <ScrollView contentContainerStyle={{ padding: 20, gap: 16 }} keyboardShouldPersistTaps="handled">
        <GlassPanel radius={radii.lg} style={styles.card}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Ionicons name="glasses-outline" size={26} color={colors.text} />
            <Text style={[type.title3, { flex: 1 }]}>{t('heading')}</Text>
            {linked ? <View style={styles.badge}><Text style={styles.badgeText}>{t('linkedBadge')}</Text></View> : null}
          </View>
          <Text style={[type.body, { color: colors.textMuted }]}>{t('intro')}</Text>
        </GlassPanel>

        <GlassPanel radius={radii.lg} style={styles.card}>
          {step(1, t('step1'))}
          <Pressable onPress={() => Share.share({ message: GLASSES_URL }).catch(() => {})} accessibilityRole="button" style={styles.url}>
            <Text style={styles.urlText}>{GLASSES_URL.replace('https://', '')}</Text>
            <Ionicons name="share-outline" size={16} color={colors.accent} />
          </Pressable>
          {step(2, t('step2'))}
          {step(3, t('step3'))}
          <TextInput
            value={code}
            onChangeText={(v) => setCode(v.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6))}
            placeholder="ABC123"
            placeholderTextColor={colors.textFaint}
            autoCapitalize="characters"
            autoCorrect={false}
            maxLength={6}
            style={styles.input}
            accessibilityLabel={t('codeLabel')}
            onSubmitEditing={submit}
            returnKeyType="done"
          />
          <Pressable onPress={submit} disabled={busy} style={({ pressed }) => [styles.btn, (pressed || busy) && { opacity: 0.7 }]} accessibilityRole="button">
            {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnText}>{t('link')}</Text>}
          </Pressable>
        </GlassPanel>

        <GlassPanel radius={radii.lg} style={styles.card}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Ionicons name="cube-outline" size={24} color={colors.text} />
            <View style={{ flex: 1 }}>
              <Text style={type.title3}>{t('xrTitle')}</Text>
              <Text style={[type.caption, { color: colors.textMuted }]}>{t('xrSub')}</Text>
            </View>
          </View>
          <Text style={[type.body, { color: colors.textMuted }]}>{t('xrBody')}</Text>
          <Pressable onPress={() => Share.share({ message: XR_URL }).catch(() => {})} accessibilityRole="button" style={styles.url}>
            <Text style={styles.urlText}>{XR_URL.replace('https://', '')}</Text>
            <Ionicons name="share-outline" size={16} color={colors.accent} />
          </Pressable>
        </GlassPanel>

        <GlassPanel radius={radii.lg} style={styles.card}>
          <Text style={type.headline}>{t('whatTitle')}</Text>
          <Text style={[type.body, { color: colors.textMuted }]}>{t('what1')}</Text>
          <Text style={[type.body, { color: colors.textMuted }]}>{t('what2')}</Text>
          <Text style={[type.body, { color: colors.textMuted }]}>{t('what3')}</Text>
        </GlassPanel>

        {linked ? (
          <Pressable onPress={async () => { await setGlassesLinked(false); setLinked(false) }} accessibilityRole="button" style={{ alignSelf: 'center', padding: 10 }}>
            <Text style={{ color: colors.danger }}>{t('stopOnPhone')}</Text>
          </Pressable>
        ) : null}
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: 'transparent' },
  card: { padding: 18, gap: 12 },
  step: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  num: { width: 26, height: 26, borderRadius: 13, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  numText: { color: '#fff', fontWeight: '800' },
  url: { flexDirection: 'row', alignItems: 'center', gap: 8, marginLeft: 38 },
  urlText: { color: colors.accent, fontWeight: '700', fontSize: 16 },
  input: { borderWidth: 1, borderColor: colors.border || 'rgba(255,255,255,0.18)', borderRadius: 14, paddingVertical: 14, textAlign: 'center', fontSize: 30, fontWeight: '800', letterSpacing: 8, color: colors.text },
  btn: { height: 50, borderRadius: 25, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  btnText: { color: '#fff', fontWeight: '800', fontSize: 17 },
  badge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10, backgroundColor: colors.success },
  badgeText: { color: '#fff', fontWeight: '800', fontSize: 12 },
})
