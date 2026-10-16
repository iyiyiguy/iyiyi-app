const { withProjectBuildGradle } = require('@expo/config-plugins')

// react-native-appsflyer 7.x asks for kotlin-stdlib 2.4.x unless the root project sets
// `kotlin_stdlib_version`. React Native 0.86 compiles with Kotlin 2.1.x, which can't read 2.4
// metadata, so the Android build failed and AppsFlyer was left unlinked on Android. Pin the
// stdlib to the project's own Kotlin version.
const MARK = '// appsflyer-kotlin-stdlib'

module.exports = function withAppsFlyerKotlin(config) {
  return withProjectBuildGradle(config, (cfg) => {
    if (cfg.modResults.language !== 'groovy' || cfg.modResults.contents.includes(MARK)) return cfg
    cfg.modResults.contents += `
${MARK}
ext.kotlin_stdlib_version = (findProperty('kotlinVersion') ?: (rootProject.ext.has('kotlinVersion') ? rootProject.ext.get('kotlinVersion') : '2.1.20'))
`
    return cfg
  })
}
