// Adds build-time secrets to app.json without committing them (the repo is public).
//   GOOGLE_MAPS_ANDROID_API_KEY  Google Maps key for Android maps (repo secret; iOS uses Apple Maps).
//   ANDROID_VERSION_CODE         set by CI so every Play upload gets a higher number.
//   FACEBOOK_CLIENT_TOKEN        Meta app client token (repo secret). When set, the Meta SDK
//                                (react-native-fbsdk-next) is configured for app events / ad
//                                attribution; without it the SDK isn't added to the build at all.
const FACEBOOK_APP_ID = '1436621328502944' // Meta app "iYiYi" (public id)

module.exports = ({ config }) => {
  const mapsKey = process.env.GOOGLE_MAPS_ANDROID_API_KEY || ''
  const versionCode = Number(process.env.ANDROID_VERSION_CODE) || config.android?.versionCode
  const fbToken = process.env.FACEBOOK_CLIENT_TOKEN || ''
  const plugins = [...(config.plugins || [])]
  if (fbToken) {
    plugins.push([
      'react-native-fbsdk-next',
      {
        appID: FACEBOOK_APP_ID,
        clientToken: fbToken,
        displayName: 'iYiYi',
        scheme: `fb${FACEBOOK_APP_ID}`,
        isAutoInitEnabled: true,
        autoLogAppEventsEnabled: true,
        advertiserIDCollectionEnabled: true,
        // No App Tracking Transparency prompt for now (Meta measures iOS installs via SKAN/AEM).
        iosUserTrackingPermission: false,
      },
    ])
  }
  return {
    ...config,
    plugins,
    android: {
      ...config.android,
      versionCode,
      config: {
        ...(config.android?.config || {}),
        ...(mapsKey ? { googleMaps: { apiKey: mapsKey } } : {}),
      },
    },
    extra: { ...(config.extra || {}), androidMapsKey: !!mapsKey, metaSdk: !!fbToken },
  }
}
