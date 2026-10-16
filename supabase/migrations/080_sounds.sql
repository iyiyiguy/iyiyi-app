-- Sounds (Studio beats / samples), saved sounds, plays (views), copyright reports, and video
-- edits on posts. Idempotent.
--
-- Status: 'private' (owner only) | 'scanning' -> 'public' (passed the AudD check, set only by
-- the sound-scan edge function with the service role) or 'blocked' (matched a commercial song).
-- Copyright: an open report older than 12 hours mutes the sound everywhere (is_muted) until an
-- admin keeps it (report dismissed) or takes it down. No cron needed: is_muted is computed.

create table if not exists public.sounds (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null default 'Untitled beat',
  audio_url text not null,
  storage_path text,
  duration_s real,
  bpm integer,
  kind text not null default 'beat',
  tags text[] not null default '{}',
  status text not null default 'private' check (status in ('private', 'scanning', 'public', 'blocked')),
  project_id text,
  use_count integer not null default 0,
  play_count integer not null default 0,
  taken_down_at timestamptz,
  scan jsonb,
  scanned_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists sounds_user_idx on public.sounds (user_id, created_at desc);
create index if not exists sounds_public_idx on public.sounds (status, use_count desc);
create index if not exists sounds_tags_idx on public.sounds using gin (tags);

create table if not exists public.saved_sounds (
  user_id uuid not null references auth.users (id) on delete cascade,
  sound_id uuid not null references public.sounds (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, sound_id)
);

create table if not exists public.sound_plays (
  id bigint generated always as identity primary key,
  sound_id uuid not null references public.sounds (id) on delete cascade,
  user_id uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists sound_plays_recent_idx on public.sound_plays (sound_id, created_at desc);

create table if not exists public.sound_reports (
  id uuid primary key default gen_random_uuid(),
  sound_id uuid not null references public.sounds (id) on delete cascade,
  reporter_id uuid references auth.users (id) on delete set null,
  contact_email text,
  reason text,
  owns_work boolean not null default false,
  status text not null default 'open' check (status in ('open', 'dismissed', 'upheld')),
  emailed_at timestamptz,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid
);
create index if not exists sound_reports_open_idx on public.sound_reports (sound_id) where status = 'open';

alter table public.profile_media add column if not exists edit jsonb;
alter table public.profile_media add column if not exists sound_id uuid references public.sounds (id) on delete set null;

-- Admins (copyright review): the owner accounts.
create or replace function public.is_sound_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(lower(auth.jwt() ->> 'email') in ('iyiyiguy@gmail.com', 'hibernationprophet@gmail.com', 'playappdev16@gmail.com', 'iyiyidev@gmail.com'), false)
$$;

-- Computed column: sounds.is_muted (PostgREST: select=...,is_muted)
create or replace function public.is_muted(s public.sounds)
returns boolean language sql stable security definer set search_path = public as $$
  select s.taken_down_at is not null
    or exists (select 1 from public.sound_reports r where r.sound_id = s.id and r.status = 'open' and r.created_at < now() - interval '12 hours')
$$;

-- Clients can't make a sound public (only the scan can), or edit counters / takedowns.
create or replace function public.sounds_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- service role (scan function) and our own trusted functions (they set iyiyi.trusted) pass
  if coalesce(auth.role(), '') = 'service_role' or current_setting('iyiyi.trusted', true) = '1' then return new; end if;
  if tg_op = 'INSERT' then
    new.use_count := 0; new.play_count := 0; new.taken_down_at := null; new.scan := null; new.scanned_at := null;
    if new.status not in ('private', 'scanning') then new.status := 'private'; end if;
    new.user_id := auth.uid();
  else
    new.use_count := old.use_count; new.play_count := old.play_count; new.taken_down_at := old.taken_down_at;
    new.scan := old.scan; new.scanned_at := old.scanned_at; new.user_id := old.user_id;
    new.audio_url := old.audio_url; new.storage_path := old.storage_path;
    if new.status <> old.status then
      if old.status = 'blocked' then new.status := 'blocked';
      elsif new.status not in ('private', 'scanning') then new.status := old.status;
      end if;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists sounds_guard on public.sounds;
create trigger sounds_guard before insert or update on public.sounds for each row execute function public.sounds_guard();

-- Count videos using a sound.
create or replace function public.media_sound_count()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform set_config('iyiyi.trusted', '1', true);
  if tg_op = 'INSERT' and new.sound_id is not null then
    update public.sounds set use_count = use_count + 1 where id = new.sound_id;
  elsif tg_op = 'DELETE' and old.sound_id is not null then
    update public.sounds set use_count = greatest(0, use_count - 1) where id = old.sound_id;
  end if;
  perform set_config('iyiyi.trusted', '', true);
  return null;
end $$;
drop trigger if exists media_sound_count on public.profile_media;
create trigger media_sound_count after insert or delete on public.profile_media for each row execute function public.media_sound_count();

-- RLS
alter table public.sounds enable row level security;
drop policy if exists "Sounds readable" on public.sounds;
create policy "Sounds readable" on public.sounds for select using (status = 'public' or user_id = auth.uid() or public.is_sound_admin());
drop policy if exists "Own sounds insert" on public.sounds;
create policy "Own sounds insert" on public.sounds for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "Own sounds update" on public.sounds;
create policy "Own sounds update" on public.sounds for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "Own sounds delete" on public.sounds;
create policy "Own sounds delete" on public.sounds for delete to authenticated using (user_id = auth.uid());

alter table public.saved_sounds enable row level security;
drop policy if exists "Own saved sounds" on public.saved_sounds;
create policy "Own saved sounds" on public.saved_sounds for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

alter table public.sound_plays enable row level security; -- written only through record_sound_play

alter table public.sound_reports enable row level security;
drop policy if exists "See own reports" on public.sound_reports;
create policy "See own reports" on public.sound_reports for select to authenticated using (reporter_id = auth.uid() or public.is_sound_admin());

-- A play / view of a sound (preview, or a video with it). One per person per sound per hour.
create or replace function public.record_sound_play(p_sound uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.sound_plays where sound_id = p_sound and user_id is not distinct from auth.uid() and created_at > now() - interval '1 hour') then
    return;
  end if;
  insert into public.sound_plays (sound_id, user_id) values (p_sound, auth.uid());
  perform set_config('iyiyi.trusted', '1', true);
  update public.sounds set play_count = play_count + 1 where id = p_sound;
  perform set_config('iyiyi.trusted', '', true);
end $$;
grant execute on function public.record_sound_play(uuid) to anon, authenticated;

-- Search / browse public sounds. sort: 'trending' (last 7 days of videos + plays), 'popular', 'new'.
create or replace function public.search_sounds(q text default '', lim integer default 40, tag text default null, sort text default 'popular')
returns table (
  id uuid, user_id uuid, title text, audio_url text, duration_s real, bpm integer, kind text, tags text[], status text,
  use_count integer, play_count integer, created_at timestamptz, is_muted boolean, trend_score numeric, profiles jsonb
)
language sql stable security definer set search_path = public as $$
  with base as (
    select s.*, p.username, p.avatar_url
    from public.sounds s
    left join public.profiles p on p.id = s.user_id
    where s.status = 'public' and not public.is_muted(s)
      and (coalesce(q, '') = '' or s.title ilike '%' || q || '%' or p.username ilike '%' || q || '%' or exists (select 1 from unnest(s.tags) t where t ilike q || '%'))
      and (tag is null or tag = any (s.tags))
  ), scored as (
    select b.*,
      (select count(*) from public.profile_media m where m.sound_id = b.id and m.created_at > now() - interval '7 days') * 3
      + (select count(*) from public.sound_plays sp where sp.sound_id = b.id and sp.created_at > now() - interval '7 days') as trend
    from base b
  )
  select id, user_id, title, audio_url, duration_s, bpm, kind, tags, status, use_count, play_count, created_at, false, trend::numeric,
    jsonb_build_object('username', username, 'avatar_url', avatar_url)
  from scored
  order by
    case when sort = 'trending' then trend end desc nulls last,
    case when sort = 'new' then created_at end desc nulls last,
    use_count desc, play_count desc, created_at desc
  limit least(greatest(coalesce(lim, 40), 1), 100)
$$;
grant execute on function public.search_sounds(text, integer, text, text) to anon, authenticated;

-- Tags in use (for the filter chips), most used first.
create or replace function public.sound_tags(lim integer default 30)
returns table (tag text, n bigint) language sql stable security definer set search_path = public as $$
  select t, count(*) from public.sounds s, unnest(s.tags) t where s.status = 'public' group by t order by 2 desc, 1 limit lim
$$;
grant execute on function public.sound_tags(integer) to anon, authenticated;

-- Copyright report from the app. Returns the report id (the app then asks the site worker to
-- email it to the admin).
create or replace function public.submit_sound_report(p_sound uuid, p_reason text, p_contact text, p_owns boolean)
returns uuid language plpgsql security definer set search_path = public as $$
declare rid uuid;
begin
  if auth.uid() is null then raise exception 'Sign in to report a sound'; end if;
  if not exists (select 1 from public.sounds where id = p_sound) then raise exception 'Sound not found'; end if;
  if (select count(*) from public.sound_reports where reporter_id = auth.uid() and created_at > now() - interval '1 day') >= 10 then
    raise exception 'Too many reports today';
  end if;
  insert into public.sound_reports (sound_id, reporter_id, contact_email, reason, owns_work)
  values (p_sound, auth.uid(), left(p_contact, 200), left(p_reason, 2000), coalesce(p_owns, false))
  returning id into rid;
  return rid;
end $$;
grant execute on function public.submit_sound_report(uuid, text, text, boolean) to authenticated;

-- One-time read of a fresh report for the email worker (no secret needed: it only returns a
-- report once, within 30 minutes of filing, then marks it emailed).
create or replace function public.claim_report_email(p_report uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r record;
begin
  update public.sound_reports set emailed_at = now()
  where id = p_report and emailed_at is null and created_at > now() - interval '30 minutes'
  returning * into r;
  if r.id is null then return null; end if;
  return (
    select jsonb_build_object(
      'report_id', r.id, 'reason', r.reason, 'contact_email', r.contact_email, 'owns_work', r.owns_work, 'created_at', r.created_at,
      'sound_id', s.id, 'sound_title', s.title, 'audio_url', s.audio_url, 'status', s.status, 'use_count', s.use_count,
      'creator', (select username from public.profiles where id = s.user_id),
      'reporter', (select username from public.profiles where id = r.reporter_id),
      'open_reports', (select count(*) from public.sound_reports x where x.sound_id = s.id and x.status = 'open')
    ) from public.sounds s where s.id = r.sound_id
  );
end $$;
grant execute on function public.claim_report_email(uuid) to anon, authenticated;

-- Admin review: 'dismiss' (keep the sound, unmutes it), 'takedown' (mute everywhere),
-- 'reinstate' (undo a takedown and dismiss open reports).
create or replace function public.resolve_sound_report(p_sound uuid, p_action text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_sound_admin() then raise exception 'Not allowed'; end if;
  perform set_config('iyiyi.trusted', '1', true);
  if p_action = 'takedown' then
    update public.sounds set taken_down_at = now() where id = p_sound;
    update public.sound_reports set status = 'upheld', resolved_at = now(), resolved_by = auth.uid() where sound_id = p_sound and status = 'open';
  elsif p_action in ('dismiss', 'reinstate') then
    update public.sounds set taken_down_at = null where id = p_sound;
    update public.sound_reports set status = 'dismissed', resolved_at = now(), resolved_by = auth.uid() where sound_id = p_sound and status = 'open';
  else
    raise exception 'Unknown action';
  end if;
  perform set_config('iyiyi.trusted', '', true);
end $$;
grant execute on function public.resolve_sound_report(uuid, text) to authenticated;

-- Admin list of sounds with reports (open first).
create or replace function public.sound_report_queue()
returns table (sound_id uuid, title text, audio_url text, creator text, status text, taken_down boolean, muted boolean, open_reports bigint, last_report timestamptz, mute_at timestamptz, reasons text[])
language sql stable security definer set search_path = public as $$
  select s.id, s.title, s.audio_url, p.username, s.status, s.taken_down_at is not null, public.is_muted(s),
    count(*) filter (where r.status = 'open'), max(r.created_at),
    min(r.created_at) filter (where r.status = 'open') + interval '12 hours',
    (array_agg(r.reason order by r.created_at desc))[1:5]
  from public.sound_reports r
  join public.sounds s on s.id = r.sound_id
  left join public.profiles p on p.id = s.user_id
  where public.is_sound_admin()
  group by s.id, p.username
  order by count(*) filter (where r.status = 'open') desc, max(r.created_at) desc
  limit 200
$$;
grant execute on function public.sound_report_queue() to authenticated;

-- Music: playlists of sounds (beats, samples and full songs members upload). Public playlists
-- show on the owner's profile; private ones are only for them.
create table if not exists public.playlists (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null default 'My playlist',
  visibility text not null default 'private' check (visibility in ('private', 'public')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists playlists_user_idx on public.playlists (user_id, updated_at desc);

create table if not exists public.playlist_items (
  playlist_id uuid not null references public.playlists (id) on delete cascade,
  sound_id uuid not null references public.sounds (id) on delete cascade,
  position integer not null default 0,
  added_at timestamptz not null default now(),
  primary key (playlist_id, sound_id)
);

alter table public.playlists enable row level security;
drop policy if exists "Playlists readable" on public.playlists;
create policy "Playlists readable" on public.playlists for select using (visibility = 'public' or user_id = auth.uid());
drop policy if exists "Own playlists write" on public.playlists;
create policy "Own playlists write" on public.playlists for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

alter table public.playlist_items enable row level security;
drop policy if exists "Playlist items readable" on public.playlist_items;
create policy "Playlist items readable" on public.playlist_items for select using (
  exists (select 1 from public.playlists p where p.id = playlist_id and (p.visibility = 'public' or p.user_id = auth.uid()))
);
drop policy if exists "Own playlist items write" on public.playlist_items;
create policy "Own playlist items write" on public.playlist_items for all to authenticated using (
  exists (select 1 from public.playlists p where p.id = playlist_id and p.user_id = auth.uid())
) with check (
  exists (select 1 from public.playlists p where p.id = playlist_id and p.user_id = auth.uid())
);
