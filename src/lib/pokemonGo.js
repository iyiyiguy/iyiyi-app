// Pokemon Go integration
// Connects iYiYi with Pokemon Go profiles

import * as WebBrowser from 'expo-web-browser'
import * as SecureStore from 'expo-secure-store'
import { supabase } from './supabase'

// Note: Full Pokemon Go OAuth requires Niantic API access
// This is a framework for integration

export const POGO_CONFIG = {
  clientId: process.env.EXPO_PUBLIC_POGO_CLIENT_ID,
  redirectUrl: 'iyiyi://pokemon-callback',
  authEndpoint: 'https://api.pokemon.go/oauth/authorize',
}

export const initiatePokemonGoAuth = async () => {
  try {
    // Open Pokemon Go login
    const result = await WebBrowser.openAuthSessionAsync(
      `${POGO_CONFIG.authEndpoint}?client_id=${POGO_CONFIG.clientId}&redirect_uri=${POGO_CONFIG.redirectUrl}&response_type=code`,
      POGO_CONFIG.redirectUrl,
    )

    if (result.type === 'success') {
      const { code } = parseUrl(result.url)
      await exchangePogoCode(code)
      return true
    }
  } catch (error) {
    console.error('Pokemon Go auth failed:', error)
    return false
  }
}

const exchangePogoCode = async (code) => {
  try {
    // Exchange code for token (would need backend)
    const { data } = await supabase.functions.invoke('pokemon-go-exchange', {
      body: { code },
    })

    // Store token securely
    await SecureStore.setItemAsync('pogo_token', data.access_token)
    return data
  } catch (error) {
    console.error('Failed to exchange Pokemon Go code:', error)
  }
}

export const getPokemonGoProfile = async (userId) => {
  try {
    const token = await SecureStore.getItemAsync('pogo_token')
    if (!token) return null

    // Fetch profile data
    const response = await fetch('https://api.pokemon.go/v1/profile', {
      headers: { Authorization: `Bearer ${token}` },
    })

    const profile = await response.json()

    return {
      trainerId: profile.trainer_id,
      trainerName: profile.trainer_name,
      level: profile.level,
      totalPokemon: profile.pokemon_count,
      totalCaught: profile.caught_pokemon,
      team: profile.team, // RED, BLUE, YELLOW
      pokemon: profile.pokemon.slice(0, 6), // Top 6 for profile display
      badges: profile.badges?.slice(0, 3), // Showcase badges
    }
  } catch (error) {
    console.error('Failed to fetch Pokemon Go profile:', error)
    return null
  }
}

export const linkPogoProfile = async (userId, pogoTrainerId) => {
  // Link Pokemon Go profile to iYiYi account
  const { error } = await supabase
    .from('user_integrations')
    .upsert({
      user_id: userId,
      service: 'pokemon_go',
      service_id: pogoTrainerId,
      linked_at: new Date(),
    })

  if (error) console.error('Failed to link Pokemon Go:', error)
  return !error
}

export const getLinkedPogoProfile = async (userId) => {
  // Get linked Pokemon Go profile for a user
  const { data } = await supabase
    .from('user_integrations')
    .select('service_id')
    .eq('user_id', userId)
    .eq('service', 'pokemon_go')
    .single()

  if (data?.service_id) {
    return await getPokemonGoProfile(userId)
  }
  return null
}

const parseUrl = (url) => {
  const params = new URLSearchParams(url.split('?')[1])
  return {
    code: params.get('code'),
    error: params.get('error'),
  }
}
