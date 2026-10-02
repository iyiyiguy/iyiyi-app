import { View, StyleSheet } from 'react-native'
import BrandHeader from '../components/BrandHeader'
import { WordGame } from '../games/WordGame'
import { colors } from '../theme'

export default function WordRaceScreen({ navigation }) {
  return (
    <View style={styles.screen}>
      <BrandHeader title="What's The Word" onBack={() => navigation.goBack()} />
      <WordGame onExit={() => navigation.goBack()} />
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: 'transparent' },
})
