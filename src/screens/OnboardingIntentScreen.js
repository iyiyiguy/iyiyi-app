import { useState } from 'react'
import { View, Text, StyleSheet, ScrollView } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { LinearGradient } from 'expo-linear-gradient'
import { Ionicons } from '@expo/vector-icons'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { colors, radii, type } from '../theme'
import { FadeIn, Press } from '../lib/motion'
import GlassPanel from '../components/GlassPanel'
import OnboardingSteps from '../components/OnboardingSteps'
import { supabase } from '../lib/supabase'
import { patch } from '../lib/api'
import { useT } from '../i18n'
import strings from '../i18n/strings/onboarding'

// First onboarding step after sign-up: "What brings you here?" (Business / Creator / Player).
// One tap picks and moves on; Skip leaves it unset. The answer tailors the later steps' copy
// (nametag, socials, location) and the default tier on the Pro offer.
//
// Where it is kept: profiles has no intent column, but it does have profile_label
// ('standard' | 'creator' | 'business', the "Profile type" chips in Edit Profile), so Business
// and Creator set that (only when it isn't already chosen). The raw intent, including
// 'player', also goes to the auth user's metadata (follows the account to other devices) and
// to AsyncStorage per user (read back instantly on the next launch).
export const INTENTS = ['business', 'creator', 'player']
export const intentKey = (uid) => `iyiyi_onboarding_intent_${uid}`
const PROFILE_LABEL = { business: 'business', creator: 'creator' }

const OPTIONS = [
  { key: 'business', icon: 'storefront', colors: ['#e8b04b', '#ff9f6b'], title: 'bizTitle', text: 'bizText' },
  { key: 'creator', icon: 'sparkles', colors: ['#ff6fb5', '#9b8cff'], title: 'creatorTitle', text: 'creatorText' },
  { key: 'player', icon: 'game-controller', colors: ['#4fd1c5', '#6b7cff'], title: 'playerTitle', text: 'playerText' },
]

// The intent saved for this user: this device first, then the account's metadata.
export async function loadSavedIntent(user) {
  if (!user?.id) return null
  try {
    const local = await AsyncStorage.getItem(intentKey(user.id))
    if (INTENTS.includes(local)) return local
  } catch {}
  const meta = user.user_metadata?.intent
  return INTENTS.includes(meta) ? meta : null
}

// Fire-and-forget: the next step never waits on the network.
export function saveIntent(user, intent, profile) {
  if (!user?.id || !INTENTS.includes(intent)) return
  AsyncStorage.setItem(intentKey(user.id), intent).catch(() => {})
  supabase.auth.updateUser({ data: { intent } }).catch(() => {})
  const label = PROFILE_LABEL[intent]
  const current = profile?.profile_label
  if (label && (!current || current === 'standard')) patch('/api/profiles/me', { profile_label: label }).catch(() => {})
}

export default function OnboardingIntentScreen({ user, profile, onDone, step, total }) {
  const insets = useSafeAreaInsets()
  const t = useT(strings)
  const [picked, setPicked] = useState(null)

  const pick = (key) => {
    if (picked) return
    setPicked(key)
    saveIntent(user, key, profile)
    // A beat so the selected card registers before the next step slides in.
    setTimeout(() => onDone(key), 180)
  }

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 24 }]} showsVerticalScrollIndicator={false}>
        <OnboardingSteps step={step} total={total} onSkip={() => onDone(null)} style={{ paddingHorizontal: 0 }} />
        <FadeIn style={{ marginTop: 28 }}>
          <Text style={styles.title}>{t('intentTitle')}</Text>
          <Text style={styles.sub}>{t('intentSub')}</Text>
        </FadeIn>

        <View style={{ marginTop: 24, gap: 12 }}>
          {OPTIONS.map((o, i) => {
            const on = picked === o.key
            return (
              <FadeIn key={o.key} index={i + 1}>
                <Press onPress={() => pick(o.key)} disabled={!!picked} scaleTo={0.97} haptic="light" accessibilityLabel={t(o.title)} accessibilityState={{ selected: on }}>
                  <GlassPanel radius={radii.lg} animateIn={false} strong={on} style={on ? styles.cardOn : null}>
                    <View style={styles.row}>
                      <LinearGradient colors={o.colors} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.icon}>
                        <Ionicons name={o.icon} size={22} color="#fff" />
                      </LinearGradient>
                      <View style={{ flex: 1 }}>
                        <Text style={type.headline}>{t(o.title)}</Text>
                        <Text style={[type.caption, { marginTop: 3 }]}>{t(o.text)}</Text>
                      </View>
                      <Ionicons name={on ? 'checkmark-circle' : 'chevron-forward'} size={on ? 24 : 18} color={on ? colors.magenta : colors.textFaint} />
                    </View>
                  </GlassPanel>
                </Press>
              </FadeIn>
            )
          })}
        </View>
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: 'transparent' },
  scroll: { paddingHorizontal: 20, maxWidth: 520, width: '100%', alignSelf: 'center' },
  title: { ...type.display },
  sub: { ...type.subhead, marginTop: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 16 },
  icon: { width: 48, height: 48, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  cardOn: { borderWidth: 1.5, borderColor: colors.magenta },
})
