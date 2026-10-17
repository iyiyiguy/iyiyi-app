import { useCallback, useEffect, useRef, useState } from 'react'
import { DarkTheme, DefaultTheme, NavigationContainer, useNavigationContainerRef } from '@react-navigation/native'
import { createNativeStackNavigator } from '@react-navigation/native-stack'
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs'
import { ErrorBoundary as ScreenErrorBoundary } from './src/components/ErrorBoundary'
import { Platform, StatusBar, useColorScheme } from 'react-native'
import { enableScreens } from 'react-native-screens'
import { SafeAreaProvider, initialWindowMetrics, useSafeAreaInsets } from 'react-native-safe-area-context'
import AsyncStorage from '@react-native-async-storage/async-storage'

import { colors } from './src/theme'
import { lazyScreen } from './src/lib/lazyScreen'
import { supabase } from './src/lib/supabase'
import { apiJson } from './src/lib/api'
import { initAttribution, logSignup, setUser as setAttributionUser, logOnboardingDone } from './src/lib/attribution'
import { installWebPhoneFrame } from './src/lib/webPhoneFrame'
import { loadThemePref } from './src/lib/themePref'
import { loadLanguage, useLanguage } from './src/i18n'
import LanguageScreen from './src/screens/LanguageScreen'
import { useStudioFonts } from './src/games/studio' // 1.4.1
import { ensureProfile, linkProviderToProfile } from './src/lib/oauth'
import { initCrashLogger, setupGlobalErrorHandler } from './src/lib/crashLogger'
import TabBar from './src/components/TabBar'
import MusicDock from './src/components/MusicDock'
import GuestTabBar, { GuestSignupPill, guestTabBarHeight } from './src/components/GuestTabBar'
import InviteListener from './src/components/InviteListener'
import AuraBackground, { withAura } from './src/components/AuraBackground'
import { View } from 'react-native'

installWebPhoneFrame()
initCrashLogger()
setupGlobalErrorHandler()

import AuthScreen from './src/screens/AuthScreen'
import GuestExploreScreen from './src/screens/GuestExploreScreen'
import GuestRecommendedScreen from './src/screens/GuestRecommendedScreen'
import GuestFeedScreen from './src/screens/GuestFeedScreen'
import GuestLockedScreen from './src/screens/GuestLockedScreen'
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
const AirdropScreen = lazyScreen(() => import('./src/screens/AirdropScreen'))
import RecommendedScreen, { RecommendedRedirect } from './src/screens/RecommendedScreen'
import FollowListScreen from './src/screens/FollowListScreen'
import ContentFeedScreen from './src/screens/ContentFeedScreen'
import SavedContentScreen from './src/screens/SavedContentScreen'
import ViewersScreen from './src/screens/ViewersScreen'
import ActivityScreen from './src/screens/ActivityScreen'
const RecapScreen = lazyScreen(() => import('./src/screens/RecapScreen'))
import { useFlipToCamera, useFlipPref } from './src/lib/flipToCamera'
const StreamScreen = lazyScreen(() => import('./src/screens/StreamScreen'))
const ArcadeStoreScreen = lazyScreen(() => import('./src/screens/ArcadeStoreScreen'))
const StudioHomeScreen = lazyScreen(() => import('./src/screens/StudioHomeScreen'))
const StudioScreen = lazyScreen(() => import('./src/screens/StudioScreen'))
const MusicHomeScreen = lazyScreen(() => import('./src/screens/MusicHomeScreen'))
const NowPlayingScreen = lazyScreen(() => import('./src/screens/NowPlayingScreen'))
const SoundScreen = lazyScreen(() => import('./src/screens/SoundScreen'))
const MusicScreen = lazyScreen(() => import('./src/screens/MusicScreen'))
const CopyrightReviewScreen = lazyScreen(() => import('./src/screens/CopyrightReviewScreen'))
const CameraScreen = lazyScreen(() => import('./src/screens/CameraScreen'))
import TaggedScreen from './src/screens/TaggedScreen'
import TopProfilesScreen from './src/screens/TopProfilesScreen'
import ImportLinksScreen from './src/screens/ImportLinksScreen'
import OnboardingIntentScreen, { loadSavedIntent } from './src/screens/OnboardingIntentScreen'
import OnboardingNametagScreen, { needsNametag } from './src/screens/OnboardingNametagScreen'
import PlatformFollowsScreen from './src/screens/PlatformFollowsScreen'
import EventsScreen from './src/screens/EventsScreen'
const CreateEventScreen = lazyScreen(() => import('./src/screens/CreateEventScreen'))
const EventDetailsScreen = lazyScreen(() => import('./src/screens/EventDetailsScreen'))
const JoinGameScreen = lazyScreen(() => import('./src/screens/JoinGameScreen'))
import GamesScreen from './src/screens/GamesScreen'
const GamePlayScreen = lazyScreen(() => import('./src/screens/GamePlayScreen'))
const GameLobbyScreen = lazyScreen(() => import('./src/screens/GameLobbyScreen'))
const LaserTagLobbyScreen = lazyScreen(() => import('./src/screens/LaserTagLobbyScreen'))
const GameLeaderboardScreen = lazyScreen(() => import('./src/screens/GameLeaderboardScreen'))
const PlayerProfileScreen = lazyScreen(() => import('./src/screens/PlayerProfileScreen'))
const GunShopScreen = lazyScreen(() => import('./src/screens/GunShopScreen'))
const MyEquipScreen = lazyScreen(() => import('./src/screens/MyEquipScreen'))
const ChessScreen = lazyScreen(() => import('./src/screens/ChessScreen'))
const WordRaceScreen = lazyScreen(() => import('./src/screens/WordRaceScreen'))
const BusinessDashboardScreen = lazyScreen(() => import('./src/screens/BusinessDashboardScreen'))
const PromotedPlacementScreen = lazyScreen(() => import('./src/screens/PromotedPlacementScreen'))
const BusinessQRScreen = lazyScreen(() => import('./src/screens/BusinessQRScreen'))
const BusinessTeamScreen = lazyScreen(() => import('./src/screens/BusinessTeamScreen'))

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
      // Shared sound links: app.iyiyi.xyz/sound/<id>.
      Sound: { path: 'sound/:soundId' },
      // Music and The Lab open for everyone, also signed out: app.iyiyi.xyz/music, /lab.
      MusicHome: { path: 'music' },
      Studio: { path: 'lab' },
    },
  },
}

