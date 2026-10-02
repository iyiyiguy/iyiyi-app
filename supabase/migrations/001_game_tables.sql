-- Game Lobbies
CREATE TABLE game_lobbies (
  id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL,
  creator_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status TEXT CHECK (status IN ('waiting', 'in_progress', 'completed')),
  max_players INT DEFAULT 4,
  game_state JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

CREATE INDEX idx_game_lobbies_game_id ON game_lobbies(game_id);
CREATE INDEX idx_game_lobbies_status ON game_lobbies(status);

-- Lobby Players
CREATE TABLE lobby_players (
  id BIGSERIAL PRIMARY KEY,
  lobby_id TEXT NOT NULL REFERENCES game_lobbies(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  ready BOOLEAN DEFAULT false,
  joined_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  UNIQUE(lobby_id, user_id)
);

CREATE INDEX idx_lobby_players_lobby_id ON lobby_players(lobby_id);
CREATE INDEX idx_lobby_players_user_id ON lobby_players(user_id);

-- Player Locations (for proximity detection)
CREATE TABLE player_locations (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  latitude DECIMAL(10, 8) NOT NULL,
  longitude DECIMAL(11, 8) NOT NULL,
  accuracy DECIMAL(5, 2),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

CREATE INDEX idx_player_locations_updated_at ON player_locations(updated_at);

-- Game Invitations
CREATE TABLE game_invites (
  id BIGSERIAL PRIMARY KEY,
  from_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  to_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  game_id TEXT NOT NULL,
  lobby_id TEXT REFERENCES game_lobbies(id) ON DELETE CASCADE,
  status TEXT CHECK (status IN ('pending', 'accepted', 'declined')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

CREATE INDEX idx_game_invites_to_user_id ON game_invites(to_user_id);
CREATE INDEX idx_game_invites_status ON game_invites(status);

-- Games reference table
CREATE TABLE games (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  icon TEXT,
  type TEXT,
  min_players INT,
  max_players INT,
  description TEXT,
  color TEXT
);

INSERT INTO games (id, name, icon, type, min_players, max_players, description, color) VALUES
  ('chess', 'Chess', '♟️', 'board', 2, 2, 'Classic strategy game', '#00d4ff'),
  ('beside-them', 'Beside Them', '🎭', 'board', 3, 10, 'Find the imposter among you', '#ff1493'),
  ('word-game', 'Word Race', '📝', 'card', 1, 8, 'Guess the word in 6 tries', '#00ff88'),
  ('spider-spider', 'Spider Spider 123', '🕷️', 'ar', 2, 20, 'Run from the spider!', '#ff6a00'),
  ('proximity-hunt', 'Proximity Hunt', '🎯', 'ar', 2, 100, 'Find players within 150ft', '#00d4ff');

-- RLS Policies
ALTER TABLE game_lobbies ENABLE ROW LEVEL SECURITY;
ALTER TABLE lobby_players ENABLE ROW LEVEL SECURITY;
ALTER TABLE player_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE game_invites ENABLE ROW LEVEL SECURITY;

-- Game lobbies: readable by all, writable by creator
CREATE POLICY "game_lobbies_read" ON game_lobbies FOR SELECT USING (true);
CREATE POLICY "game_lobbies_create" ON game_lobbies FOR INSERT WITH CHECK (auth.uid() = creator_id);
CREATE POLICY "game_lobbies_update_creator" ON game_lobbies FOR UPDATE USING (auth.uid() = creator_id);

-- Lobby players: readable by lobby members, writable by self
CREATE POLICY "lobby_players_read" ON lobby_players FOR SELECT USING (
  EXISTS (SELECT 1 FROM lobby_players lp WHERE lp.lobby_id = lobby_players.lobby_id AND lp.user_id = auth.uid())
);
CREATE POLICY "lobby_players_insert" ON lobby_players FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "lobby_players_update_self" ON lobby_players FOR UPDATE USING (auth.uid() = user_id);

-- Player locations: readable by all, writable by self
CREATE POLICY "player_locations_read" ON player_locations FOR SELECT USING (true);
CREATE POLICY "player_locations_upsert" ON player_locations FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "player_locations_update" ON player_locations FOR UPDATE USING (auth.uid() = user_id);

-- Game invites: readable by sender/receiver, writable by appropriate party
CREATE POLICY "game_invites_read" ON game_invites FOR SELECT USING (
  auth.uid() = from_user_id OR auth.uid() = to_user_id
);
CREATE POLICY "game_invites_insert" ON game_invites FOR INSERT WITH CHECK (auth.uid() = from_user_id);
CREATE POLICY "game_invites_update_receiver" ON game_invites FOR UPDATE USING (auth.uid() = to_user_id);
