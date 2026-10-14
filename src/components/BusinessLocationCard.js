import { useEffect, useState } from 'react'
import { View, Text, TextInput, Pressable, ActivityIndicator, Alert, StyleSheet } from 'react-native'
import * as Location from 'expo-location'
import { colors, radii, type } from '../theme'
import { apiJson, apiFetch, del } from '../lib/api'
import { useT } from '../i18n'
import strings from '../i18n/strings/businessLocation'

// Shown on the edit-profile screen for Business profiles: claim your storefront's spot so
// it shows up as a pin on the Map. One location per business; the name can't be claimed
// twice at the same place.
export default function BusinessLocationCard() {
  const t = useT(strings)
  const [loaded, setLoaded] = useState(false)
  const [claimed, setClaimed] = useState(null)
  const [name, setName] = useState('')
  const [address, setAddress] = useState('')
  const [coords, setCoords] = useState(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    apiJson('/api/profiles/me/business-location')
      .then((d) => {
        setClaimed(d.location)
        if (d.location) {
          setName(d.location.name ?? '')
          setAddress(d.location.address ?? '')
        }
      })
      .catch(() => {})
      .finally(() => setLoaded(true))
  }, [])

  const useHere = async () => {
    setBusy(true)
    try {
      const { status } = await Location.requestForegroundPermissionsAsync()
      if (status !== 'granted') return Alert.alert(t('locationNeeded'), t('locationNeededMsg'))
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High })
      setCoords({ lat: loc.coords.latitude, lng: loc.coords.longitude })
    } finally {
      setBusy(false)
    }
  }

  const claim = async () => {
    const at = coords ?? (claimed ? { lat: claimed.latitude, lng: claimed.longitude } : null)
    if (!name.trim()) return Alert.alert(t('businessName'), t('enterName'))
    if (!at) return Alert.alert(t('location'), t('standFirst'))
    setBusy(true)
    try {
      const res = await apiFetch('/api/profiles/me/business-location', {
        method: 'PUT',
        body: JSON.stringify({ name: name.trim(), address: address.trim(), lat: at.lat, lng: at.lng }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error || t('saveFailedMsg'))
      setClaimed(body.location)
      setCoords(null)
      Alert.alert(t('saved'), t('savedMsg'))
    } catch (e) {
      Alert.alert(t('couldntSave'), e.message)
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    setBusy(true)
    try {
      await del('/api/profiles/me/business-location')
      setClaimed(null)
      setCoords(null)
    } finally {
      setBusy(false)
    }
  }

  if (!loaded) return null

  return (
    <View style={styles.card}>
      <Text style={type.title} accessibilityRole="header">{t('title')}</Text>
      <Text style={[type.caption, { marginBottom: 12 }]}>
        {t('intro')}
      </Text>
      <TextInput style={styles.input} value={name} onChangeText={setName} placeholder={t('businessName')} accessibilityLabel={t('businessName')} placeholderTextColor={colors.textFaint} maxLength={80} />
      <TextInput style={styles.input} value={address} onChangeText={setAddress} placeholder={t('addressOptional')} accessibilityLabel={t('addressOptional')} placeholderTextColor={colors.textFaint} maxLength={160} />
      <Text style={[type.caption, { marginBottom: 10 }]}>
        {coords ? t('newSpot') : claimed ? t('pinned') : t('noSpot')}
      </Text>
      {busy ? <ActivityIndicator color={colors.magenta} /> : (
        <View style={{ flexDirection: 'row', gap: 10, flexWrap: 'wrap' }}>
          <Pressable style={styles.secondary} onPress={useHere} accessibilityRole="button"><Text style={styles.secondaryText}>{t('useHere')}</Text></Pressable>
          <Pressable style={styles.primary} onPress={claim} accessibilityRole="button"><Text style={styles.primaryText}>{claimed ? t('update') : t('claim')}</Text></Pressable>
          {claimed ? <Pressable onPress={remove} style={{ padding: 10 }} hitSlop={6} accessibilityRole="button" accessibilityLabel={t('removeA11y')}><Text style={{ color: colors.danger, fontWeight: '700' }}>{t('remove')}</Text></Pressable> : null}
        </View>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  card: { marginHorizontal: 20, marginBottom: 20, padding: 16, borderRadius: radii.lg, backgroundColor: colors.inkSurface, borderWidth: 1, borderColor: colors.hairline },
  input: { borderWidth: 1, borderColor: colors.hairline, borderRadius: 12, padding: 12, color: colors.text, backgroundColor: colors.ink, marginBottom: 10 },
  primary: { backgroundColor: colors.magenta, paddingVertical: 11, paddingHorizontal: 18, borderRadius: radii.pill },
  primaryText: { color: colors.onBrand, fontWeight: '800' },
  secondary: { borderWidth: 1, borderColor: colors.magenta, paddingVertical: 10, paddingHorizontal: 16, borderRadius: radii.pill },
  secondaryText: { color: colors.magenta, fontWeight: '700' },
})
