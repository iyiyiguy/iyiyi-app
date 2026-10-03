import AsyncStorage from '@react-native-async-storage/async-storage'

// Location on posts: city only (never a street or place name), and only when the person
// allows it (Settings > "Show location on my photos", on by default).

const KEY = 'iyiyi_show_photo_location_v1'

export async function loadShowPhotoLocation() {
  try {
    const v = await AsyncStorage.getItem(KEY)
    return v == null ? true : v === 'true'
  } catch {
    return true
  }
}

export async function saveShowPhotoLocation(on) {
  try {
    await AsyncStorage.setItem(KEY, on ? 'true' : 'false')
  } catch {}
}

// From expo-location's reverseGeocode result.
export function cityLabel(place) {
  if (!place) return null
  const city = place.city || place.subregion || place.district || place.region
  return city ? String(city).slice(0, 80) : null
}

// Older posts stored "Place, City, State": show just the city.
export function displayCity(label) {
  if (typeof label !== 'string' || !label.trim()) return null
  const parts = label.split(',').map((s) => s.trim()).filter(Boolean)
  if (parts.length >= 3) return parts[parts.length - 2]
  return parts[0]
}
