// Metro config: the default Expo config, plus web-only stand-ins for native-only modules so
// the same app can be exported for the browser (app.iyiyi.xyz).
const path = require('path')
const { getDefaultConfig } = require('expo/metro-config')

const config = getDefaultConfig(__dirname)

// Faster launch: inline requires make every module load the first time it is actually used,
// instead of evaluating the whole app (maps, camera filters, games, three.js…) before the
// first screen can draw. This is React Native's own default; Expo turns it off.
const expoTransformOptions = config.transformer.getTransformOptions
config.transformer.getTransformOptions = async (...args) => {
  const base = expoTransformOptions ? await expoTransformOptions(...args) : {}
  return { ...base, transform: { ...(base.transform || {}), inlineRequires: true } }
}

const WEB_SHIMS = {
  'react-native-maps': path.resolve(__dirname, 'src/web/maps.web.js'),
}

const upstream = config.resolver.resolveRequest
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (platform === 'web' && WEB_SHIMS[moduleName]) {
    return { type: 'sourceFile', filePath: WEB_SHIMS[moduleName] }
  }
  return upstream ? upstream(context, moduleName, platform) : context.resolveRequest(context, moduleName, platform)
}

module.exports = config
