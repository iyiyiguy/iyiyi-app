import { useCallback, useEffect, useState } from 'react'
import { View, Text, StyleSheet, ScrollView, Pressable, TextInput, Alert, ActivityIndicator, Image } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { LinearGradient } from 'expo-linear-gradient'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import BrandHeader from '../components/BrandHeader'
import GlassPanel from '../components/GlassPanel'
import { colors, radii, type } from '../theme'
import { FadeIn, Press } from '../lib/motion'
import { apiJson, post, del } from '../lib/api'
import useBusinessAccess from '../lib/useBusinessAccess'
import { avatarSource } from '../lib/avatarSource'
import { BusinessGate, StateCard } from '../components/business/BusinessStates'
import { TEAM_STAFF_SEATS } from '../components/business/BusinessToolsCard'
import { useT } from '../i18n'
import strings from '../i18n/strings/business'

// Business Pro includes the owner plus up to TEAM_STAFF_SEATS staff accounts (as the paywall says).
// The owner never takes a staff seat. No demo data: a failed load shows an error with Retry.
const MAX_MEMBERS = TEAM_STAFF_SEATS

function MemberCard({ member, onRemove }) {
  const t = useT(strings)
  return (
    <GlassPanel radius={radii.lg} lite animateIn={false}>
      <View style={styles.memberCard}>
        <View style={styles.avatar}>
          {member.avatar_url ? (
            <Image source={avatarSource(member.avatar_url)} style={styles.avatarImg} />
          ) : (
            <Ionicons name="person" size={20} color={colors.textMuted} />
          )}
        </View>
        <View style={{ flex: 1 }}>
          <Text style={type.headline} numberOfLines={1}>{member.username || member.email}</Text>
          <Text style={type.caption}>
            {member.role === 'owner' ? t('tm_owner') : member.status === 'pending' ? t('tm_pending') : t('tm_member')}
            {member.joined_at ? ` · ${t('tm_joined', { date: new Date(member.joined_at).toLocaleDateString() })}` : ''}
          </Text>
        </View>
        {member.role !== 'owner' && (
          <Pressable onPress={() => onRemove(member)} hitSlop={8}>
            <Ionicons name="close-circle" size={24} color={colors.danger} />
          </Pressable>
        )}
        {member.role === 'owner' && (
          <View style={styles.ownerBadge}>
            <Text style={styles.ownerText}>{t('tm_owner_caps')}</Text>
          </View>
        )}
      </View>
    </GlassPanel>
  )
}

export default function BusinessTeamScreen({ navigation }) {
  const t = useT(strings)
  const access = useBusinessAccess()
  return (
    <BusinessGate access={access} title={t('team_title')} lockedText={t('locked_team', { n: MAX_MEMBERS })} navigation={navigation}>
      <Team navigation={navigation} />
    </BusinessGate>
  )
}

