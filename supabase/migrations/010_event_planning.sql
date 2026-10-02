-- Event planning (cover, category, end time, map location, privacy) + Going/Interested RSVPs.
-- Idempotent: safe to run more than once. The app works without it (new fields are dropped,
-- "Interested" is kept on-device) but needs it for covers, map pins and invite-only events.

alter table public.events add column if not exists cover_url text;
alter table public.events add column if not exists category text;
alter table public.events add column if not exists ends_at timestamptz;
alter table public.events add column if not exists address text;
alter table public.events add column if not exists latitude double precision;
alter table public.events add column if not exists longitude double precision;
alter table public.events add column if not exists visibility text not null default 'public';

-- Non-game events no longer need a game.
alter table public.events alter column game_id set default 'event';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'events_visibility_check') then
    alter table public.events add constraint events_visibility_check check (visibility in ('public', 'invite'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'events_ends_after_start') then
    alter table public.events add constraint events_ends_after_start check (ends_at is null or ends_at > event_date);
  end if;
end $$;

create index if not exists idx_events_lat_lng on public.events(latitude, longitude) where latitude is not null;

-- RSVP status on attendees: 'going' (default, = the old meaning of a row) or 'interested'.
alter table public.event_attendees add column if not exists status text not null default 'going';
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'event_attendees_status_check') then
    alter table public.event_attendees add constraint event_attendees_status_check check (status in ('going', 'interested'));
  end if;
end $$;

-- Switching Going <-> Interested is an upsert, which needs UPDATE on your own row.
drop policy if exists "Users can update their RSVP" on public.event_attendees;
create policy "Users can update their RSVP" on public.event_attendees
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Invite-only events: visible to the host, invitees and attendees only.
drop policy if exists "Anyone can view events" on public.events;
drop policy if exists "View public or invited events" on public.events;
create policy "View public or invited events" on public.events
  for select using (
    visibility = 'public'
    or auth.uid() = creator_id
    or exists (select 1 from public.event_invites i where i.event_id = events.id and i.invited_user_id = auth.uid())
    or exists (select 1 from public.event_attendees a where a.event_id = events.id and a.user_id = auth.uid())
  );

-- Hosts can remove their own event.
drop policy if exists "Event creator can delete their event" on public.events;
create policy "Event creator can delete their event" on public.events
  for delete using (auth.uid() = creator_id);
