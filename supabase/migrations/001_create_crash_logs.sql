-- Create crash_logs table for tracking application errors

CREATE TABLE IF NOT EXISTS crash_logs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,

  -- Error details
  error_message TEXT NOT NULL,
  error_stack TEXT,

  -- Context
  context JSONB,
  timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  -- Device info
  platform TEXT, -- ios, android, web
  app_version TEXT,
  build_number TEXT,

  -- User info (optional)
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  user_agent TEXT,

  -- Status
  status TEXT DEFAULT 'open', -- open, investigating, fixed

  -- Metadata
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for faster queries
CREATE INDEX idx_crash_logs_timestamp ON crash_logs(timestamp DESC);
CREATE INDEX idx_crash_logs_error_message ON crash_logs(error_message);
CREATE INDEX idx_crash_logs_platform ON crash_logs(platform);
CREATE INDEX idx_crash_logs_user_id ON crash_logs(user_id);

-- Create view for crash statistics
CREATE VIEW crash_stats AS
SELECT
  DATE(timestamp) as date,
  platform,
  COUNT(*) as total_crashes,
  COUNT(DISTINCT error_message) as unique_errors,
  COUNT(DISTINCT user_id) as affected_users
FROM crash_logs
GROUP BY DATE(timestamp), platform
ORDER BY date DESC;

-- Enable RLS (Row Level Security)
ALTER TABLE crash_logs ENABLE ROW LEVEL SECURITY;

-- Policy: Only authenticated users can view their own crashes
CREATE POLICY "Users can view their own crashes"
ON crash_logs
FOR SELECT
USING (auth.uid() = user_id OR auth.role() = 'service_role');

-- Policy: Service role (app) can insert crashes
CREATE POLICY "Service role can insert crashes"
ON crash_logs
FOR INSERT
WITH CHECK (auth.role() = 'service_role');

-- Grant permissions
GRANT SELECT ON crash_logs TO authenticated;
GRANT SELECT ON crash_stats TO authenticated;
