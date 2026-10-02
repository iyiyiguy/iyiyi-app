-- Ranking and game history tables
create table game_rankings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  game_id text not null,
  rating integer default 1200,
  wins integer default 0,
  losses integer default 0,
  mode text default 'social',
  updated_at timestamp default now(),
  unique(user_id, game_id)
);

create table game_history (
  id uuid primary key default gen_random_uuid(),
  game_id text not null,
  game_name text not null,
  winner_id uuid references auth.users(id),
  player_ids jsonb default '[]'::jsonb,
  scores jsonb default '{}'::jsonb,
  mode text default 'social',
  duration_seconds integer,
  played_at timestamp default now()
);

create table game_invites (
  id uuid primary key default gen_random_uuid(),
  from_user_id uuid not null references auth.users(id) on delete cascade,
  to_user_id uuid not null references auth.users(id) on delete cascade,
  game_id text not null,
  game_name text not null,
  lobby_id uuid,
  status text default 'pending',
  created_at timestamp default now(),
  expires_at timestamp default now() + interval '1 hour'
);

alter table game_rankings enable row level security;
alter table game_history enable row level security;
alter table game_invites enable row level security;

create policy "Users can view own rankings" on game_rankings
  for select using (auth.uid() = user_id or true);

create policy "Users can update own rankings" on game_rankings
  for update using (auth.uid() = user_id);

create policy "System can insert rankings" on game_rankings
  for insert with check (true);

create policy "Anyone can view game history" on game_history
  for select using (true);

create policy "System can insert game history" on game_history
  for insert with check (true);

create policy "Users can view own invites" on game_invites
  for select using (auth.uid() = to_user_id or auth.uid() = from_user_id);

create policy "Users can create invites" on game_invites
  for insert with check (auth.uid() = from_user_id);

create policy "Users can update own invites" on game_invites
  for update using (auth.uid() = to_user_id);

create index idx_game_rankings_user on game_rankings(user_id);
create index idx_game_rankings_game on game_rankings(game_id);
create index idx_game_history_played on game_history(played_at);
create index idx_game_invites_recipient on game_invites(to_user_id);
