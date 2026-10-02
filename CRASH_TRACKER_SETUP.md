# Crash Tracker Setup Guide

## Overview
The crash tracker automatically logs all application errors to:
1. **Sentry** — Real-time error tracking and alerts
2. **Supabase** — Historical crash logs and analytics

## Setup Steps

### 1. Create Supabase Table
Run the migration SQL to create the `crash_logs` table:

```sql
-- File: supabase/migrations/001_create_crash_logs.sql
-- Run in Supabase SQL editor
```

Or use the Supabase CLI:
```bash
supabase migration up
```

### 2. Configure Sentry (Optional)
If using Sentry for advanced error tracking:

1. Create account at [sentry.io](https://sentry.io)
2. Create a new React Native project
3. Copy your DSN
4. Add to `.env`:
```
EXPO_PUBLIC_SENTRY_DSN=https://your-key@sentry.io/your-project
```

### 3. Initialize in App Entry Point
In your main app file (e.g., `App.js` or `index.js`):

```javascript
import { initCrashLogger, setupGlobalErrorHandler } from './src/lib/crashLogger'
import { ErrorBoundary } from './src/components/ErrorBoundary'

// Initialize crash logging
initCrashLogger()
setupGlobalErrorHandler()

export default function App() {
  return (
    <ErrorBoundary screen="App">
      <RootNavigator />
    </ErrorBoundary>
  )
}
```

### 4. Wrap Navigation Stack
Wrap each major screen with ErrorBoundary for maximum coverage:

```javascript
export default function CameraScreen() {
  return (
    <ErrorBoundary screen="CameraScreen">
      {/* Your screen content */}
    </ErrorBoundary>
  )
}
```

## Usage

### Log a Crash Manually
```javascript
import { logCrash } from './src/lib/crashLogger'

try {
  // risky operation
} catch (error) {
  await logCrash(error, {
    screen: 'CameraScreen',
    action: 'takePhoto',
    userId: user.id,
  })
}
```

### View Crash Logs
Navigate to the Crash Logger screen:
- Shows recent crashes
- View statistics (total, unique errors)
- Send crash reports via email
- Clear old crashes

### Query Crashes Programmatically
```javascript
import { getCrashLogs, getCrashStats } from './src/lib/crashLogger'

// Get recent crashes
const crashes = await getCrashLogs(50)

// Get statistics
const stats = await getCrashStats()
console.log(`Total crashes: ${stats.totalCrashes}`)
```

## Crash Log Data Structure

Each crash log contains:
```json
{
  "id": "uuid",
  "error_message": "Error: Cannot read property 'x' of null",
  "error_stack": "at functionName (file.js:123:45)",
  "timestamp": "2026-09-28T10:30:45Z",
  "platform": "ios",
  "app_version": "1.2.6",
  "build_number": "57",
  "context": {
    "screen": "CameraScreen",
    "action": "recordVideo"
  }
}
```

## Database Queries

### Get all crashes for current user
```sql
SELECT * FROM crash_logs 
WHERE user_id = auth.uid()
ORDER BY timestamp DESC
```

### Get crash statistics by day
```sql
SELECT * FROM crash_stats
ORDER BY date DESC
LIMIT 30
```

### Find most common errors
```sql
SELECT error_message, COUNT(*) as frequency
FROM crash_logs
GROUP BY error_message
ORDER BY frequency DESC
LIMIT 10
```

## Monitoring Dashboard

Add to Settings screen for admin access:

```javascript
import CrashLoggerScreen from './src/screens/CrashLoggerScreen'

// In navigation config
<Stack.Screen 
  name="CrashLogger" 
  component={CrashLoggerScreen}
  options={{ title: 'Crash Logs' }}
/>
```

## Best Practices

1. **Wrap Risky Operations**
   ```javascript
   try {
     await riskyAPICall()
   } catch (error) {
     logCrash(error, { context: 'apiCall' })
   }
   ```

2. **Add Context to Crashes**
   ```javascript
   logCrash(error, {
     screen: currentScreen,
     userId: user?.id,
     gameId: currentGame?.id,
   })
   ```

3. **Regular Cleanup**
   ```javascript
   // Clear crashes older than 30 days
   await clearOldCrashes(30)
   ```

4. **Monitor Trends**
   - Check crash stats daily
   - Set Sentry alerts for spike detection
   - Review crash logs for patterns

## Troubleshooting

### Crashes not appearing
- Check Supabase RLS policies are correct
- Verify SENTRY_DSN is set if using Sentry
- Check browser console for logger errors

### Performance impact
- Crash logging is asynchronous and non-blocking
- Logs are batched before sending
- Won't impact app startup time

### Privacy
- Only log necessary context data
- Crashes are encrypted in transit
- Supabase RLS restricts access to user's own crashes
- Never log passwords or sensitive data

## Maintenance

### Weekly
- Review crash trends
- Check for new error patterns
- Verify Sentry alerts working

### Monthly
- Clear crashes older than 30 days
- Archive important crash data
- Review user impact metrics

### On Release
- Zero out crash counts
- Update baseline metrics
- Monitor for new error patterns
