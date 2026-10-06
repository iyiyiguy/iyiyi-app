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

const PRIVACY_URL = 'https://shop.iyiyi.xyz/policies/privacy-policy'
const TERMS_URL = 'https://iyiyi.xyz/terms'

const FOLLOW_US = [
  { platform: 'instagram', label: 'Instagram', handle: '@iyiyiapp', url: 'https://instagram.com/iyiyiapp' },
  { platform: 'youtube', label: 'YouTube', handle: '@iYiYiapp', url: 'https://www.youtube.com/@iYiYiapp' },
  { platform: 'instagram', label: 'Founder on Instagram', handle: '@iyiyiguy', url: 'https://instagram.com/iyiyiguy' },
]

export default function SettingsScreen({ navigation }) {
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
      Alert.alert("Couldn't save", 'Check your connection and try again.')
    })

  const toggleNotify = async (on) => {
    if (!on) {
      setNotifyNearby(false)
      save({ notify_nearby: false }, () => setNotifyNearby(true))
      return
    }
    const token = await registerForPush()
    if (!token) {
      Alert.alert('Notifications are off', 'Allow notifications for iYiYi in your phone settings to get nearby alerts.')
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
      'Delete account?',
      'This permanently deletes your iYiYi account, profile and content. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            setDeleting(true)
            try {
              await apiJson('/api/profiles/me', { method: 'DELETE' })
            } catch (e) {
              setDeleting(false)
              Alert.alert("Couldn't delete account", e?.message ?? 'Check your connection and try again.')
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
      <BrandHeader title="Settings" onBack={() => navigation.goBack()} />
      <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
        <GlassPanel radius={radii.lg} style={styles.card}>
          <View style={styles.themeBlock}>
            <Text style={type.body}>Appearance</Text>
            <View style={styles.segment}>
              {THEME_OPTIONS.map((o) => (
                <Pressable key={o.key} onPress={() => chooseTheme(o.key)} style={[styles.segmentItem, themePref === o.key && styles.segmentItemActive]}>
                  <Text style={[styles.segmentText, themePref === o.key && styles.segmentTextActive]}>{o.label}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        </GlassPanel>

        <GlassPanel radius={radii.lg} style={styles.card}>
          <SwitchRow
            label="Safe zone"
            description={safeZone
              ? `Around your home spot (${formatRadius(safeZone.radiusM)}). While you're inside it your location isn't shared and your profile is hidden from the map and Nearby. Your home spot stays on this phone.`
              : "Set a home spot. While you're inside it your location isn't shared and your profile is hidden from the map and Nearby."}
            value={!!safeZone?.enabled}
            onChange={(v) => {
              if (!safeZone) { openSafeZoneMap(); return }
              saveSafeZone({ ...safeZone, enabled: v })
              if (!v) releaseSafeZoneHide()
            }}
          />
          <Row label={safeZone ? 'Edit safe zone on the map' : 'Set up safe zone on the map'} onPress={openSafeZoneMap} />
          {safeZone ? (
            <Row
              danger
              label="Remove safe zone"
              onPress={() => Alert.alert('Remove safe zone?', 'Your profile will show on the map again when you are home (if "visible on the map" is on).', [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Remove', style: 'destructive', onPress: async () => { await clearSafeZone(); releaseSafeZoneHide() } },
              ])}
            />
          ) : null}
        </GlassPanel>

        <GlassPanel radius={radii.lg} style={styles.card}>
          <SwitchRow
            label="Show my profile view count"
            description="Let others see how many people have viewed your profile."
            value={statsPublic}
            onChange={(v) => { setStatsPublic(v); save({ stats_public: v }, () => setStatsPublic(!v)) }}
          />
          <SwitchRow
            label="Private viewing"
            description="Browse profiles without showing up in their 'who viewed you' list or their view count."
            value={privateViewing}
            onChange={(v) => { setPrivateViewing(v); save({ private_viewing: v }, () => setPrivateViewing(!v)) }}
          />
          <SwitchRow
            label="Flip to open camera"
            description="With iYiYi open, turn your phone face down and back up quickly to jump straight to the camera."
            value={flipCamera}
            onChange={(v) => { setFlipCamera(v); saveFlipPref(v) }}
          />
          <SwitchRow
            label="Trim hands-free videos"
            description="Cut the last 5 seconds off a hands-free (tripod) video before it posts, so you don't have to edit yourself out walking up to stop it. The full clip always still saves to your phone."
            value={trimHandsFree}
            onChange={(v) => { setTrimHandsFree(v); saveTrimHandsFreePref(v) }}
          />
          <SwitchRow
            label="Let people tag me"
            description="Allow camera posts from people within 150ft to tag you automatically. You can still hide any tag."
            value={allowTagging}
            onChange={(v) => { setAllowTagging(v); save({ allow_tagging: v }, () => setAllowTagging(!v)) }}
          />
          <SwitchRow
            label="Show location on my photos"
            description="Adds your city (never your street) under photos you post from the iYiYi camera."
            value={showPhotoLocation}
            onChange={(v) => { setShowPhotoLocation(v); saveShowPhotoLocation(v) }}
          />
          <LaserTaggableSetting SwitchRow={SwitchRow} />
          <SwitchRow
            label="Notify me when someone is nearby"
            description="Get a notification when another iYiYi user comes within 150ft."
            value={notifyNearby}
            onChange={toggleNotify}
          />
        </GlassPanel>

        <GlassPanel radius={radii.lg} style={styles.card}>
          <Row label="iYiYi Pro" onPress={() => navigation.navigate('Subscription')} />
          <Row label="Arcade" onPress={() => navigation.popTo('Tabs', { screen: 'Games' })} />
          <Row label="Who viewed my profile" onPress={() => navigation.navigate('Viewers')} />
          <Row label="Saved & liked content" onPress={() => navigation.navigate('SavedContent')} />
          <Row label="Blocked Users" onPress={() => navigation.navigate('BlockedUsers')} />
        </GlassPanel>

        <GlassPanel radius={radii.lg} style={styles.card}>
          <Text style={styles.cardTitle}>Follow iYiYi</Text>
          {FOLLOW_US.map((f) => (
            <Pressable key={f.url} onPress={() => openLink(f.url)} style={styles.followRow}>
              <SocialIcon platform={f.platform} size={20} color={colors.text} />
              <View style={{ flex: 1 }}>
                <Text style={type.body}>{f.label}</Text>
                <Text style={type.caption}>{f.handle}</Text>
              </View>
            </Pressable>
          ))}
        </GlassPanel>

        <GlassPanel radius={radii.lg} style={styles.card}>
          <Row label="Shop" onPress={() => openLink('https://shop.iyiyi.xyz')} />
        </GlassPanel>

        <GlassPanel radius={radii.lg} style={styles.card}>
          <Row label="Privacy Policy" onPress={() => openLink(PRIVACY_URL)} />
          <Row label="Terms of Service" onPress={() => openLink(TERMS_URL)} />
          <Row label="Sign out" onPress={() => supabase.auth.signOut()} />
        </GlassPanel>

        <GlassPanel radius={radii.lg} style={styles.card}>
          <Row label="Delete my account" danger onPress={deleteAccount} />
        </GlassPanel>
      </ScrollView>
    </View>
  )
}

function Row({ label, onPress, danger }) {
  return (
    <Pressable onPress={onPress} style={styles.row}>
      <Text style={[type.body, danger && { color: colors.danger }]}>{label}</Text>
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
