// react-native-appsflyer is linked on iOS and Android. It only does anything when
// a dev key is configured (app.json extra.appsflyerDevKey), and its Android
// Kotlin stdlib is pinned to the app's Kotlin version by plugins/withAppsFlyerKotlin.js.
//
// react-native-fbsdk-next (Meta SDK) is only linked when FACEBOOK_CLIENT_TOKEN is set at build
// time (see app.config.js). Without it the native Facebook SDK would ship with no app id.
const metaSdk = !!process.env.FACEBOOK_CLIENT_TOKEN

module.exports = {
  dependencies: metaSdk ? {} : { 'react-native-fbsdk-next': { platforms: { ios: null, android: null } } },
}
