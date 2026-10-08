import { loadShowPhotoLocation, saveShowPhotoLocation } from '../lib/photoLocation'
import { clearSafeZone, formatRadius, loadSafeZone, releaseSafeZoneHide, saveSafeZone, subscribeSafeZone } from '../lib/safeZone'
import { useEffect, useState } from 'react'
import { loadFlipPref, saveFlipPref } from '../lib/flipToCamera'
import { loadTrimHandsFreePref, saveTrimHandsFreePref } from '../lib/handsFreePref'
import { View, Text, Switch, Pressable, StyleSheet, ScrollView, Alert } from 'react-native'
import BrandHeader from '../components/BrandHeader'
import GlassPanel from '../components/GlassPanel'
import GlowBackdrop from '../components/GlowBackdrop'
import SocialIcon from '../components/SocialIcon'
import { colors, radii, type } from '../theme'
import { supabase } from '../lib/supabase'
import { apiJson, patch as patchMe } from '../lib/api'
import { openLink } from '../lib/socialLinks'
import { registerForPush } from '../lib/push'
import { THEME_OPTIONS, loadThemePref, saveThemePref } from '../lib/themePref'
import { LaserTaggableSetting } from '../games/laser/Bystander'
import { languageName, useLanguage, useT } from '../i18n'
import strings from '../i18n/strings/settings'

const PRIVACY_URL = 'https://shop.iyiyi.xyz/policies/privacy-policy'
const TERMS_URL = 'https://iyiyi.xyz/terms'

const FOLLOW_US = [
  { platform: 'instagram', label: 'Instagram', handle: '@iyiyiapp', url: 'https://instagram.com/iyiyiapp' },
  { platform: 'youtube', label: 'YouTube', handle: '@iYiYiapp', url: 'https://www.youtube.com/@iYiYiapp' },
  { platform: 'instagram', label: 'Founder on Instagram', labelKey: 'follow_founder', handle: '@iyiyiguy', url: 'https://instagram.com/iyiyiguy' },
]

