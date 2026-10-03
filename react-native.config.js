// AppsFlyer is optional (only used when EXPO_PUBLIC_APPSFLYER_DEV_KEY is set, and every call is
// guarded). Its Android SDK pulls in a Kotlin standard library newer than the app's Kotlin
// compiler, which breaks the Android build, so it is not linked on Android for now.
module.exports = {
  dependencies: {
    'react-native-appsflyer': {
      platforms: { android: null },
    },
  },
}
