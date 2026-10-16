-- Map: each person's best post (most liked / shared / commented) shows as their pin, instead of
-- just the profile picture. Shares are counted when someone shares a post from the app.
-- Idempotent.
create table if not exists public.media_shares (
  id bigint generated always as identity primary key,
  media_id bigint not null references public.profile_media (id) on delete cascade,
  user_id uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists media_shares_media_idx on public.media_shares (media_id);
alter table public.media_shares enable row level security; -- written only through record_media_share

-- One share per person per post per hour.
create or replace function public.record_media_share(p_media bigint)
returns void language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.media_shares where media_id = p_media and user_id is not distinct from auth.uid() and created_at > now() - interval '1 hour') then
    return;
  end if;
  insert into public.media_shares (media_id, user_id) values (p_media, auth.uid());
end $$;
grant execute on function public.record_media_share(bigint) to authenticated;

-- Best photo post per user for the map pins (only posts the caller is allowed to see).
-- score = likes x2 + shares x3 + comments; ties go to the newest.
create or replace function public.map_top_posts(p_users uuid[])
returns table (user_id uuid, media_id bigint, media_url text, width integer, height integer, score bigint)
language sql stable security definer set search_path = public as $$
  select distinct on (m.user_id)
    m.user_id, m.id, coalesce(m.watermarked_url, m.media_url), m.width, m.height,
    (select count(*) from public.media_likes l where l.media_id = m.id) * 2
      + (select count(*) from public.media_shares s where s.media_id = m.id) * 3
      + (select count(*) from public.media_comments c where c.media_id = m.id) as score
  from public.profile_media m
  where m.user_id = any (p_users[1:300])
    and m.media_type = 'photo'
    and public.stream_can_see_owner(m.user_id)
  order by m.user_id, score desc, m.created_at desc
$$;
grant execute on function public.map_top_posts(uuid[]) to authenticated;
