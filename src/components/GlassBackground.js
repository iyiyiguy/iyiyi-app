import { StyleSheet, View } from 'react-native'
import AuraBackground from './AuraBackground'

// Full-size container that paints the silk aura behind its children. Most screens get the
// aura from App.js already; this is for full-bleed screens (camera, in-game) that opt in.
export const GlassBackground = ({ children, style }) => (
  <View style={[styles.container, style]}>
    <AuraBackground />
    {children}
  </View>
)

export default GlassBackground

const styles = StyleSheet.create({ container: { flex: 1 } })
