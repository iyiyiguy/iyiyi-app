import { useCallback, useEffect, useState } from 'react'
import { DarkTheme, DefaultTheme, NavigationContainer, useNavigationContainerRef } from '@react-navigation/native'
import { createNativeStackNavigator } from '@react-navigation/native-stack'
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs'
import { StatusBar, useColorScheme } from 'react-native'
import { SafeAreaProvider, initialWindowMetrics } from 'react-native-safe-area-context'
import AsyncStorage from '@react-native-async-storage/async-storage'

import { colors } from './src/theme'
import { supabase } from './src/lib/supabase'
import { apiJson } from './src/lib/api'
import { initAttribution, logSignup } from './src/lib/attribution'
import { installWebPhoneFrame } from './src/lib/webPhoneFrame'
import { loadThemePref } from './src/lib/themePref'
import { ensureProfile, linkProviderToProfile } from './src/lib/oauth'
import { initCrashLogger, setupGlobalErrorHandler } from './src/lib/crashLogger'
import TabBar from './src/components/TabBar'
import InviteListener from './src/components/InviteListener'
import AuraBackground, { withAura } from './src/components/AuraBackground'
import { View } from 'react-native'

installWebPhoneFrame()
initCrashLogger()
setupGlobalErrorHandler()

import AuthScreen from './src/screens/AuthScreen'
import GuestExploreScreen from './src/screens/GuestExploreScreen'
import NearbyScreen from './src/screens/NearbyScreen'
import MyProfileScreen from './src/screens/MyProfileScreen'
import MapScreen from './src/screens/MapScreen'
import SettingsScreen from './src/screens/SettingsScreen'
import SubscriptionScreen from './src/screens/SubscriptionScreen'
import UserProfileScreen from './src/screens/UserProfileScreen'
import BlockedUsersScreen from './src/screens/BlockedUsersScreen'
import LocationConsentScreen from './src/screens/LocationConsentScreen'
import PublicProfileScreen from './src/screens/PublicProfileScreen'
import HistoryScreen from './src/screens/HistoryScreen'
import AirdropScreen from './src/screens/AirdropScreen'
import RecommendedScreen from './src/screens/RecommendedScreen'
import FollowListScreen from './src/screens/FollowListScreen'
import ContentFeedScreen from './src/screens/ContentFeedScreen'
import SavedContentScreen from './src/screens/SavedContentScreen'
import ViewersScreen from './src/screens/ViewersScreen'
import ActivityScreen from './src/screens/ActivityScreen'
import RecapScreen from './src/screens/RecapScreen'
import { useFlipToCamera, useFlipPref } from './src/lib/flipToCamera'
import StreamScreen from './src/screens/StreamScreen'
import ArcadeStoreScreen from './src/screens/ArcadeStoreScreen'
import CameraScreen from './src/screens/CameraScreen'
import TaggedScreen from './src/screens/TaggedScreen'
import TopProfilesScreen from './src/screens/TopProfilesScreen'
import ImportLinksScreen from './src/screens/ImportLinksScreen'
import PlatformFollowsScreen from './src/screens/PlatformFollowsScreen'
import EventsScreen from './src/screens/EventsScreen'
import CreateEventScreen from './src/screens/CreateEventScreen'
import EventDetailsScreen from './src/screens/EventDetailsScreen'
import JoinGameScreen from './src/screens/JoinGameScreen'
import GamesScreen from './src/screens/GamesScreen'
import GamePlayScreen from './src/screens/GamePlayScreen'
import GameLobbyScreen from './src/screens/GameLobbyScreen'
import LaserTagLobbyScreen from './src/screens/LaserTagLobbyScreen'
import GameLeaderboardScreen from './src/screens/GameLeaderboardScreen'
import PlayerProfileScreen from './src/screens/PlayerProfileScreen'
import GunShopScreen from './src/screens/GunShopScreen'
import ChessScreen from './src/screens/ChessScreen'
import WordRaceScreen from './src/screens/WordRaceScreen'

