import { View, StyleSheet } from 'react-native'
import BrandHeader from '../components/BrandHeader'
import ImportLinksPanel from '../components/ImportLinksPanel'
import { colors } from '../theme'
import { apiJson, patch } from '../lib/api'
import { mergeLinks } from '../lib/importLinks'

// Shown once, right after sign-up, before the main app. Skippable; the same import
// is also available from Edit Profile. Links are saved straight to the profile.
export default function ImportLinksScreen({ onDone }) {
  const save = async (imported) => {
    const current = await apiJson('/api/profiles/me')
    await patch('/api/profiles/me', mergeLinks(current, imported))
    onDone()
  }

  return (
    <View style={styles.screen}>
      <BrandHeader title="Import your links" />
      <View style={{ height: 16 }} />
      <ImportLinksPanel
        intro="Already have a Linktree or similar page? Paste it and we'll fill in your social links for you. You can change anything later in Edit Profile."
        importLabel="Add to my profile"
        onImport={save}
        onSkip={onDone}
      />
    </View>
  )
}

const styles = StyleSheet.create({ screen: { flex: 1, backgroundColor: 'transparent' } })
