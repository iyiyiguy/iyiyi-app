import { useEffect, useState } from 'react'
import { View, Text, TextInput, Pressable, ActivityIndicator, Alert, StyleSheet } from 'react-native'
import * as Location from 'expo-location'
import { colors, radii, type } from '../theme'
import { apiJson, apiFetch, del } from '../lib/api'

// Shown on the edit-profile screen for Business profiles: claim your storefront's spot so
// it shows up as a pin on the Map. One location per business; the name can't be claimed
// twice at the same place.
export default function BusinessLocationCard() {
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
      if (status !== 'granted') return Alert.alert('Location needed', 'Allow location so we can pin your business where you are standing.')
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High })
      setCoords({ lat: loc.coords.latitude, lng: loc.coords.longitude })
    } finally {
      setBusy(false)
    }
  }

  const claim = async () => {
    const at = coords ?? (claimed ? { lat: claimed.latitude, lng: claimed.longitude } : null)
    if (!name.trim()) return Alert.alert('Business name', 'Enter your business name.')
    if (!at) return Alert.alert('Location', 'Stand at your business and tap "Use my current location" first.')
    setBusy(true)
    try {
      const res = await apiFetch('/api/profiles/me/business-location', {
        method: 'PUT',
        body: JSON.stringify({ name: name.trim(), address: address.trim(), lat: at.lat, lng: at.lng }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error || 'Could not save your business location.')
      setClaimed(body.location)
      setCoords(null)
      Alert.alert('Saved', 'Your business now shows on the map.')
    } catch (e) {
      Alert.alert("Couldn't save", e.message)
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
      <Text style={type.title}>Business location</Text>
      <Text style={[type.caption, { marginBottom: 12 }]}>
        Claim your storefront so people nearby can find you on the map. Stand at your business when you set it.
      </Text>
      <TextInput style={styles.input} value={name} onChangeText={setName} placeholder="Business name" placeholderTextColor={colors.textFaint} maxLength={80} />
      <TextInput style={styles.input} value={address} onChangeText={setAddress} placeholder="Address (optional)" placeholderTextColor={colors.textFaint} maxLength={160} />
      <Text style={[type.caption, { marginBottom: 10 }]}>
        {coords ? 'New spot captured from your current location.' : claimed ? 'Pinned on the map.' : 'No spot set yet.'}
      </Text>
      {busy ? <ActivityIndicator color={colors.magenta} /> : (
        <View style={{ flexDirection: 'row', gap: 10, flexWrap: 'wrap' }}>
          <Pressable style={styles.secondary} onPress={useHere}><Text style={styles.secondaryText}>Use my current location</Text></Pressable>
          <Pressable style={styles.primary} onPress={claim}><Text style={styles.primaryText}>{claimed ? 'Update' : 'Claim location'}</Text></Pressable>
          {claimed ? <Pressable onPress={remove} style={{ padding: 10 }}><Text style={{ color: colors.danger, fontWeight: '700' }}>Remove</Text></Pressable> : null}
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
