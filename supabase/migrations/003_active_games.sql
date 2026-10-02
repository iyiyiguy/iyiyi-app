-- Track active games for join feature
create table active_games (
  id uuid primary key default gen_random_uuid(),
  lobby_id uuid not null references game_lobbies(id) on delete cascade,
  game_id text not null,
  game_name text not null,
  host_id uuid not null references auth.users(id) on delete cascade,
  players jsonb default '[]'::jsonb,
  status text default 'waiting',
  created_at timestamp default now(),
  updated_at timestamp default now(),
  expires_at timestamp default now() + interval '1 hour'
);

alter table active_games enable row level security;

create policy "Anyone can view active games" on active_games
  for select using (true);

create policy "Only host can update their game" on active_games
  for update using (auth.uid() = host_id);

create policy "Only host can delete their game" on active_games
  for delete using (auth.uid() = host_id);

create policy "Users can create active games" on active_games
  for insert with check (auth.uid() = host_id);

-- Index for efficient queries
create index idx_active_games_status on active_games(status);
create index idx_active_games_host on active_games(host_id);
create index idx_active_games_expires on active_games(expires_at);
