import React from 'react'
import { View, Text, Pressable, StyleSheet } from 'react-native'
import { logCrash } from '../lib/crashLogger'

export class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
    }
  }

  static getDerivedStateFromError(error) {
    return { hasError: true }
  }

  componentDidCatch(error, errorInfo) {
    console.log('[ErrorBoundary] Caught error:', error)
    this.setState({
      error,
      errorInfo,
    })

    // Log to crash tracker
    try { require('@sentry/react-native').captureException(error, { tags: { screen: this.props.screen || 'unknown' } }) } catch {}
    logCrash(error, {
      errorBoundary: true,
      componentStack: errorInfo.componentStack,
      screen: this.props.screen || 'unknown',
    })
  }

  handleReset = () => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
    })
  }

  render() {
    if (this.state.hasError) {
      return (
        <View style={styles.container}>
          <View style={styles.card}>
            <Text style={styles.title}>Oops! Something went wrong</Text>

            <View style={styles.errorBox}>
              <Text style={styles.errorText}>
                {this.state.error?.message || 'Unknown error'}
              </Text>
            </View>

            <Text style={styles.subtitle}>We've logged this error and our team is looking into it.</Text>

            <Pressable onPress={this.handleReset} style={styles.button}>
              <Text style={styles.buttonText}>Try Again</Text>
            </Pressable>
            {this.props.onBack ? (
              <Pressable onPress={() => { this.handleReset(); this.props.onBack() }} style={[styles.button, { marginTop: 10, backgroundColor: 'rgba(255,255,255,0.12)' }]}>
                <Text style={styles.buttonText}>Go back</Text>
              </Pressable>
            ) : null}

            {process.env.NODE_ENV === 'development' && (
              <View style={styles.devInfo}>
                <Text style={styles.devLabel}>Dev Info:</Text>
                <Text style={styles.devText}>
                  {this.state.errorInfo?.componentStack}
                </Text>
              </View>
            )}
          </View>
        </View>
      )
    }

    return this.props.children
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0b0d1f',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
  },
  card: {
    backgroundColor: 'rgba(30, 30, 50, 0.8)',
    borderRadius: 16,
    padding: 24,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    width: '100%',
    maxWidth: 340,
  },
  title: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 16,
    textAlign: 'center',
  },
  errorBox: {
    backgroundColor: 'rgba(255, 57, 48, 0.2)',
    borderRadius: 8,
    padding: 12,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 57, 48, 0.4)',
  },
  errorText: {
    color: 'rgba(255, 255, 255, 0.8)',
    fontSize: 12,
    fontFamily: 'monospace',
  },
  subtitle: {
    color: 'rgba(255, 255, 255, 0.6)',
    fontSize: 13,
    textAlign: 'center',
    marginBottom: 20,
  },
  button: {
    backgroundColor: 'rgba(100, 150, 255, 0.6)',
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 8,
    alignItems: 'center',
  },
  buttonText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 14,
  },
  devInfo: {
    marginTop: 20,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.1)',
  },
  devLabel: {
    color: 'rgba(100, 150, 255, 0.8)',
    fontWeight: '600',
    marginBottom: 8,
  },
  devText: {
    color: 'rgba(255, 255, 255, 0.5)',
    fontSize: 10,
    fontFamily: 'monospace',
  },
})