// Shared event links (iyiyi://event/<id>, https://iyiyi.xyz/e/<id>) open the event page.
const LINKING = {
  prefixes: ['iyiyi://', 'https://iyiyi.xyz', 'https://app.iyiyi.xyz'],
  config: {
    // Deep links land on top of the tab bar, so Back has somewhere to go.
    initialRouteName: 'Tabs',
    screens: {
      EventDetails: { path: 'event/:eventId', alias: ['e/:eventId'] },
      // Text invites: iyiyi://join/LABCD (or /j/LABCD) -> JoinGame auto-joins that lobby.
      JoinGame: { path: 'join/:code', alias: ['j/:code'] },
      // Shareable profile links: app.iyiyi.xyz/u/<username> (also works logged out).
      PublicProfile: { path: 'u/:username' },
    },
  },
}

const LOCATION_CONSENT_KEY = 'iyiyi_location_consent_seen'
const importSeenKey = (userId) => `iyiyi_import_prompt_seen_${userId}`

const Tab = createBottomTabNavigator()
const Stack = createNativeStackNavigator()

const screenOptions = { headerShown: false, contentStyle: { backgroundColor: colors.ink } }
// Tab scenes are transparent so the shared aura behind the tab navigator shows through.
const tabScreenOptions = { headerShown: false, sceneStyle: { backgroundColor: 'transparent' } }

// React Navigation v7 requires a full theme shape (colors + fonts). Builds
// 19-36 all crashed on launch with "Cannot read property 'regular' of
// undefined" inside native-stack's useHeaderConfigProps, because the old
// theme prop below was missing `fonts` entirely - Apple's own crash logs
// never showed this (they only report the resulting native abort, not the
// JS error that triggered it), so it took a custom native crash handler to
// finally capture the real message.
const darkNavTheme = { ...DarkTheme, colors: { ...DarkTheme.colors, background: '#0c0f1a', card: '#0c0f1a' } }
const lightNavTheme = { ...DefaultTheme, colors: { ...DefaultTheme.colors, background: '#e6eaf3', card: '#e6eaf3' } }

// Every pushed screen renders on the silk aura (camera / in-game screens stay full-bleed).
const Aura = {
  NearbyScreen: withAura(NearbyScreen),
  RecommendedScreen: withAura(RecommendedScreen),
  MyProfileScreen: withAura(MyProfileScreen),
  MapScreen: withAura(MapScreen),
  ContentFeedScreen: withAura(ContentFeedScreen),
  SettingsScreen: withAura(SettingsScreen),
  SubscriptionScreen: withAura(SubscriptionScreen),
  ActivityScreen: withAura(ActivityScreen),
  AirdropScreen: withAura(AirdropScreen),
  AuthScreen: withAura(AuthScreen),
  BlockedUsersScreen: withAura(BlockedUsersScreen),
  ChessScreen: withAura(ChessScreen),
  CreateEventScreen: withAura(CreateEventScreen),
  EventDetailsScreen: withAura(EventDetailsScreen),
  EventsScreen: withAura(EventsScreen),
  FollowListScreen: withAura(FollowListScreen),
  GameLeaderboardScreen: withAura(GameLeaderboardScreen),
  GameLobbyScreen: withAura(GameLobbyScreen),
  GamesScreen: withAura(GamesScreen),
  GunShopScreen: withAura(GunShopScreen),
  HistoryScreen: withAura(HistoryScreen),
  JoinGameScreen: withAura(JoinGameScreen),
  LaserTagLobbyScreen: withAura(LaserTagLobbyScreen),
  PlatformFollowsScreen: withAura(PlatformFollowsScreen),
  PlayerProfileScreen: withAura(PlayerProfileScreen),
  PublicProfileScreen: withAura(PublicProfileScreen),
  RecapScreen: withAura(RecapScreen),
  SavedContentScreen: withAura(SavedContentScreen),
  TaggedScreen: withAura(TaggedScreen),
  TopProfilesScreen: withAura(TopProfilesScreen),
  UserProfileScreen: withAura(UserProfileScreen),
  ViewersScreen: withAura(ViewersScreen),
  WordRaceScreen: withAura(WordRaceScreen),
  StreamScreen: withAura(StreamScreen),
  LocationConsentScreen: withAura(LocationConsentScreen),
  ImportLinksScreen: withAura(ImportLinksScreen),
}

