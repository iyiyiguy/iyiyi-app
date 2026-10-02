import { View, Text, StyleSheet } from 'react-native'
import GlassPanel from './GlassPanel'
import { colors, radii, type } from '../theme'

// A record card: title row plus a grid of { label, value } stats.
// Props: title, icon?, subtitle?, stats: [{ label, value, color? }], children?
export function RankingCard({ title, icon, subtitle, stats = [], children }) {
  return (
    <GlassPanel style={styles.card} radius={radii.md} animateIn={false}>
      <View style={styles.header}>
        {icon ? <Text style={styles.icon}>{icon}</Text> : null}
        <View style={{ flex: 1 }}>
          <Text style={styles.title} numberOfLines={1}>{title}</Text>
          {subtitle ? <Text style={styles.subtitle} numberOfLines={1}>{subtitle}</Text> : null}
        </View>
      </View>
      {stats.length > 0 && (
        <View style={styles.grid}>
          {stats.map((s) => (
            <View key={s.label} style={styles.statBox}>
              <Text style={[styles.statValue, s.color && { color: s.color }]} numberOfLines={1}>{s.value}</Text>
              <Text style={styles.statLabel} numberOfLines={1}>{s.label}</Text>
            </View>
          ))}
        </View>
      )}
      {children}
    </GlassPanel>
  )
}

export default RankingCard

const styles = StyleSheet.create({
  card: { padding: 14, marginBottom: 12 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  icon: { fontSize: 26 },
  title: { ...type.title, fontSize: 17 },
  subtitle: { ...type.caption },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  statBox: { flexGrow: 1, minWidth: '22%', alignItems: 'center', paddingVertical: 8, borderRadius: radii.sm, backgroundColor: colors.inkSurface },
  statValue: { ...type.body, fontWeight: '800' },
  statLabel: { ...type.label, fontSize: 9, marginTop: 2 },
})
