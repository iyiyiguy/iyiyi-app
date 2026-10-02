-- Events table
CREATE TABLE IF NOT EXISTS events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  location TEXT NOT NULL,
  game_id TEXT NOT NULL,
  event_date TIMESTAMPTZ NOT NULL,
  max_players INT NOT NULL DEFAULT 16,
  current_players INT NOT NULL DEFAULT 1,
  creator_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Event attendees (join table)
CREATE TABLE IF NOT EXISTS event_attendees (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  joined_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(event_id, user_id)
);

-- Event invites
CREATE TABLE IF NOT EXISTS event_invites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  invited_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  invited_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status TEXT DEFAULT 'pending', -- pending | accepted | declined
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(event_id, invited_user_id)
);

-- Enable RLS
ALTER TABLE events ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_attendees ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_invites ENABLE ROW LEVEL SECURITY;

-- Events RLS policies
DROP POLICY IF EXISTS "Anyone can view events" ON events;
CREATE POLICY "Anyone can view events" ON events
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "Authenticated users can create events" ON events;
CREATE POLICY "Authenticated users can create events" ON events
  FOR INSERT WITH CHECK (auth.uid() = creator_id);

DROP POLICY IF EXISTS "Event creator can update their event" ON events;
CREATE POLICY "Event creator can update their event" ON events
  FOR UPDATE USING (auth.uid() = creator_id);

-- Event attendees RLS policies
DROP POLICY IF EXISTS "Anyone can view event attendees" ON event_attendees;
CREATE POLICY "Anyone can view event attendees" ON event_attendees
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "Users can join events" ON event_attendees;
CREATE POLICY "Users can join events" ON event_attendees
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can leave events" ON event_attendees;
CREATE POLICY "Users can leave events" ON event_attendees
  FOR DELETE USING (auth.uid() = user_id);

-- Event invites RLS policies
DROP POLICY IF EXISTS "Users can view their invites" ON event_invites;
CREATE POLICY "Users can view their invites" ON event_invites
  FOR SELECT USING (auth.uid() = invited_user_id OR auth.uid() = invited_by);

DROP POLICY IF EXISTS "Users can send invites" ON event_invites;
CREATE POLICY "Users can send invites" ON event_invites
  FOR INSERT WITH CHECK (auth.uid() = invited_by);

DROP POLICY IF EXISTS "Users can respond to their invites" ON event_invites;
CREATE POLICY "Users can respond to their invites" ON event_invites
  FOR UPDATE USING (auth.uid() = invited_user_id);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_events_game_id ON events(game_id);
CREATE INDEX IF NOT EXISTS idx_events_creator_id ON events(creator_id);
CREATE INDEX IF NOT EXISTS idx_events_event_date ON events(event_date);
CREATE INDEX IF NOT EXISTS idx_event_attendees_event_id ON event_attendees(event_id);
CREATE INDEX IF NOT EXISTS idx_event_attendees_user_id ON event_attendees(user_id);
CREATE INDEX IF NOT EXISTS idx_event_invites_event_id ON event_invites(event_id);
CREATE INDEX IF NOT EXISTS idx_event_invites_invited_user_id ON event_invites(invited_user_id);
CREATE INDEX IF NOT EXISTS idx_event_invites_invited_by ON event_invites(invited_by);