const LOCATION_CONSENT_KEY = 'iyiyi_location_consent_seen' // legacy, per device
const locationConsentKey = (uid) => `iyiyi_location_consent_seen_${uid}`
const launchesKey = (uid) => `iyiyi_member_launches_${uid}`
const paywallSeenKey = (uid) => `iyiyi_paywall_seen_${uid}`
const importSeenKey = (userId) => `iyiyi_import_prompt_seen_${userId}`
const intentSeenKey = (uid) => `iyiyi_onboarding_intent_seen_${uid}`
const nametagSeenKey = (uid) => `iyiyi_onboarding_nametag_seen_${uid}`
const OnboardingIntent = withAura(OnboardingIntentScreen)
const OnboardingNametag = withAura(OnboardingNametagScreen)

const Tab = createBottomTabNavigator()
// Every screen renders inside its own error boundary: a bug on one screen shows a
// "Something went wrong" card with Go back, instead of closing the whole app.
const screenLayout = ({ children, route, navigation }) => (
  <ScreenErrorBoundary screen={route.name} onBack={() => (navigation.canGoBack() ? navigation.goBack() : null)}>{children}</ScreenErrorBoundary>
)
const Stack = createNativeStackNavigator()
// Web: react-native-screens is off by default, and then bottom tabs only stack inactive tabs
// behind the active one (zIndex -1) instead of hiding them. Tab scenes are transparent (the aura
// shows through), so every visited tab showed through the current one and caught scrolls.
if (Platform.OS === 'web') enableScreens(true)

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
  LanguageScreen: withAura(LanguageScreen),
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
  MyEquipScreen: withAura(MyEquipScreen),
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
  BusinessDashboardScreen: withAura(BusinessDashboardScreen),
  PromotedPlacementScreen: withAura(PromotedPlacementScreen),
  BusinessQRScreen: withAura(BusinessQRScreen),
  BusinessTeamScreen: withAura(BusinessTeamScreen),
}

