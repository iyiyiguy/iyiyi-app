import { supabase } from './supabase'

// Web build of oauth.js — same exports, minus expo-apple-authentication
// (native-only, would crash the web bundle at import time).
//
// This used to open the OAuth provider in a popup window (WebBrowser.
// openAuthSessionAsync) and manually parse the returned tokens. That relied
// on a fragile popup <-> opener postMessage handshake (expo-web-browser's
// maybeCompleteAuthSession) that kept failing silently in this iframe-embedded
// setup, so it was replaced with a plain full-page redirect — except this app
// is itself embedded in an iframe on iyiyi.higgsfield.app, and Google (like
// most OAuth providers) refuses to render its consent screen inside ANY
// iframe at all (403, a security policy on Google's end, not fixable from
// here). So the redirect has to break out to the TOP-level window for the
// provider hop; skipBrowserRedirect + window.top.location does that. After
// auth, Google/Supabase redirect the top-level window straight back to
// /webapp/, where detectSessionInUrl: true (see supabase.js) picks the
// session up automatically on load — no manual token parsing needed.
const topWindow = () => (typeof window !== 'undefined' ? window.top ?? window : undefined)

const redirectTo = () => {
  const top = topWindow()
  return top ? `${top.location.origin}/webapp/` : undefined
}

const PROVIDER_TO_FIELD = {
  facebook: 'facebook',
  twitter: 'twitter',
  tiktok: 'tiktok',
}

export async function signInWithProvider(provider) {
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider,
    options: { redirectTo: redirectTo(), skipBrowserRedirect: true },
  })
  if (error) throw error
  topWindow().location.assign(data.url)
  // The whole tab navigates away to the provider now; this promise never
  // resolves normally — the redirect back is handled on the next page load
  // (see App.js's onAuthStateChange, which links the provider to the profile).
}

export async function connectProvider(provider) {
  const { data, error } = await supabase.auth.linkIdentity({
    provider,
    options: { redirectTo: redirectTo(), skipBrowserRedirect: true },
  })
  if (error) throw error
  topWindow().location.assign(data.url)
}

export async function signInWithApple() {
  throw new Error('Sign in with Apple is only available in the iOS app.')
}

// OAuth sign-in never went through a path that creates the profiles row (only
// email/phone signup did), so a user who only ever signed in via a social
// provider could reach the app with an auth.users row but no matching
// profile - every profile read/write for them then fails silently.
export function neutralUsername(userId) {
  return `iyiyi_${String(userId).replace(/-/g, '').slice(0, 8)}`
}

// Idempotent (see oauth.js): upsert that ignores an existing row, so concurrent
// callers never overwrite each other. Resolves true only if this call created the row.
export async function ensureProfile(user, { username } = {}) {
  if (!user) return false
  const { data: existing, error: readError } = await supabase.from('profiles').select('id').eq('id', user.id).maybeSingle()
  if (readError) throw readError
  if (existing) return false
  const suggested = username || user.user_metadata?.full_name || user.user_metadata?.name || user.email?.split('@')[0]
  const candidates = [suggested, neutralUsername(user.id), `iyiyi_${Math.random().toString(36).slice(2, 10)}`].filter(Boolean)
  let lastError = null
  for (const name of candidates) {
    const { data, error } = await supabase
      .from('profiles')
      .upsert({ id: user.id, username: name }, { onConflict: 'id', ignoreDuplicates: true })
      .select('id')
    if (!error) return (data?.length ?? 0) > 0
    lastError = error
  }
  throw lastError
}

export async function linkProviderToProfile(provider, user) {
  const field = PROVIDER_TO_FIELD[provider]
  if (!field || !user) return

  const identity = user.identities?.find((i) => i.provider === provider)
  const identityData = identity?.identity_data ?? {}
  const handle =
    identityData.user_name || identityData.link || identityData.name || user.email?.split('@')[0]
  if (!handle) return

  const { data: profile } = await supabase.from('profiles').select(field).eq('id', user.id).maybeSingle()
  if (profile && !profile[field]) {
    await supabase.from('profiles').update({ [field]: handle }).eq('id', user.id)
  }
}