export default function SettingsScreen({ navigation }) {
  const t = useT(strings)
  const lang = useLanguage()
  const [statsPublic, setStatsPublic] = useState(false)
  const [notifyNearby, setNotifyNearby] = useState(false)
  const [allowTagging, setAllowTagging] = useState(true)
  const [showPhotoLocation, setShowPhotoLocation] = useState(true)
  const [safeZone, setSafeZoneState] = useState(null)
  useEffect(() => {
    loadSafeZone().then(setSafeZoneState)
    return subscribeSafeZone(setSafeZoneState)
  }, [])
  const openSafeZoneMap = () => navigation.navigate('Tabs', { screen: 'Map', params: { safeZone: Date.now() } })
  useEffect(() => { loadShowPhotoLocation().then(setShowPhotoLocation).catch(() => {}) }, [])
  const [flipCamera, setFlipCamera] = useState(true)
  const [trimHandsFree, setTrimHandsFree] = useState(true)
  const [privateViewing, setPrivateViewing] = useState(false)
  const [themePref, setThemePref] = useState('system')

  useEffect(() => {
    apiJson('/api/profiles/me')
      .then((profile) => {
        setStatsPublic(!!profile.stats_public)
        setNotifyNearby(!!profile.notify_nearby)
        setPrivateViewing(!!profile.private_viewing)
        setAllowTagging(profile.allow_tagging !== false)
      })
      .catch(() => {})
    loadThemePref().then(setThemePref)
    loadFlipPref().then(setFlipCamera)
    loadTrimHandsFreePref().then(setTrimHandsFree)
  }, [])

  const save = (body, revert) =>
    patchMe('/api/profiles/me', body).catch(() => {
      revert?.()
      Alert.alert(t('save_failed_title'), t('try_again_msg'))
    })

  const toggleNotify = async (on) => {
    if (!on) {
      setNotifyNearby(false)
      save({ notify_nearby: false }, () => setNotifyNearby(true))
      return
    }
    const token = await registerForPush()
    if (!token) {
      Alert.alert(t('notif_off_title'), t('notif_off_msg'))
      return
    }
    setNotifyNearby(true)
    save({ notify_nearby: true, push_token: token }, () => setNotifyNearby(false))
  }

  const chooseTheme = (pref) => {
    setThemePref(pref)
    saveThemePref(pref)
  }

  const [deleting, setDeleting] = useState(false)
  const deleteAccount = () => {
    if (deleting) return
    Alert.alert(
      t('delete_title'),
      t('delete_msg'),
      [
        { text: t('cancel'), style: 'cancel' },
        {
          text: t('delete'),
          style: 'destructive',
          onPress: async () => {
            setDeleting(true)
            try {
              await apiJson('/api/profiles/me', { method: 'DELETE' })
            } catch (e) {
              setDeleting(false)
              Alert.alert(t('delete_failed'), e?.message ?? t('try_again_msg'))
              return
            }
            await supabase.auth.signOut().catch(() => {})
          },
        },
      ],
    )
  }

  return (
    <View style={styles.screen}>
      <GlowBackdrop preset="quiet" />
      <BrandHeader title={t('title')} onBack={() => navigation.goBack()} />
      <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
        <GlassPanel radius={radii.lg} style={styles.card}>
          <View style={styles.themeBlock}>
            <Text style={type.body}>{t('appearance')}</Text>
            <View style={styles.segment}>
              {THEME_OPTIONS.map((o) => (
                <Pressable key={o.key} onPress={() => chooseTheme(o.key)} style={[styles.segmentItem, themePref === o.key && styles.segmentItemActive]}>
                  <Text style={[styles.segmentText, themePref === o.key && styles.segmentTextActive]}>{t(`theme_${o.key}`) === `theme_${o.key}` ? o.label : t(`theme_${o.key}`)}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        </GlassPanel>

        <GlassPanel radius={radii.lg} style={styles.card}>
          <SwitchRow
            label={t('safe_zone')}
            description={safeZone
              ? t('safe_zone_desc_set', { radius: formatRadius(safeZone.radiusM) })
              : t('safe_zone_desc_unset')}
            value={!!safeZone?.enabled}
            onChange={(v) => {
              if (!safeZone) { openSafeZoneMap(); return }
              saveSafeZone({ ...safeZone, enabled: v })
              if (!v) releaseSafeZoneHide()
            }}
          />
          <Row label={safeZone ? t('safe_zone_edit') : t('safe_zone_setup')} onPress={openSafeZoneMap} />
          {safeZone ? (
            <Row
              danger
              label={t('safe_zone_remove')}
              onPress={() => Alert.alert(t('safe_zone_remove_title'), t('safe_zone_remove_msg'), [
                { text: t('cancel'), style: 'cancel' },
                { text: t('remove'), style: 'destructive', onPress: async () => { await clearSafeZone(); releaseSafeZoneHide() } },
              ])}
            />
          ) : null}
        </GlassPanel>

        <GlassPanel radius={radii.lg} style={styles.card}>
          <SwitchRow
            label={t('stats_public')}
            description={t('stats_public_desc')}
            value={statsPublic}
            onChange={(v) => { setStatsPublic(v); save({ stats_public: v }, () => setStatsPublic(!v)) }}
          />
          <SwitchRow
            label={t('private_viewing')}
            description={t('private_viewing_desc')}
            value={privateViewing}
            onChange={(v) => { setPrivateViewing(v); save({ private_viewing: v }, () => setPrivateViewing(!v)) }}
          />
          <SwitchRow
            label={t('flip_camera')}
            description={t('flip_camera_desc')}
            value={flipCamera}
            onChange={(v) => { setFlipCamera(v); saveFlipPref(v) }}
          />
          <SwitchRow
            label={t('trim_hands_free')}
            description={t('trim_hands_free_desc')}
            value={trimHandsFree}
            onChange={(v) => { setTrimHandsFree(v); saveTrimHandsFreePref(v) }}
          />
          <SwitchRow
            label={t('allow_tagging')}
            description={t('allow_tagging_desc')}
            value={allowTagging}
            onChange={(v) => { setAllowTagging(v); save({ allow_tagging: v }, () => setAllowTagging(!v)) }}
          />
          <SwitchRow
            label={t('photo_location')}
            description={t('photo_location_desc')}
            value={showPhotoLocation}
            onChange={(v) => { setShowPhotoLocation(v); saveShowPhotoLocation(v) }}
          />
          <LaserTaggableSetting SwitchRow={SwitchRow} />
          <SwitchRow
            label={t('notify_nearby')}
            description={t('notify_nearby_desc')}
            value={notifyNearby}
            onChange={toggleNotify}
          />
        </GlassPanel>

        <GlassPanel radius={radii.lg} style={styles.card}>
          <Row label={t('language')} value={languageName(lang)} onPress={() => navigation.navigate('Language')} />
          <Row label="⭐ iYiYi Pro" onPress={() => navigation.navigate('Subscription')} />
          <Row label={t('arcade')} onPress={() => navigation.popTo('Tabs', { screen: 'Games' })} />
          <Row label={t('viewers')} onPress={() => navigation.navigate('Viewers')} />
          <Row label={t('saved')} onPress={() => navigation.navigate('SavedContent')} />
          <Row label={t('blocked')} onPress={() => navigation.navigate('BlockedUsers')} />
        </GlassPanel>

        <GlassPanel radius={radii.lg} style={styles.card}>
          <Text style={styles.cardTitle}>{t('follow_title')}</Text>
          {FOLLOW_US.map((f) => (
            <Pressable key={f.url} onPress={() => openLink(f.url)} style={styles.followRow}>
              <SocialIcon platform={f.platform} size={20} color={colors.text} />
              <View style={{ flex: 1 }}>
                <Text style={type.body}>{f.labelKey ? t(f.labelKey) : f.label}</Text>
                <Text style={type.caption}>{f.handle}</Text>
              </View>
            </Pressable>
          ))}
        </GlassPanel>

        <GlassPanel radius={radii.lg} style={styles.card}>
          <Row label={t('shop')} onPress={() => openLink('https://shop.iyiyi.xyz')} />
        </GlassPanel>

        <GlassPanel radius={radii.lg} style={styles.card}>
          <Row label={t('privacy')} onPress={() => openLink(PRIVACY_URL)} />
          <Row label={t('terms')} onPress={() => openLink(TERMS_URL)} />
          <Row label={t('sign_out')} onPress={() => supabase.auth.signOut()} />
        </GlassPanel>

        <GlassPanel radius={radii.lg} style={styles.card}>
          <Row label={t('delete_account')} danger onPress={deleteAccount} />
        </GlassPanel>
      </ScrollView>
    </View>
  )
}

function Row({ label, value, onPress, danger }) {
  return (
    <Pressable onPress={onPress} style={styles.row}>
      <Text style={[type.body, danger && { color: colors.danger }]}>{label}</Text>
      {value ? <Text style={[type.body, { color: colors.textMuted }]}>{value}</Text> : null}
    </Pressable>
  )
}

function SwitchRow({ label, description, value, onChange, disabled }) {
  return (
    <View style={styles.switchRow}>
      <View style={styles.switchRowTop}>
        <Text style={[type.body, { flex: 1, paddingRight: 12 }]}>{label}</Text>
        <Switch
          value={value} onValueChange={onChange} disabled={disabled}
          trackColor={{ false: colors.hairline, true: colors.magenta }}
          thumbColor="#ffffff"
        />
      </View>
      {description ? <Text style={styles.description}>{description}</Text> : null}
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: 'transparent' },
  card: { margin: 20, marginBottom: 0 },
  cardTitle: { ...type.label, padding: 16, paddingBottom: 4 },
  row: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    padding: 16, borderBottomWidth: 1, borderBottomColor: colors.hairline,
  },
  followRow: {
    flexDirection: 'row', alignItems: 'center', gap: 14, padding: 16,
    borderBottomWidth: 1, borderBottomColor: colors.hairline,
  },
  switchRow: { borderBottomWidth: 1, borderBottomColor: colors.hairline, paddingBottom: 12 },
  switchRowTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, paddingBottom: 8 },
  description: { ...type.caption, paddingHorizontal: 16 },
  themeBlock: { padding: 16, gap: 12 },
  segment: {
    flexDirection: 'row', backgroundColor: colors.ink, borderRadius: radii.pill, padding: 4,
    borderWidth: 1, borderColor: colors.hairline,
  },
  segmentItem: { flex: 1, paddingVertical: 9, borderRadius: radii.pill, alignItems: 'center' },
  segmentItemActive: { backgroundColor: colors.magenta },
  segmentText: { color: colors.textMuted, fontWeight: '600', fontSize: 13 },
  segmentTextActive: { color: colors.onBrand },
})