function Team({ navigation }) {
  const t = useT(strings)
  const insets = useSafeAreaInsets()
  const [members, setMembers] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(null)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviting, setInviting] = useState(false)

  const loadMembers = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const data = await apiJson('/api/business/team')
      setMembers(Array.isArray(data?.members) ? data.members : [])
    } catch (e) {
      setLoadError(e?.message || t('err_access_msg'))
    } finally {
      setLoading(false)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { loadMembers() }, [loadMembers])

  const staff = members.filter((m) => m.role !== 'owner')

  const invite = async () => {
    const email = inviteEmail.trim().toLowerCase()
    if (!email || !email.includes('@')) {
      Alert.alert(t('tm_invalid_email'), t('tm_invalid_email_msg'))
      return
    }
    if (staff.length >= MAX_MEMBERS) {
      Alert.alert(t('tm_full'), t('tm_full_msg', { n: MAX_MEMBERS }))
      return
    }
    setInviting(true)
    try {
      await post('/api/business/team/invite', { email })
      Alert.alert(t('tm_invite_sent'), t('tm_invite_sent_msg', { email }))
      setInviteEmail('')
      loadMembers()
    } catch (e) {
      Alert.alert(t('error'), e?.message || t('tm_invite_failed'))
    } finally {
      setInviting(false)
    }
  }

  const removeMember = (member) => {
    Alert.alert(
      t('tm_remove_title'),
      t('tm_remove_msg', { name: member.username || member.email }),
      [
        { text: t('cancel'), style: 'cancel' },
        {
          text: t('remove'),
          style: 'destructive',
          onPress: async () => {
            try {
              await del(`/api/business/team/${member.id}`)
              setMembers((prev) => prev.filter((m) => m.id !== member.id))
            } catch (e) {
              Alert.alert(t('error'), e?.message || t('tm_remove_failed'))
            }
          },
        },
      ],
    )
  }

  const spotsLeft = Math.max(0, MAX_MEMBERS - staff.length)

  return (
    <View style={styles.screen}>
      <BrandHeader title={t('team_title')} subtitle={loadError ? undefined : t('team_subtitle', { n: staff.length, max: MAX_MEMBERS })} onBack={() => navigation.goBack()} />
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 24 }]}
        showsVerticalScrollIndicator={false}
      >
        {loading ? (
          <ActivityIndicator color={colors.textMuted} style={{ marginTop: 60 }} />
        ) : loadError ? (
          <StateCard tone="error" title={t('err_team_title')} message={loadError} actionLabel={t('retry')} onAction={loadMembers} />
        ) : (
          <>
            <Text style={[type.caption, { marginBottom: 10 }]}>{t('team_owner_note')}</Text>
            {staff.length === 0 ? <Text style={[type.subhead, { marginBottom: 10 }]}>{t('team_empty')}</Text> : null}
            {/* Member list */}
            <View style={{ gap: 10 }}>
              {members.map((m, i) => (
                <FadeIn key={m.id} index={i}>
                  <MemberCard member={m} onRemove={removeMember} />
                </FadeIn>
              ))}
            </View>

            {/* Add member */}
            {spotsLeft > 0 && (
              <FadeIn index={members.length + 1} style={{ marginTop: 20 }}>
                <GlassPanel radius={radii.lg} lite animateIn={false}>
                  <View style={styles.addSection}>
                    <Text style={type.headline}>{t('tm_add')}</Text>
                    <Text style={[type.caption, { marginTop: 4, marginBottom: 14 }]}>
                      {t(spotsLeft === 1 ? 'tm_seats_left_one' : 'tm_seats_left', { n: spotsLeft })}
                    </Text>
                    <View style={styles.inviteRow}>
                      <TextInput
                        style={styles.input}
                        value={inviteEmail}
                        onChangeText={setInviteEmail}
                        placeholder={t('tm_email_ph')}
                        placeholderTextColor={colors.textFaint}
                        keyboardType="email-address"
                        autoCapitalize="none"
                        returnKeyType="send"
                        onSubmitEditing={invite}
                      />
                      <Press onPress={invite} disabled={inviting} haptic="light">
                        <LinearGradient colors={['#6366f1', '#a78bfa']} style={styles.inviteBtn}>
                          {inviting ? <ActivityIndicator color="#fff" size="small" /> : (
                            <Ionicons name="send" size={18} color="#fff" />
                          )}
                        </LinearGradient>
                      </Press>
                    </View>
                  </View>
                </GlassPanel>
              </FadeIn>
            )}

            {/* Permissions info */}
            <FadeIn index={members.length + 2} style={{ marginTop: 16 }}>
              <GlassPanel radius={radii.lg} lite animateIn={false}>
                <View style={{ padding: 18 }}>
                  <Text style={[type.label, { marginBottom: 10 }]}>{t('tm_perms')}</Text>
                  {[
                    { icon: 'checkmark-circle', text: t('tm_perm_analytics') },
                    { icon: 'checkmark-circle', text: t('tm_perm_promos') },
                    { icon: 'checkmark-circle', text: t('tm_perm_post') },
                    { icon: 'checkmark-circle', text: t('tm_perm_respond') },
                    { icon: 'close-circle', text: t('tm_perm_billing'), no: true },
                    { icon: 'close-circle', text: t('tm_perm_owner'), no: true },
                  ].map((perm, i) => (
                    <View key={i} style={styles.permRow}>
                      <Ionicons name={perm.icon} size={18} color={perm.no ? colors.textFaint : '#10b981'} />
                      <Text style={[type.body, perm.no && { color: colors.textFaint }]}>{perm.text}</Text>
                    </View>
                  ))}
                </View>
              </GlassPanel>
            </FadeIn>
          </>
        )}
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: 'transparent' },
  scroll: { paddingHorizontal: 16 },
  // Member card
  memberCard: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 16 },
  avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.inkSurface, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.hairline, overflow: 'hidden' },
  avatarImg: { width: 44, height: 44 },
  ownerBadge: { backgroundColor: '#f59e0b', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  ownerText: { color: '#fff', fontSize: 10, fontWeight: '900', letterSpacing: 0.5 },
  // Add section
  addSection: { padding: 18 },
  inviteRow: { flexDirection: 'row', gap: 10 },
  input: { flex: 1, ...type.body, paddingHorizontal: 14, paddingVertical: 12, borderRadius: radii.sm, borderWidth: 1, borderColor: colors.hairline, backgroundColor: colors.inkSurface, color: colors.text },
  inviteBtn: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  // Permissions
  permRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 5 },
})
