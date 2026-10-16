// Map pin made from someone's best post: a photo card with their avatar on the corner and their
// name underneath (instead of the penguin, which stays for people without posts).
import { memo, useEffect, useState } from 'react'
import { Image, StyleSheet, Text, View } from 'react-native'
import { avatarSource } from '../lib/avatarSource'

function PostMarker({ username, avatarUrl, postUrl, selected = false, onReady, onFail }) {
  const [loaded, setLoaded] = useState(false)
  useEffect(() => { setLoaded(false) }, [postUrl])
  return (
    <View style={styles.wrap} collapsable={false}>
      <View style={[styles.card, selected && styles.cardSelected]}>
        <Image
          source={{ uri: postUrl }}
          style={styles.img}
          onLoadEnd={() => { setLoaded(true); onReady?.() }}
          onError={() => onFail?.()}
        />
        {!loaded ? <View style={[StyleSheet.absoluteFill, styles.loading]} /> : null}
      </View>
      <View style={styles.tail} />
      <View style={[styles.badge, selected && styles.badgeSelected]}>
        <Image source={avatarSource(avatarUrl)} style={styles.badgeImg} />
      </View>
      {username ? (
        <View style={[styles.label, selected && styles.labelSelected]}>
          <Text style={[styles.labelText, selected && styles.labelTextSelected]} numberOfLines={1}>{username}</Text>
        </View>
      ) : null}
    </View>
  )
}

export default memo(PostMarker)

const styles = StyleSheet.create({
  wrap: { width: 92, alignItems: 'center', paddingTop: 6 },
  card: {
    width: 62, height: 78, borderRadius: 12, overflow: 'hidden', backgroundColor: '#1d2540', borderWidth: 2.5, borderColor: '#fff',
    shadowColor: '#000', shadowOpacity: 0.35, shadowRadius: 6, shadowOffset: { width: 0, height: 3 },
  },
  cardSelected: { borderColor: '#ff4fa3', transform: [{ scale: 1.08 }] },
  img: { width: '100%', height: '100%' },
  loading: { backgroundColor: '#2b3660' },
  tail: { width: 10, height: 10, backgroundColor: '#fff', transform: [{ rotate: '45deg' }], marginTop: -6 },
  badge: { position: 'absolute', top: 0, right: 8, width: 26, height: 26, borderRadius: 13, borderWidth: 2, borderColor: '#fff', overflow: 'hidden', backgroundColor: '#5b6cf0' },
  badgeSelected: { borderColor: '#ff4fa3' },
  badgeImg: { width: '100%', height: '100%' },
  label: { marginTop: 3, paddingHorizontal: 7, paddingVertical: 2, borderRadius: 8, backgroundColor: 'rgba(13,15,20,0.78)', maxWidth: 92 },
  labelSelected: { backgroundColor: '#ff4fa3' },
  labelText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  labelTextSelected: { color: '#fff' },
})
