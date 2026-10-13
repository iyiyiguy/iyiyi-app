import 'react-native-url-polyfill/auto'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    // Only meaningful on web (native has no window.location to detect a
    // token from) — lets a redirect back from OAuth sign-in complete itself
    // by parsing the session out of the URL, instead of needing a popup +
    // manual token-parsing dance.
    detectSessionInUrl: typeof window !== 'undefined' && !!window.location,
  },
  // Realtime carries the live games (lib/multiplayer.js). Phoenix uses the heartbeat
  // interval as the heartbeat *reply* timeout too, so a dead socket is noticed in 15–30 s
  // instead of 25–50 s; joins get a little longer on cellular; reconnects come back faster
  // than the stock 1 / 2 / 5 / 10 s ladder.
  realtime: {
    heartbeatIntervalMs: 15000,
    timeout: 15000,
    reconnectAfterMs: (tries) => [500, 1000, 2000, 4000][tries - 1] ?? 6000,
  },
})

// Why did the socket drop? (keeps the library's own heartbeat behaviour)
try {
  supabase.realtime.onHeartbeat?.((status, latency) => {
    if (status === 'timeout' || status === 'error') console.warn('[realtime] heartbeat', status, latency)
  })
} catch {
  // Older client without onHeartbeat: nothing to do.
}

export const API_URL = process.env.EXPO_PUBLIC_API_URL
