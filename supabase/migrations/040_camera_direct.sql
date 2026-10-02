-- Camera posts + nearby lookup straight from the app (the deployed API function has no
-- /api/camera routes). Idempotent.

-- profile_media: users manage their own rows.
drop policy if exists "Own media insert" on public.profile_media;
create policy "Own media insert" on public.profile_media
  for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "Own media update" on public.profile_media;
create policy "Own media update" on public.profile_media
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "Own media delete" on public.profile_media;
create policy "Own media delete" on public.profile_media
  for delete to authenticated using (user_id = auth.uid());

alter table public.profile_media add column if not exists width integer;
alter table public.profile_media add column if not exists height integer;
alter table public.profile_media add column if not exists location_label text;

-- media_tags: the photographer tags people (who allow tagging); tagged people can see/hide.
alter table public.media_tags enable row level security;
drop policy if exists "Photographer can tag" on public.media_tags;
create policy "Photographer can tag" on public.media_tags
  for insert to authenticated with check (
    exists (select 1 from public.profile_media m where m.id = media_tags.media_id and m.user_id = auth.uid())
    and exists (select 1 from public.profiles p where p.id = media_tags.tagged_user_id and p.allow_tagging = true)
  );
drop policy if exists "See own tags" on public.media_tags;
create policy "See own tags" on public.media_tags
  for select to authenticated using (
    tagged_user_id = auth.uid()
    or exists (select 1 from public.profile_media m where m.id = media_tags.media_id and m.user_id = auth.uid())
  );
drop policy if exists "Hide own tag" on public.media_tags;
create policy "Hide own tag" on public.media_tags
  for update to authenticated using (tagged_user_id = auth.uid()) with check (tagged_user_id = auth.uid());
drop policy if exists "Remove own tag" on public.media_tags;
create policy "Remove own tag" on public.media_tags
  for delete to authenticated using (tagged_user_id = auth.uid());

-- People within ~150 ft who can be tagged (same rules as taggable_nearby), with position
-- so the camera can line them up with what it sees.
create or replace function public.camera_nearby(lat double precision, lng double precision, radius_m double precision default 45.72)
returns table (id uuid, username text, avatar_url text, distance_m double precision, latitude double precision, longitude double precision)
language sql stable security definer set search_path = public as $$
  select t.id, t.username, t.avatar_url, t.distance_m, l.latitude, l.longitude
  from public.taggable_nearby(auth.uid(), lat, lng, least(greatest(radius_m, 5), 200)) t
  join public.locations l on l.user_id = t.id
$$;
revoke all on function public.camera_nearby(double precision, double precision, double precision) from public;
grant execute on function public.camera_nearby(double precision, double precision, double precision) to authenticated;
