import * as Sentry from '@sentry/react-native'
import { supabase } from './supabase'
import * as Application from 'expo-application'

// Initialize Sentry for crash tracking
// Sentry is initialised once in index.js (with the real DSN). This used to call
// Sentry.init a second time with an integration class that no longer exists, so it
// is now a no-op kept for the existing call site in App.js.
export const initCrashLogger = () => {}

// Log crash with context
export const logCrash = async (error, context = {}) => {
  const crashData = {
    error_message: error?.message || String(error),
    error_stack: error?.stack || '',
    timestamp: new Date().toISOString(),
    context: JSON.stringify(context),
    platform: 'ios',
    app_version: Application.nativeApplicationVersion || '1.2.6',
    build_number: Application.nativeBuildVersion || '57',
    user_agent: 'iYiYi Mobile',
  }

  console.log('[CrashLogger] Logging crash:', crashData.error_message)

  try {
    // Send to Sentry if configured
    try {
      Sentry.captureException(error, { contexts: { custom: context } })
    } catch (e) {
      console.warn('[CrashLogger] Sentry capture failed:', e)
    }

    // Store in Supabase
    const { data, error: dbError } = await supabase
      .from('crash_logs')
      .insert([crashData])
      .select()

    if (dbError) {
      console.warn('[CrashLogger] DB insert failed:', dbError.message)
    } else {
      console.log('[CrashLogger] Crash logged:', data?.[0]?.id)
    }
  } catch (e) {
    console.warn('[CrashLogger] Logging failed:', e)
  }

  return crashData
}

// Get recent crashes
export const getCrashLogs = async (limit = 50, userId = null) => {
  try {
    let query = supabase
      .from('crash_logs')
      .select('*')
      .order('timestamp', { ascending: false })
      .limit(limit)

    if (userId) {
      query = query.eq('user_id', userId)
    }

    const { data, error } = await query

    if (error) {
      console.error('[CrashLogger] Fetch failed:', error)
      return []
    }

    console.log(`[CrashLogger] Retrieved ${data?.length || 0} crash logs`)
    return data || []
  } catch (error) {
    console.error('[CrashLogger] Get crashes failed:', error)
    return []
  }
}

// Clear old crashes (older than days)
export const clearOldCrashes = async (days = 30) => {
  try {
    const cutoffDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()

    const { data, error } = await supabase
      .from('crash_logs')
      .delete()
      .lt('timestamp', cutoffDate)

    if (error) {
      console.error('[CrashLogger] Clear failed:', error)
    } else {
      console.log('[CrashLogger] Cleared old crashes before', cutoffDate)
    }
  } catch (error) {
    console.error('[CrashLogger] Clear crashed:', error)
  }
}

// Get crash stats
export const getCrashStats = async () => {
  try {
    const { data, error } = await supabase
      .from('crash_logs')
      .select('error_message, timestamp')
      .order('timestamp', { ascending: false })
      .limit(100)

    if (error) throw error

    const stats = {
      totalCrashes: data?.length || 0,
      uniqueErrors: new Set(data?.map(d => d.error_message) || []).size,
      lastCrash: data?.[0]?.timestamp || null,
      errorFrequency: {},
    }

    // Count frequency of each error
    data?.forEach(crash => {
      const msg = crash.error_message
      stats.errorFrequency[msg] = (stats.errorFrequency[msg] || 0) + 1
    })

    console.log('[CrashLogger] Stats:', stats)
    return stats
  } catch (error) {
    console.error('[CrashLogger] Stats failed:', error)
    return null
  }
}

// Setup global error handler
export const setupGlobalErrorHandler = () => {
  const originalErrorHandler = ErrorUtils.getGlobalHandler()

  ErrorUtils.setGlobalHandler((error, isFatal) => {
    // Fire-and-forget: never make a fatal error wait on the network before Sentry and
    // React Native's own handler see it.
    logCrash(error, { isFatal, source: 'global-error-handler' }).catch(() => {})
    originalErrorHandler?.(error, isFatal)
  })

  console.log('[CrashLogger] Global error handler installed')
}
