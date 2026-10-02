// One way to open anyone's profile from anywhere in the app: another user goes to the
// UserProfile stack screen (pushed, so profile -> profile keeps a back trail), and your
// own id goes to the MyProfile tab instead.
import { useCallback, useContext, useEffect, useState } from 'react'
import { NavigationContext, StackActions } from '@react-navigation/native'
import { supabase } from './supabase'

export async function getMyUserId() {
  try {
    const { data } = await supabase.auth.getSession()
    return data?.session?.user?.id ?? null
  } catch {
    return null
  }
}

export function useMyUserId() {
  const [id, setId] = useState(null)
  useEffect(() => {
    let alive = true
    getMyUserId().then((v) => { if (alive) setId(v) })
    return () => { alive = false }
  }, [])
  return id
}

export async function openProfile(navigation, userId) {
  if (!navigation || !userId) return
  const me = await getMyUserId()
  if (me && userId === me) {
    // pop: go back to the existing Tabs route rather than stacking a second one.
    navigation.navigate('Tabs', { screen: 'MyProfile' }, { pop: true })
  } else {
    navigation.dispatch(StackActions.push('UserProfile', { userId }))
  }
}

// For components that aren't handed `navigation` (feed tiles, viewers, sheets). Reads the
// context directly (not useNavigation) so it's a harmless no-op outside a navigator.
export function useOpenProfile() {
  const navigation = useContext(NavigationContext)
  return useCallback((userId) => openProfile(navigation, userId), [navigation])
}
