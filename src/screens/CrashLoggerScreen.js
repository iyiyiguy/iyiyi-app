import React, { useState, useEffect } from 'react'
import {
  View, Text, ScrollView, Pressable, StyleSheet, ActivityIndicator, Linking,
} from 'react-native'
import { GlassBackground } from '../components/GlassBackground'
import { GlassCard } from '../components/GlassCard'
import { getCrashLogs, getCrashStats, clearOldCrashes } from '../lib/crashLogger'

export default function CrashLoggerScreen({ navigation }) {
  const [crashes, setCrashes] = useState([])
  const [stats, setStats] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadData()
    // Refresh every 30 seconds
    const interval = setInterval(loadData, 30000)
    return () => clearInterval(interval)
  }, [])

  const loadData = async () => {
    setLoading(true)
    try {
      const [crashData, statsData] = await Promise.all([
        getCrashLogs(20),
        getCrashStats(),
      ])
      setCrashes(crashData || [])
      setStats(statsData)
    } catch (error) {
      console.error('Failed to load crash data:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleClearOldCrashes = async () => {
    await clearOldCrashes(30)
    loadData()
  }

  const handleSendReport = () => {
    const subject = 'iYiYi Crash Report'
    const body = `
Crash Statistics:
- Total Crashes: ${stats?.totalCrashes || 0}
- Unique Errors: ${stats?.uniqueErrors || 0}
- Last Crash: ${stats?.lastCrash || 'None'}

Recent Crashes:
${crashes.map(c => `- ${c.error_message} (${new Date(c.timestamp).toLocaleString()})`).join('\n')}
    `.trim()

    Linking.openURL(`mailto:support@iyiyi.app?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`)
  }

  return (
    <GlassBackground isDark={true}>
      <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
        {/* Header */}
        <View style={styles.header}>
          <Pressable onPress={() => navigation.goBack()}>
            <Text style={styles.backButton}>← Back</Text>
          </Pressable>
          <Text style={styles.title}>Crash Logger</Text>
        </View>

        {loading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator color="#fff" size="large" />
            <Text style={styles.loadingText}>Loading crash data...</Text>
          </View>
        ) : (
          <>
            {/* Statistics */}
            {stats && (
              <GlassCard intensity={80} tint="dark" radius={20} padding={16} style={styles.statsCard}>
                <Text style={styles.statsTitle}>📊 Statistics</Text>
                <View style={styles.statsGrid}>
                  <View style={styles.statBox}>
                    <Text style={styles.statLabel}>Total Crashes</Text>
                    <Text style={styles.statValue}>{stats.totalCrashes}</Text>
                  </View>
                  <View style={styles.statBox}>
                    <Text style={styles.statLabel}>Unique Errors</Text>
                    <Text style={styles.statValue}>{stats.uniqueErrors}</Text>
                  </View>
                </View>
                {stats.lastCrash && (
                  <Text style={styles.lastCrashText}>
                    Last crash: {new Date(stats.lastCrash).toLocaleString()}
                  </Text>
                )}
              </GlassCard>
            )}

            {/* Controls */}
            <View style={styles.controls}>
              <Pressable onPress={loadData} style={styles.controlButton}>
                <Text style={styles.controlButtonText}>🔄 Refresh</Text>
              </Pressable>
              <Pressable onPress={handleSendReport} style={styles.controlButton}>
                <Text style={styles.controlButtonText}>📧 Send Report</Text>
              </Pressable>
              <Pressable onPress={handleClearOldCrashes} style={styles.controlButton}>
                <Text style={styles.controlButtonText}>🗑️ Clear Old</Text>
              </Pressable>
            </View>

            {/* Recent Crashes */}
            <Text style={styles.sectionTitle}>📋 Recent Crashes</Text>
            {crashes.length > 0 ? (
              crashes.map((crash, idx) => (
                <GlassCard
                  key={crash.id || idx}
                  intensity={75}
                  tint="dark"
                  radius={14}
                  padding={12}
                  style={styles.crashCard}
                >
                  <View style={styles.crashHeader}>
                    <Text style={styles.crashMessage} numberOfLines={2}>
                      {crash.error_message}
                    </Text>
                    <View
                      style={[
                        styles.statusBadge,
                        crash.status === 'fixed' && styles.statusBadgeFixed,
                      ]}
                    >
                      <Text style={styles.statusText}>
                        {crash.status === 'fixed' ? '✓' : '●'} {crash.status}
                      </Text>
                    </View>
                  </View>

                  <Text style={styles.crashTime}>
                    {new Date(crash.timestamp).toLocaleString()}
                  </Text>

                  {crash.platform && (
                    <Text style={styles.crashDetail}>
                      Platform: {crash.platform} • v{crash.app_version}
                    </Text>
                  )}

                  {crash.context && (
                    <View style={styles.contextBox}>
                      <Text style={styles.contextLabel}>Context:</Text>
                      <Text style={styles.contextText} numberOfLines={2}>
                        {typeof crash.context === 'string'
                          ? crash.context
                          : JSON.stringify(crash.context)}
                      </Text>
                    </View>
                  )}
                </GlassCard>
              ))
            ) : (
              <GlassCard intensity={75} tint="dark" radius={14} padding={16} style={styles.noCrashesCard}>
                <Text style={styles.noCrashesText}>
                  ✨ No crashes! Your app is running smoothly.
                </Text>
              </GlassCard>
            )}

            <View style={{ height: 40 }} />
          </>
        )}
      </ScrollView>
    </GlassBackground>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingTop: 20,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    marginBottom: 20,
    gap: 12,
  },
  backButton: {
    color: 'rgba(255, 255, 255, 0.7)',
    fontSize: 14,
  },
  title: {
    color: '#fff',
    fontSize: 28,
    fontWeight: '800',
    flex: 1,
  },
  loadingContainer: {
    height: 300,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    color: 'rgba(255, 255, 255, 0.6)',
    fontSize: 13,
    marginTop: 12,
  },
  statsCard: {
    marginHorizontal: 12,
    marginBottom: 16,
  },
  statsTitle: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 12,
  },
  statsGrid: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 12,
  },
  statBox: {
    flex: 1,
    backgroundColor: 'rgba(100, 150, 255, 0.2)',
    padding: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  statLabel: {
    color: 'rgba(255, 255, 255, 0.6)',
    fontSize: 11,
    marginBottom: 4,
  },
  statValue: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '700',
  },
  lastCrashText: {
    color: 'rgba(255, 255, 255, 0.6)',
    fontSize: 11,
    fontStyle: 'italic',
  },
  controls: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 12,
    marginBottom: 16,
  },
  controlButton: {
    flex: 1,
    backgroundColor: 'rgba(100, 150, 255, 0.4)',
    paddingVertical: 8,
    borderRadius: 8,
    alignItems: 'center',
  },
  controlButtonText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 12,
  },
  sectionTitle: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
    paddingHorizontal: 16,
    marginBottom: 12,
  },
  crashCard: {
    marginHorizontal: 12,
    marginBottom: 10,
  },
  crashHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 8,
  },
  crashMessage: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 12,
    flex: 1,
    marginRight: 8,
  },
  statusBadge: {
    backgroundColor: 'rgba(255, 57, 48, 0.3)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  statusBadgeFixed: {
    backgroundColor: 'rgba(100, 200, 100, 0.3)',
  },
  statusText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '600',
  },
  crashTime: {
    color: 'rgba(255, 255, 255, 0.5)',
    fontSize: 10,
    marginBottom: 6,
  },
  crashDetail: {
    color: 'rgba(255, 255, 255, 0.6)',
    fontSize: 10,
    marginBottom: 8,
  },
  contextBox: {
    backgroundColor: 'rgba(0, 0, 0, 0.2)',
    padding: 8,
    borderRadius: 6,
  },
  contextLabel: {
    color: 'rgba(255, 255, 255, 0.7)',
    fontSize: 9,
    fontWeight: '600',
    marginBottom: 4,
  },
  contextText: {
    color: 'rgba(255, 255, 255, 0.5)',
    fontSize: 9,
    fontFamily: 'monospace',
  },
  noCrashesCard: {
    marginHorizontal: 12,
  },
  noCrashesText: {
    color: 'rgba(100, 200, 100, 0.9)',
    textAlign: 'center',
    fontSize: 13,
    fontWeight: '600',
  },
})
