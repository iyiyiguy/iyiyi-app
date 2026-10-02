const Sentry = require('@sentry/react-native');

// Temporary: builds 19-31 all crash on launch with an identical native
// signature (RCTExceptionsManager reportFatal -> abort() on a background
// TurboModule queue), which our own JS-side error handlers never see (see
// history below) - it's a native NSException that RN can't safely propagate.
// Sentry's native iOS SDK installs its own crash handler at native init time,
// which can capture the NSException's actual name/reason text (something
// Apple's own .ips crash logs omit entirely) - that's the missing piece for
// finally identifying the real cause. Remove this instrumentation once the
// root cause is found and fixed.
Sentry.init({
  dsn: 'https://eb96181c8fd8d89f9a44ea2dec4b1277@o4512105727262720.ingest.us.sentry.io/4512105734864896',
  tracesSampleRate: 0,
  enableNativeCrashHandling: true,
  enableAutoSessionTracking: false,
});

// Older diagnostic layer (builds 28-31): wraps the app's own JS imports in
// try/catch and logs any caught error to a Supabase `debug_logs` table. It
// caught nothing across 4 builds, meaning the crash happens natively before
// this code (or any JS) runs - kept here as a harmless fallback in case a
// future build's crash does turn out to be a catchable JS import-time error.
try {
  const { registerRootComponent } = require('expo');
  const App = require('./App').default;
  registerRootComponent(App);
} catch (err) {
  try {
    const { supabase } = require('./src/lib/supabase');
    const insert = supabase.from('debug_logs').insert({
      message: String(err && err.message ? err.message : err),
      stack: String(err && err.stack ? err.stack : ''),
      is_fatal: true,
    });
    Promise.race([insert, new Promise((resolve) => setTimeout(resolve, 4000))]).finally(() => {
      throw err;
    });
  } catch (e) {
    throw err;
  }
}
