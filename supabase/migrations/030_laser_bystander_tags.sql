-- Laser Tag bystander tags.
-- iYiYi users who are NOT in a match can opt in to being tagged by Laser Tag players
-- (laser_taggable). Each tag is stored in laser_bystander_tags so a missed alert can be
-- shown the next time the target opens the app.
-- Idempotent: safe to run more than once. The app works without it (nobody is taggable).

-- ---------------------------------------------------------------------------------------
-- Opt-in
-- ---------------------------------------------------------------------------------------
create table if not exists public.laser_taggable (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  enabled boolean not null default false,
  updated_at timestamptz default now()
);

create index if not exists idx_laser_taggable_enabled on public.laser_taggable(user_id) where enabled;

alter table public.laser_taggable enable row level security;

drop policy if exists "laser_taggable_select_authenticated" on public.laser_taggable;
create policy "laser_taggable_select_authenticated" on public.laser_taggable
  for select to authenticated using (true);

drop policy if exists "laser_taggable_insert_own" on public.laser_taggable;
create policy "laser_taggable_insert_own" on public.laser_taggable
  for insert to authenticated with check (user_id = auth.uid());

drop policy if exists "laser_taggable_update_own" on public.laser_taggable;
create policy "laser_taggable_update_own" on public.laser_taggable
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------------------------------------------------------------------------------------
-- Tags
-- ---------------------------------------------------------------------------------------
create table if not exists public.laser_bystander_tags (
  id uuid primary key default gen_random_uuid(),
  target_id uuid not null references public.profiles(id) on delete cascade,
  from_id uuid not null references public.profiles(id) on delete cascade,
  from_name text,
  code text,
  created_at timestamptz default now(),
  seen boolean not null default false
);

create index if not exists idx_laser_bystander_tags_target_unseen
  on public.laser_bystander_tags(target_id, created_at desc) where not seen;
create index if not exists idx_laser_bystander_tags_from
  on public.laser_bystander_tags(from_id, created_at desc);

alter table public.laser_bystander_tags enable row level security;

-- Only the shooter can insert, and only against someone who opted in.
drop policy if exists "laser_bystander_tags_insert" on public.laser_bystander_tags;
create policy "laser_bystander_tags_insert" on public.laser_bystander_tags
  for insert to authenticated with check (
    from_id = auth.uid()
    and target_id <> auth.uid()
    and exists (
      select 1 from public.laser_taggable t
      where t.user_id = laser_bystander_tags.target_id and t.enabled = true
    )
  );

-- Only the target can read / mark their tags (the app generates the row id client-side,
-- so the shooter never needs to read the row back).
drop policy if exists "laser_bystander_tags_select_target" on public.laser_bystander_tags;
create policy "laser_bystander_tags_select_target" on public.laser_bystander_tags
  for select to authenticated using (target_id = auth.uid());

drop policy if exists "laser_bystander_tags_update_target" on public.laser_bystander_tags;
create policy "laser_bystander_tags_update_target" on public.laser_bystander_tags
  for update to authenticated using (target_id = auth.uid()) with check (target_id = auth.uid());

grant select, insert, update on public.laser_taggable to authenticated;
grant select, insert, update on public.laser_bystander_tags to authenticated;
