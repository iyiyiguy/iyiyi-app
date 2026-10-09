import { useCallback, useEffect, useState } from 'react'
import { View, Text, StyleSheet, ScrollView, Pressable, TextInput, Alert, ActivityIndicator } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { LinearGradient } from 'expo-linear-gradient'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import BrandHeader from '../components/BrandHeader'
import GlassPanel from '../components/GlassPanel'
import { colors, radii, type } from '../theme'
import { FadeIn, Press } from '../lib/motion'
import { apiJson, post, del } from '../lib/api'
import { useIsBusinessPro } from '../lib/useIsPro'

const MAX_MEMBERS = 3

function MemberCard({ member, onRemove, isOwner }) {
  return (
    <GlassPanel radius={radii.lg} lite animateIn={false}>
      <View style={styles.memberCard}>
        <View style={styles.avatar}>
          <Text style={{ fontSize: 20 }}>{member.avatar_url ? '👤' : '👤'}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={type.headline} numberOfLines={1}>{member.username || member.email}</Text>
          <Text style={type.caption}>
            {member.role === 'owner' ? 'Owner' : 'Team member'}
            {member.joined_at ? ` · joined ${new Date(member.joined_at).toLocaleDateString()}` : ''}
          </Text>
        </View>
        {!isOwner && member.role !== 'owner' && (
          <Pressable onPress={() => onRemove(member)} hitSlop={8}>
            <Ionicons name="close-circle" size={24} color={colors.danger} />
          </Pressable>
        )}
        {member.role === 'owner' && (
          <View style={styles.ownerBadge}>
            <Text style={styles.ownerText}>OWNER</Text>
          </View>
        )}
      </View>
    </GlassPanel>
  )
}

export default function BusinessTeamScreen({ navigation }) {
  const insets = useSafeAreaInsets()
  const isBiz = useIsBusinessPro()
  const [members, setMembers] = useState([])
  const [loading, setLoading] = useState(true)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviting, setInviting] = useState(false)

  const loadMembers = useCallback(async () => {
    setLoading(true)
    try {
      const data = await apiJson('/api/business/team')
      setMembers(data?.members ?? [])
    } catch {
      // Demo data
      setMembers([
        { id: '1', username: 'cafe.luna', email: 'owner@cafeluna.com', role: 'owner', joined_at: '2026-01-15T00:00:00Z' },
      ])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadMembers() }, [loadMembers])

  const invite = async () => {
    const email = inviteEmail.trim().toLowerCase()
    if (!email || !email.includes('@')) {
      Alert.alert('Invalid email', 'Enter a valid email address.')
      return
    }
    if (members.length >= MAX_MEMBERS) {
      Alert.alert('Team full', `You can have up to ${MAX_MEMBERS} team members on Business Pro.`)
      return
    }
    setInviting(true)
    try {
      await post('/api/business/team/invite', { email })
      Alert.alert('Invite sent', `An invite has been sent to ${email}.`)
      setInviteEmail('')
      loadMembers()
    } catch (e) {
      Alert.alert('Error', e?.message || 'Could not send invite.')
    } finally {
      setInviting(false)
    }
  }

  const removeMember = (member) => {
    Alert.alert(
      'Remove team member',
      `Remove ${member.username || member.email} from your business team? They'll lose access to your business profile.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            try {
              await del(`/api/business/team/${member.id}`)
              setMembers((prev) => prev.filter((m) => m.id !== member.id))
            } catch (e) {
              Alert.alert('Error', e?.message || 'Could not remove member.')
            }
          },
        },
      ],
    )
  }

  const spotsLeft = MAX_MEMBERS - members.length

  if (isBiz === false) {
    return (
      <View style={styles.screen}>
        <BrandHeader title="Team" onBack={() => navigation.goBack()} />
        <View style={styles.locked}>
          <Ionicons name="lock-closed" size={48} color={colors.textFaint} />
          <Text style={[type.title, { textAlign: 'center', marginTop: 16 }]}>Business Pro Only</Text>
          <Text style={[type.subhead, { textAlign: 'center', marginTop: 8, maxWidth: 300 }]}>
            Add up to {MAX_MEMBERS} staff accounts to manage your business profile together.
          </Text>
          <Pressable onPress={() => navigation.navigate('Subscription')} style={{ marginTop: 24 }}>
            <LinearGradient colors={['#10b981', '#059669']} style={styles.upgradeGrad}>
              <Text style={styles.upgradeText}>Upgrade to Business Pro</Text>
            </LinearGradient>
          </Pressable>
        </View>
      </View>
    )
  }

  return (
    <View style={styles.screen}>
      <BrandHeader title="Team" subtitle={`${members.length} of ${MAX_MEMBERS} members`} onBack={() => navigation.goBack()} />
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 24 }]}
        showsVerticalScrollIndicator={false}
      >
        {loading ? (
          <ActivityIndicator color={colors.textMuted} style={{ marginTop: 60 }} />
        ) : (
          <>
            {/* Member list */}
            <View style={{ gap: 10 }}>
              {members.map((m, i) => (
                <FadeIn key={m.id} index={i}>
                  <MemberCard member={m} onRemove={removeMember} isOwner={m.role === 'owner'} />
                </FadeIn>
              ))}
            </View>

            {/* Add member */}
            {spotsLeft > 0 && (
              <FadeIn index={members.length + 1} style={{ marginTop: 20 }}>
                <GlassPanel radius={radii.lg} lite animateIn={false}>
                  <View style={styles.addSection}>
                    <Text style={type.headline}>Add a team member</Text>
                    <Text style={[type.caption, { marginTop: 4, marginBottom: 14 }]}>
                      {spotsLeft} spot{spotsLeft === 1 ? '' : 's'} remaining. They'll be able to post, manage promotions, and respond on behalf of your business.
                    </Text>
                    <View style={styles.inviteRow}>
                      <TextInput
                        style={styles.input}
                        value={inviteEmail}
                        onChangeText={setInviteEmail}
                        placeholder="team@example.com"
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
                  <Text style={[type.label, { marginBottom: 10 }]}>Team member permissions</Text>
                  {[
                    { icon: 'checkmark-circle', text: 'View analytics dashboard' },
                    { icon: 'checkmark-circle', text: 'Create and manage promotions' },
                    { icon: 'checkmark-circle', text: 'Post to the feed' },
                    { icon: 'checkmark-circle', text: 'Respond to nearby visitors' },
                    { icon: 'close-circle', text: 'Change subscription or billing', no: true },
                    { icon: 'close-circle', text: 'Remove the account owner', no: true },
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
  locked: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  upgradeGrad: { paddingVertical: 14, paddingHorizontal: 28, borderRadius: 999, alignItems: 'center' },
  upgradeText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  // Member card
  memberCard: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 16 },
  avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.inkSurface, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.hairline },
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
