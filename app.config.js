// Adds build-time secrets to app.json without committing them (the repo is public).
//   GOOGLE_MAPS_ANDROID_API_KEY  Google Maps key for Android maps (iOS uses Apple Maps).
//   ANDROID_VERSION_CODE         set by CI so every Play upload gets a higher number.
module.exports = ({ config }) => {
  const mapsKey = process.env.GOOGLE_MAPS_ANDROID_API_KEY || ''
  const versionCode = Number(process.env.ANDROID_VERSION_CODE) || config.android?.versionCode
  return {
    ...config,
    android: {
      ...config.android,
      versionCode,
      config: {
        ...(config.android?.config || {}),
        ...(mapsKey ? { googleMaps: { apiKey: mapsKey } } : {}),
      },
    },
    extra: { ...(config.extra || {}), androidMapsKey: !!mapsKey },
  }
}
