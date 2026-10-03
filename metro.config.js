// Metro config: the default Expo config, plus web-only stand-ins for native-only modules so
// the same app can be exported for the browser (app.iyiyi.xyz).
const path = require('path')
const { getDefaultConfig } = require('expo/metro-config')

const config = getDefaultConfig(__dirname)

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
