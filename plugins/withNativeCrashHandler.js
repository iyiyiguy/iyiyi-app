const { withAppDelegate } = require('@expo/config-plugins')

// Builds 19-34 all crash on launch with an identical native signature
// (RCTExceptionsManager reportFatal -> abort()), and every diagnostic we can
// run from JavaScript (a global ErrorUtils handler, wrapping index.js's own
// requires in try/catch, Sentry.init()) has caught nothing - meaning the
// crash happens natively, before the JS bundle ever starts running. There is
// no way to observe it from JS. This installs an NSSetUncaughtExceptionHandler
// directly in AppDelegate, before React Native's own startup, so we can catch
// the exception's actual name/reason/stack (none of which Apple's own .ips
// crash logs include) and persist it to disk. On the NEXT launch, before
// React Native starts again, it uploads that pending crash to the
// `debug_logs` Supabase table over a plain URLSession request (done natively,
// since the JS/Supabase client isn't available yet at this point either).
// Remove this once the root cause is found and fixed.
const FUNCTIONS_SWIFT = `
import Foundation

private let nativeCrashLogPath: String = {
  let dir = NSSearchPathForDirectoriesInDomains(.documentDirectory, .userDomainMask, true)[0]
  return dir + "/pending_native_crash.txt"
}()

private func installEarlyCrashHandler() {
  NSSetUncaughtExceptionHandler { exception in
    let report = "EXCEPTION: \\(exception.name.rawValue)\\nREASON: \\(exception.reason ?? "")\\nSTACK:\\n\\(exception.callStackSymbols.joined(separator: "\\n"))"
    try? report.write(toFile: nativeCrashLogPath, atomically: true, encoding: .utf8)
  }
}

private func uploadPendingNativeCrashIfAny() {
  guard let content = try? String(contentsOfFile: nativeCrashLogPath, encoding: .utf8) else { return }
  guard let infoDict = Bundle.main.infoDictionary else { return }
  guard let supabaseUrl = infoDict["SUPABASE_URL"] as? String, let anonKey = infoDict["SUPABASE_ANON_KEY"] as? String else { return }
  guard let url = URL(string: supabaseUrl + "/rest/v1/debug_logs") else { return }
  var request = URLRequest(url: url)
  request.httpMethod = "POST"
  request.setValue("application/json", forHTTPHeaderField: "Content-Type")
  request.setValue(anonKey, forHTTPHeaderField: "apikey")
  request.setValue("Bearer " + anonKey, forHTTPHeaderField: "Authorization")
  let body: [String: Any] = ["message": "native_crash", "stack": content, "is_fatal": true]
  request.httpBody = try? JSONSerialization.data(withJSONObject: body)
  let path = nativeCrashLogPath
  URLSession.shared.dataTask(with: request) { _, _, _ in
    try? FileManager.default.removeItem(atPath: path)
  }.resume()
}
`

function withNativeCrashHandlerInfoPlist(config) {
  config.ios = config.ios || {}
  config.ios.infoPlist = config.ios.infoPlist || {}
  config.ios.infoPlist.SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL || ''
  config.ios.infoPlist.SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || ''
  return config
}

module.exports = function withNativeCrashHandler(config) {
  config = withNativeCrashHandlerInfoPlist(config)

  return withAppDelegate(config, (config) => {
    const isSwift = config.modResults.language === 'swift'
    if (!isSwift) {
      throw new Error('withNativeCrashHandler expects a Swift AppDelegate (Expo SDK 57 default) - found: ' + config.modResults.language)
    }

    let contents = config.modResults.contents

    if (contents.includes('installEarlyCrashHandler()')) {
      return config
    }

    const lastImportMatch = [...contents.matchAll(/^import .+$/gm)].pop()
    if (!lastImportMatch) {
      throw new Error('withNativeCrashHandler: could not find an `import` line in AppDelegate.swift to anchor on')
    }
    const importInsertAt = lastImportMatch.index + lastImportMatch[0].length
    contents = contents.slice(0, importInsertAt) + '\n' + FUNCTIONS_SWIFT + contents.slice(importInsertAt)

    const didFinishLaunchingMatches = [...contents.matchAll(/didFinishLaunchingWithOptions[^{]*\{/g)]
    if (didFinishLaunchingMatches.length === 0) {
      throw new Error('withNativeCrashHandler: could not find `didFinishLaunchingWithOptions` in AppDelegate.swift to anchor on')
    }
    // Insert into every match found (defensively - there should only be one
    // real implementation, but if there's more than one match we want the
    // handler installed no matter which one is the real entry point) working
    // from the last match backwards so earlier offsets stay valid.
    console.log(`[withNativeCrashHandler] found ${didFinishLaunchingMatches.length} didFinishLaunchingWithOptions match(es)`)
    for (let i = didFinishLaunchingMatches.length - 1; i >= 0; i--) {
      const m = didFinishLaunchingMatches[i]
      const bodyInsertAt = m.index + m[0].length
      const callInsert = '\n    uploadPendingNativeCrashIfAny()\n    installEarlyCrashHandler()\n'
      contents = contents.slice(0, bodyInsertAt) + callInsert + contents.slice(bodyInsertAt)
    }

    config.modResults.contents = contents
    console.log('[withNativeCrashHandler] final AppDelegate.swift:\n' + contents)
    return config
  })
}