// Five labelled tabs: Here · Feed · Camera · Arcade · Me (see TabBar). "Here" is the Nearby
// route with a List / Map switch: Map stays a tab route of its own (kept mounted, so flipping
// back and forth is instant) and Recommended (the old Discover tab) redirects to Here's
// Recommended sort - both names stay registered so existing navigate() calls and links work.
// Camera is not a tab route: the centre button opens the Camera stack screen.
// The single aura behind the navigator serves every tab, so tab screens aren't wrapped again.
function Tabs() {
  return (
    <View style={{ flex: 1 }}>
    <AuraBackground />
    <Tab.Navigator screenLayout={screenLayout} screenOptions={tabScreenOptions} tabBar={(props) => <TabBar {...props} />}>
      <Tab.Screen name="Nearby" component={NearbyScreen} />
      <Tab.Screen name="Feed" component={ContentFeedScreen} />
      <Tab.Screen name="Games" component={GamesScreen} />
      <Tab.Screen name="MyProfile" component={MyProfileScreen} />
      <Tab.Screen name="Map" component={MapScreen} />
      <Tab.Screen name="Recommended" component={RecommendedRedirect} />
    </Tab.Navigator>
    <MusicDock />
    </View>
  )
}

// Logged-out visitors (app and app.iyiyi.xyz) get a tab bar that looks like the real one:
// Explore, Discover (Recommended), Feed with public content, plus Camera and Arcade, which are
// visible but only show a "Sign up to ..." screen. A floating "Sign up free" pill sits just
// above the bar on the browsing tabs. Named "Tabs" (like the member navigator) so deep links,
// whose initial route is Tabs, also work logged out.
const Guest = {
  RecommendedScreen: withAura(GuestRecommendedScreen),
  FeedScreen: withAura(GuestFeedScreen),
  LockedScreen: withAura(GuestLockedScreen),
}
const GUEST_LOCKED_TABS = new Set(['Camera', 'Arcade'])

function GuestTabs({ navigation }) {
  const insets = useSafeAreaInsets()
  const [current, setCurrent] = useState('Explore')
  return (
    <View style={{ flex: 1 }}>
      <AuraBackground />
      <Tab.Navigator
        screenLayout={screenLayout}
        screenOptions={tabScreenOptions}
        tabBar={(props) => <GuestTabBar {...props} />}
        screenListeners={({ route }) => ({ focus: () => setCurrent(route.name) })}
      >
        <Tab.Screen name="Explore" component={GuestExploreScreen} />
        <Tab.Screen name="Recommended" component={Guest.RecommendedScreen} />
        <Tab.Screen name="Feed" component={Guest.FeedScreen} />
        <Tab.Screen name="Arcade" component={Guest.LockedScreen} initialParams={{ kind: 'arcade' }} />
        <Tab.Screen name="Camera" component={Guest.LockedScreen} initialParams={{ kind: 'camera' }} />
      </Tab.Navigator>
      {GUEST_LOCKED_TABS.has(current) ? null : (
        <GuestSignupPill bottom={guestTabBarHeight(insets) + 12} onPress={() => navigation.navigate('SignIn', { mode: 'signup' })} />
      )}
      {GUEST_LOCKED_TABS.has(current) ? null : <MusicDock bottom={guestTabBarHeight(insets) + 70} />}
    </View>
  )
}