function Tabs() {
  return (
    <View style={{ flex: 1 }}>
    <AuraBackground />
    <Tab.Navigator screenOptions={tabScreenOptions} tabBar={(props) => <TabBar {...props} />}>
      <Tab.Screen name="Nearby" component={Aura.NearbyScreen} />
      <Tab.Screen name="Recommended" component={Aura.RecommendedScreen} />
      <Tab.Screen name="MyProfile" component={Aura.MyProfileScreen} />
      <Tab.Screen name="Map" component={Aura.MapScreen} />
      <Tab.Screen name="Feed" component={Aura.ContentFeedScreen} />
      <Tab.Screen name="Games" component={Aura.GamesScreen} />
      <Tab.Screen name="Subscription" component={Aura.SubscriptionScreen} />
    </Tab.Navigator>
    </View>
  )
}

export default function App() {
  const [session, setSession] = useState(undefined)
  const [locationConsent, setLocationConsent] = useState(undefined)
  const [themeReady, setThemeReady] = useState(false)
  const [showImport, setShowImport] = useState(false)
  const scheme = useColorScheme()
  const navRef = useNavigationContainerRef()
  const flipOn = useFlipPref()

  useEffect(() => {
    loadThemePref().then(() => setThemeReady(true))
    initAttribution()
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      setSession(session)
      // On web, sign-in via a social provider redirects the whole page away
      // and back — there's no in-memory callback left to run the
      // link-provider-to-profile step, so do it here instead, keyed off the
      // session's own provider metadata. (No-op for email/phone sign-in.)
      if (event === 'SIGNED_IN' && session?.user) {
        ensureProfile(session.user)
          .then(() => linkProviderToProfile(session.user.app_metadata?.provider, session.user))
          .catch((e) => console.warn('ensureProfile failed', e?.message ?? e))
      }
    })
    AsyncStorage.getItem(LOCATION_CONSENT_KEY).then((v) => setLocationConsent(v === 'true'))
  }, [])

  const userId = session?.user?.id
  const openCamera = useCallback(() => {
    if (navRef.isReady() && navRef.getCurrentRoute()?.name !== 'Camera') navRef.navigate('Camera')
  }, [navRef])
  useFlipToCamera(openCamera, !!userId && flipOn)
  useEffect(() => {
    if (!userId || !locationConsent) return
    let cancelled = false
    ;(async () => {
      try {
        if (await AsyncStorage.getItem(importSeenKey(userId))) return
        const profile = await apiJson('/api/profiles/me')
        const hasLinks = (profile.social_links?.length ?? 0) > 0 || (profile.websites?.length ?? 0) > 0
        if (hasLinks) await AsyncStorage.setItem(importSeenKey(userId), 'true')
        else if (!cancelled) setShowImport(true)
      } catch {
        // If we can't tell, don't block the app with an optional step.
      }
    })()
    return () => { cancelled = true }
  }, [userId, locationConsent])

  const finishImport = () => {
    if (userId) AsyncStorage.setItem(importSeenKey(userId), 'true')
    setShowImport(false)
  }

  const acceptLocationConsent = () => {
    AsyncStorage.setItem(LOCATION_CONSENT_KEY, 'true')
    setLocationConsent(true)
  }

  if (!themeReady || session === undefined) return null
  if (session && locationConsent === undefined) return null

  return (
    <SafeAreaProvider initialMetrics={initialWindowMetrics}>
      <StatusBar barStyle={scheme === 'light' ? 'dark-content' : 'light-content'} />
      <NavigationContainer ref={navRef} linking={LINKING} theme={scheme === 'light' ? lightNavTheme : darkNavTheme}>
        {!session ? (
          <Stack.Navigator screenOptions={screenOptions}>
            <Stack.Screen name="Explore" component={GuestExploreScreen} />
            <Stack.Screen name="SignIn" component={Aura.AuthScreen} />
            <Stack.Screen name="PublicProfile" component={Aura.PublicProfileScreen} />
          </Stack.Navigator>
        ) : !locationConsent ? (
          <Aura.LocationConsentScreen onContinue={acceptLocationConsent} />
        ) : showImport ? (
          <Aura.ImportLinksScreen onDone={finishImport} />
        ) : (
          <Stack.Navigator screenOptions={screenOptions}>
            <Stack.Screen name="Tabs" component={Tabs} />
            <Stack.Screen name="UserProfile" component={Aura.UserProfileScreen} />
            <Stack.Screen name="PublicProfile" component={Aura.PublicProfileScreen} />
            <Stack.Screen name="BlockedUsers" component={Aura.BlockedUsersScreen} />
            <Stack.Screen name="History" component={Aura.HistoryScreen} />
            <Stack.Screen name="FollowList" component={Aura.FollowListScreen} />
            <Stack.Screen name="SavedContent" component={Aura.SavedContentScreen} />
            <Stack.Screen name="Viewers" component={Aura.ViewersScreen} />
            <Stack.Screen name="Activity" component={Aura.ActivityScreen} />
            <Stack.Screen name="Recap" component={Aura.RecapScreen} />
            <Stack.Screen name="Camera" component={CameraScreen} options={{ presentation: 'transparentModal', animation: 'fade', contentStyle: { backgroundColor: 'transparent' } }} />
            <Stack.Screen name="Tagged" component={Aura.TaggedScreen} />
            <Stack.Screen name="PlatformFollows" component={Aura.PlatformFollowsScreen} />
            <Stack.Screen name="TopProfiles" component={Aura.TopProfilesScreen} />
            <Stack.Screen name="Airdrop" component={Aura.AirdropScreen} />
            <Stack.Screen name="Events" component={Aura.EventsScreen} />
            <Stack.Screen name="CreateEvent" component={Aura.CreateEventScreen} />
            <Stack.Screen name="EventDetails" component={Aura.EventDetailsScreen} />
            <Stack.Screen name="JoinGame" component={Aura.JoinGameScreen} />
            <Stack.Screen name="Settings" component={Aura.SettingsScreen} />
            <Stack.Screen name="Stream" component={Aura.StreamScreen} />
            <Stack.Screen name="ArcadeStore" component={ArcadeStoreScreen} />
            <Stack.Screen name="GamePlayScreen" component={GamePlayScreen} options={{ gestureEnabled: false }} />
            <Stack.Screen name="GameLobby" component={Aura.GameLobbyScreen} />
            <Stack.Screen name="LaserTagLobby" component={Aura.LaserTagLobbyScreen} />
            <Stack.Screen name="GameLeaderboard" component={Aura.GameLeaderboardScreen} />
            <Stack.Screen name="PlayerProfile" component={Aura.PlayerProfileScreen} />
            <Stack.Screen name="GunShop" component={Aura.GunShopScreen} />
            <Stack.Screen name="Chess" component={Aura.ChessScreen} />
            <Stack.Screen name="WordRace" component={Aura.WordRaceScreen} />
          </Stack.Navigator>
        )}
        {/* Game challenges from other users (inbox:<myId>), only once fully signed in. */}
        {session && locationConsent && !showImport ? <InviteListener key={userId} navRef={navRef} /> : null}
      </NavigationContainer>
    </SafeAreaProvider>
  )
}
