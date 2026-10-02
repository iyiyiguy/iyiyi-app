import * as WebBrowser from 'expo-web-browser'
import * as AuthSession from 'expo-auth-session'
import * as AppleAuthentication from 'expo-apple-authentication'
import * as Crypto from 'expo-crypto'
import { supabase } from './supabase'

// NOTE: no top-level WebBrowser.maybeCompleteAuthSession() call here. That's
// only needed to resume a session that finished via an app-link redirect
// while this app was backgrounded — this flow instead runs synchronously
// through openAuthSessionAsync() below and reads the callback URL directly,
// so it isn't needed. It's also an unconditional native call that would run
// on every cold launch (including App Review's fresh install) — see
// attribution.js for the identical crash class this caused before with a
// different unconditional native call.

// Maps an OAuth provider to the matching social-link column on `profiles`.
// Providers without a social card on the profile (google, phone) are skipped.
const PROVIDER_TO_FIELD = {
  facebook: 'facebook',
  twitter: 'twitter',
  tiktok: 'tiktok',
}

// Providers configured in Supabase Auth > Providers. Each needs its own
// developer app registered with that platform (client id/secret entered
// into the Supabase dashboard) before it will actually work.
export async function signInWithProvider(provider) {
  const redirectTo = AuthSession.makeRedirectUri({ scheme: 'iyiyi' })

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider,
    options: { redirectTo, skipBrowserRedirect: true },
  })
  if (error) throw error

  const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo)
  if (result.type !== 'success') throw new Error('Sign-in cancelled')

  const url = new URL(result.url.replace('#', '?'))
  const access_token = url.searchParams.get('access_token')
  const refresh_token = url.searchParams.get('refresh_token')
  if (!access_token || !refresh_token) throw new Error('No session returned')

  const { data: sessionData, error: sessionError } = await supabase.auth.setSession({ access_token, refresh_token })
  if (sessionError) throw sessionError

  await ensureProfile(sessionData.user)
  await linkProviderToProfile(provider, sessionData.user)
}

// OAuth sign-in (unlike email/phone signup) never went through a path that
// creates the profiles row, so a user who only ever signed in with Google/
// Facebook/etc could reach the app with an auth.users row but no matching
// profile - every profile read/write for them then fails. Call this right
// after any OAuth session is established, before relying on a profile
// existing.
// Google (and some other providers) hand back a profile photo URL in the OAuth
// metadata. Only used the one time a profile is first created below - once someone
// has a profile, this never runs again for them, so uploading their own photo
// later always sticks and is never overwritten by this.
function avatarFromMetadata(user) {
  const meta = user.user_metadata ?? {}
  return meta.avatar_url || meta.picture || null
}

export function neutralUsername(userId) {
  return `iyiyi_${String(userId).replace(/-/g, '').slice(0, 8)}`
}

// Idempotent: safe to call concurrently from several places (App.js's
// SIGNED_IN handler, the sign-in flows themselves). The insert is an upsert
// that ignores an existing row, so whichever caller gets there first wins
// and nobody overwrites a profile that already exists. Resolves true only
// when this call actually created the row.
export async function ensureProfile(user, { username } = {}) {
  if (!user) return false
  const { data: existing, error: readError } = await supabase.from('profiles').select('id').eq('id', user.id).maybeSingle()
  if (readError) throw readError
  if (existing) return false
  const avatar_url = avatarFromMetadata(user)
  const suggested = username || user.user_metadata?.full_name || user.user_metadata?.name || user.email?.split('@')[0]
  // The suggested name can be rejected (taken, or blocked by the username filter): fall back to neutral ones.
  const candidates = [suggested, neutralUsername(user.id), `iyiyi_${Math.random().toString(36).slice(2, 10)}`].filter(Boolean)
  let lastError = null
  for (const name of candidates) {
    const { data, error } = await supabase
      .from('profiles')
      .upsert({ id: user.id, username: name, avatar_url }, { onConflict: 'id', ignoreDuplicates: true })
      .select('id')
    if (!error) return (data?.length ?? 0) > 0
    lastError = error
  }
  throw lastError
}

// Used from onboarding/settings when the user is already signed in and just
// wants to connect another platform — links the identity to the current
// account in one tap instead of running a full separate sign-in.
export async function connectProvider(provider) {
  const redirectTo = AuthSession.makeRedirectUri({ scheme: 'iyiyi' })

  const { data, error } = await supabase.auth.linkIdentity({
    provider,
    options: { redirectTo, skipBrowserRedirect: true },
  })
  if (error) throw error

  const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo)
  if (result.type !== 'success') throw new Error('Connection cancelled')

  const { data: { user } } = await supabase.auth.getUser()
  await ensureProfile(user)
  await linkProviderToProfile(provider, user)
}

// Sign in with Apple must use Apple's native button + ID token flow on iOS
// (Apple rejects apps that route it through a web redirect instead).
export async function signInWithApple() {
  // Apple gets the SHA-256 of the nonce; Supabase gets the raw nonce and
  // checks it against the hashed value embedded in the identity token.
  const rawNonce = Crypto.randomUUID()
  const hashedNonce = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, rawNonce)

  let credential
  try {
    credential = await AppleAuthentication.signInAsync({
      requestedScopes: [
        AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        AppleAuthentication.AppleAuthenticationScope.EMAIL,
      ],
      nonce: hashedNonce,
    })
  } catch (e) {
    // User dismissed the Apple sheet: not an error worth showing.
    if (e?.code === 'ERR_REQUEST_CANCELED') return false
    throw e
  }
  if (!credential.identityToken) throw new Error('No identity token returned by Apple')

  const { data, error } = await supabase.auth.signInWithIdToken({
    provider: 'apple',
    token: credential.identityToken,
    nonce: rawNonce,
  })
  if (error) throw error

  // Apple never provides a profile photo; the name is only sent on the very first sign-in.
  const user = data?.user ?? (await supabase.auth.getUser()).data?.user
  await ensureProfile(user, { username: credential.fullName?.givenName || undefined })
  return true
}

// After signing in with a social provider, auto-fill that platform's card on
// the user's profile (only if it's still empty, so we never clobber an
// existing manual entry).
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