export default function App() {
  useStudioFonts() // game HUD fonts; loads in the background, games fall back to system text until ready
  const [session, setSession] = useState(undefined)
  const [locationConsent, setLocationConsent] = useState(undefined)
  const [themeReady, setThemeReady] = useState(false)
  const [langState, setLangState] = useState(null) // { chosen } once loaded
  const language = useLanguage()
  const [showImport, setShowImport] = useState(false)
  const [showPaywall, setShowPaywall] = useState(false)
  const scheme = useColorScheme()
  const navRef = useNavigationContainerRef()
  const flipOn = useFlipPref()

  useEffect(() => {
    loadThemePref().then(() => setThemeReady(true))
    loadLanguage().then(({ chosen, supported }) => setLangState({ chosen: chosen || supported })).catch(() => setLangState({ chosen: true }))
    initAttribution()
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      setSession(session)
      if (session?.user?.id) setAttributionUser(session.user.id)
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
  }, [])

  const userId = session?.user?.id
  // Location explainer is per account (a second account on the same phone still sees it).
  // People who saw the old per-device screen aren't shown it again.
  useEffect(() => {
    if (!userId) { setLocationConsent(undefined); return }
    let cancelled = false
    Promise.all([AsyncStorage.getItem(locationConsentKey(userId)), AsyncStorage.getItem(LOCATION_CONSENT_KEY)])
      .then(([mine, legacy]) => { if (!cancelled) setLocationConsent(mine === 'true' || legacy === 'true') })
      .catch(() => { if (!cancelled) setLocationConsent(true) })
    return () => { cancelled = true }
  }, [userId])
  const openCamera = useCallback(() => {
    if (navRef.isReady() && navRef.getCurrentRoute()?.name !== 'Camera') navRef.navigate('Camera')
  }, [navRef])
  useFlipToCamera(openCamera, !!userId && flipOn)
  // Onboarding order after sign-up: "What brings you here?" (intent) -> "Your nametag" (photo,
  // name, @handle) -> social handles / Linktree import -> location (explainer, then the phone's
  // prompt from its Continue button) -> the app. Each step shows once per account (AsyncStorage
  // keyed by user id) and only when it's needed: intent until answered or skipped, nametag when
  // the photo or a self-chosen username is missing, socials when the profile has no links.
  // Members who already finished the old onboarding (location step done) aren't shown the new
  // intent / nametag steps. The Pro offer is not part of onboarding; it shows once, from the
  // second time the app is opened (defaulting to Business Pro for businesses).
  const [importChecked, setImportChecked] = useState(false)
  const [showIntent, setShowIntent] = useState(false)
  const [showNametag, setShowNametag] = useState(false)
  const [onboardProfile, setOnboardProfile] = useState(null)
  const [intent, setIntent] = useState(null)
  const [planned, setPlanned] = useState({}) // steps in this run, for the progress bars
  const sessionUser = session?.user ?? null
  useEffect(() => {
    setImportChecked(false)
    setShowIntent(false)
    setShowNametag(false)
    setShowImport(false)
    setOnboardProfile(null)
    setIntent(null)
    setPlanned({})
    if (!userId) return
    let cancelled = false
    // Never hold the app on a slow network: after 4 s carry on without the optional steps.
    let timedOut = false
    const giveUp = setTimeout(() => { timedOut = true; if (!cancelled) setImportChecked(true) }, 4000)
    const live = () => !cancelled && !timedOut
    ;(async () => {
      try {
        const [importSeen, intentSeen, nametagSeen, consentMine, consentLegacy] = await Promise.all([
          AsyncStorage.getItem(importSeenKey(userId)),
          AsyncStorage.getItem(intentSeenKey(userId)),
          AsyncStorage.getItem(nametagSeenKey(userId)),
          AsyncStorage.getItem(locationConsentKey(userId)),
          AsyncStorage.getItem(LOCATION_CONSENT_KEY),
        ])
        const savedIntent = await loadSavedIntent(sessionUser)
        if (!cancelled && savedIntent) setIntent(savedIntent)
        const veteran = consentMine === 'true' || consentLegacy === 'true'
        const wantIntent = !intentSeen && !veteran && !savedIntent
        const checkNametag = !nametagSeen && !veteran
        if (wantIntent && live()) {
          setShowIntent(true)
          setPlanned((p) => ({ ...p, intent: true }))
        }
        if (importSeen && !checkNametag) return
        const profile = await apiJson('/api/profiles/me')
        if (!live()) return
        setOnboardProfile(profile)
        if (checkNametag) {
          if (needsNametag(profile, sessionUser)) {
            setShowNametag(true)
            setPlanned((p) => ({ ...p, nametag: true }))
          } else AsyncStorage.setItem(nametagSeenKey(userId), 'true').catch(() => {})
        }
        if (!importSeen) {
          const hasLinks = (profile.social_links?.length ?? 0) > 0 || (profile.websites?.length ?? 0) > 0
          if (hasLinks) await AsyncStorage.setItem(importSeenKey(userId), 'true')
          else if (live()) {
            setShowImport(true)
            setPlanned((p) => ({ ...p, import: true }))
          }
        }
      } catch {
        // If we can't tell, don't block the app with an optional step.
      } finally {
        if (!cancelled) setImportChecked(true)
      }
    })()
    return () => { cancelled = true; clearTimeout(giveUp) }
    // sessionUser is read for this user id only; token refreshes mustn't re-run onboarding.
  }, [userId]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (locationConsent === false) setPlanned((p) => (p.location ? p : { ...p, location: true }))
  }, [locationConsent])
  const flowSteps = ['intent', 'nametag', 'import', 'location'].filter((s) => planned[s])
  const stepProps = (name) => ({ step: flowSteps.indexOf(name) + 1, total: flowSteps.length })

  // One-time Pro offer, after people have used the app: shown on app open from the second
  // launch as a member (never during first-run onboarding). Dismissible with "Not now" or
  // the close button, and skipped for people who are already Pro.
  const launchCounted = useRef(null)
  useEffect(() => {
    if (!userId || !locationConsent || showImport || showIntent || showNametag || !importChecked) return
    let cancelled = false
    ;(async () => {
      try {
        if (await AsyncStorage.getItem(paywallSeenKey(userId))) return
        let n = parseInt((await AsyncStorage.getItem(launchesKey(userId))) || '0', 10) || 0
        if (launchCounted.current !== userId) {
          launchCounted.current = userId
          n += 1
          await AsyncStorage.setItem(launchesKey(userId), String(n))
        }
        if (!cancelled && n >= 2) setShowPaywall(true)
      } catch {}
    })()
    return () => { cancelled = true }
  }, [userId, locationConsent, showImport, showIntent, showNametag, importChecked])

  const finishPaywall = () => {
    if (userId) AsyncStorage.setItem(paywallSeenKey(userId), 'true').catch(() => {})
    setShowPaywall(false)
  }

  const finishImport = () => {
    if (userId) AsyncStorage.setItem(importSeenKey(userId), 'true').catch(() => {})
    setShowImport(false)
  }

  // picked: 'business' | 'creator' | 'player' | 'explore', or null when skipped (saved by the
  // screen). 'explore' (just looking around) skips the nametag and social-links steps too.
  const finishIntent = (picked) => {
    if (userId) AsyncStorage.setItem(intentSeenKey(userId), 'true').catch(() => {})
    if (picked) setIntent(picked)
    if (picked === 'explore') {
      if (userId) {
        AsyncStorage.setItem(nametagSeenKey(userId), 'true').catch(() => {})
        AsyncStorage.setItem(importSeenKey(userId), 'true').catch(() => {})
      }
      setShowNametag(false)
      setShowImport(false)
      setPlanned((p) => ({ intent: p.intent, location: p.location }))
    }
    setShowIntent(false)
  }

  // "Skip setup" on any onboarding step: straight into the app. Nothing more is asked here;
  // location is asked in context by Nearby/Map, and the profile can be filled in Edit Profile.
  const skipOnboarding = () => {
    logOnboardingDone(intent ? `${intent}_skipped` : 'skipped')
    if (userId) {
      for (const k of [intentSeenKey, nametagSeenKey, importSeenKey, locationConsentKey]) AsyncStorage.setItem(k(userId), 'true').catch(() => {})
    }
    setShowIntent(false)
    setShowNametag(false)
    setShowImport(false)
    setLocationConsent(true)
  }

  const finishNametag = () => {
    if (userId) AsyncStorage.setItem(nametagSeenKey(userId), 'true').catch(() => {})
    setShowNametag(false)
  }

  const acceptLocationConsent = () => {
    logOnboardingDone(intent)
    if (userId) AsyncStorage.setItem(locationConsentKey(userId), 'true').catch(() => {})
    setLocationConsent(true)
  }

  if (!themeReady || session === undefined || !langState) return null
  if (session && (locationConsent === undefined || !importChecked)) return null

  return (
    <SafeAreaProvider initialMetrics={initialWindowMetrics}>
      <StatusBar barStyle={scheme === 'light' ? 'dark-content' : 'light-content'} />
      <NavigationContainer ref={navRef} linking={LINKING} theme={scheme === 'light' ? lightNavTheme : darkNavTheme}>
        {!langState.chosen ? (
          // First launch: pick a language before anything else.
          <Aura.LanguageScreen onDone={() => setLangState({ chosen: true })} />
        ) : !session ? (
          // Keyed so signing in/out mounts a fresh navigator (both have a "Tabs" route).
          <Stack.Navigator key="guest" screenLayout={screenLayout} screenOptions={screenOptions}>
            <Stack.Screen name="Tabs" component={GuestTabs} />
            <Stack.Screen name="SignIn" component={Aura.AuthScreen} />
            <Stack.Screen name="PublicProfile" component={Aura.PublicProfileScreen} />
            <Stack.Screen name="Sound" component={SoundScreen} />
            {/* Open to everyone (also on the website): listen to music and make beats without an account. */}
            <Stack.Screen name="MusicHome" component={MusicHomeScreen} options={{ animation: 'slide_from_bottom' }} />
            <Stack.Screen name="NowPlaying" component={NowPlayingScreen} options={{ presentation: 'fullScreenModal', animation: 'slide_from_bottom' }} />
            <Stack.Screen name="Music" component={MusicScreen} />
            <Stack.Screen name="Studio" component={StudioHomeScreen} />
            <Stack.Screen name="StudioEditor" component={StudioScreen} options={{ gestureEnabled: false }} />
          </Stack.Navigator>
        ) : showIntent ? (
          <OnboardingIntent user={sessionUser} profile={onboardProfile} onDone={finishIntent} onSkipAll={skipOnboarding} {...stepProps('intent')} />
        ) : showNametag ? (
          <OnboardingNametag user={sessionUser} profile={onboardProfile} intent={intent} onDone={finishNametag} onSkipAll={skipOnboarding} {...stepProps('nametag')} />
        ) : showImport ? (
          <Aura.ImportLinksScreen onDone={finishImport} onSkipAll={skipOnboarding} intent={intent} {...stepProps('import')} />
        ) : !locationConsent ? (
          <Aura.LocationConsentScreen onContinue={acceptLocationConsent} onSkipAll={skipOnboarding} intent={intent} {...stepProps('location')} />
        ) : showPaywall ? (
          <Aura.SubscriptionScreen onClose={finishPaywall} route={intent === 'business' ? { params: { tier: 'business' } } : undefined} />
        ) : (
          <Stack.Navigator key="member" screenLayout={screenLayout} screenOptions={screenOptions}>
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
            <Stack.Screen name="Subscription" component={Aura.SubscriptionScreen} />
            <Stack.Screen name="Language" component={Aura.LanguageScreen} />
            <Stack.Screen name="Stream" component={Aura.StreamScreen} />
            <Stack.Screen name="ArcadeStore" component={ArcadeStoreScreen} />
            <Stack.Screen name="Studio" component={StudioHomeScreen} />
            <Stack.Screen name="StudioEditor" component={StudioScreen} options={{ gestureEnabled: false }} />
            <Stack.Screen name="MySounds" component={StudioHomeScreen} initialParams={{ tab: 'sounds' }} />
            <Stack.Screen name="Sound" component={SoundScreen} />
            <Stack.Screen name="Music" component={MusicScreen} />
            <Stack.Screen name="MusicHome" component={MusicHomeScreen} options={{ animation: 'slide_from_bottom' }} />
            <Stack.Screen name="NowPlaying" component={NowPlayingScreen} options={{ presentation: 'fullScreenModal', animation: 'slide_from_bottom' }} />
            <Stack.Screen name="CopyrightReview" component={CopyrightReviewScreen} />
            <Stack.Screen name="GamePlayScreen" component={GamePlayScreen} options={{ gestureEnabled: false }} />
            <Stack.Screen name="GameLobby" component={Aura.GameLobbyScreen} />
            <Stack.Screen name="LaserTagLobby" component={Aura.LaserTagLobbyScreen} />
            <Stack.Screen name="GameLeaderboard" component={Aura.GameLeaderboardScreen} />
            <Stack.Screen name="PlayerProfile" component={Aura.PlayerProfileScreen} />
            <Stack.Screen name="GunShop" component={Aura.GunShopScreen} />
            <Stack.Screen name="MyEquip" component={Aura.MyEquipScreen} />
            <Stack.Screen name="Chess" component={Aura.ChessScreen} />
            <Stack.Screen name="WordRace" component={Aura.WordRaceScreen} />
            <Stack.Screen name="BusinessDashboard" component={Aura.BusinessDashboardScreen} />
            <Stack.Screen name="PromotedPlacement" component={Aura.PromotedPlacementScreen} />
            <Stack.Screen name="BusinessQR" component={Aura.BusinessQRScreen} />
            <Stack.Screen name="BusinessTeam" component={Aura.BusinessTeamScreen} />
          </Stack.Navigator>
        )}
        {/* Game challenges from other users (inbox:<myId>), only once fully signed in. */}
        {session && locationConsent && !showIntent && !showNametag && !showImport && !showPaywall ?<InviteListener key={userId} navRef={navRef} /> : null}
      </NavigationContainer>
    </SafeAreaProvider>
  )
}
