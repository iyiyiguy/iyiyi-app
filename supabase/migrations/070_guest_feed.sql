-- Guest "Recommended" and "Feed" tabs (logged-out visitors in the app and on app.iyiyi.xyz).
-- The signed-in screens use the authed API, so anonymous visitors get these two read-only
-- functions instead. Same privacy rules as guest_explore (060): only owners whose profile is
-- public (not is_private, visibility not 'private'/'ghost') are included, and no location
-- data ever leaves the database (no coordinates, no captured_lat/lng, no location_label).
-- Idempotent - safe to run more than once.

-- Public posts, newest first (or most liked). `before` pages backwards by created_at.
-- media_url is the watermarked copy when there is one.
create or replace function public.guest_feed(
  lim integer default 30,
  before timestamptz default null,
  sort text default 'recent'
)
returns table (
  id text,
  media_url text,
  media_type text,
  width integer,
  height integer,
  created_at timestamptz,
  owner_id uuid,
  owner_username text,
  owner_avatar_url text,
  like_count bigint,
  comment_count bigint
)
language sql stable security definer set search_path = public as $$
  with params as (
    select least(greatest(coalesce(guest_feed.lim, 30), 1), 60) as n,
           case when guest_feed.sort = 'popular' then 'popular' else 'recent' end as s
  ),
  base as (
    select m.id, coalesce(nullif(m.watermarked_url, ''), m.media_url) as url,
      case when m.media_type::text = 'video' then 'video' else 'photo' end as kind,
      m.width, m.height, m.created_at, p.id as pid, p.username, p.avatar_url
    from public.profile_media m
    join public.profiles p on p.id = m.user_id
    where coalesce(p.is_private, false) = false
      and coalesce(p.visibility, 'public') not in ('private', 'ghost')
      and p.username is not null
      and coalesce(m.media_url, '') <> ''
      and (guest_feed.before is null or m.created_at < guest_feed.before)
    order by m.created_at desc
    -- 'popular' ranks within the newest 500 public posts so it stays cheap and fresh.
    limit (select case when s = 'popular' then 500 else n end from params)
  ),
  counted as (
    select b.*,
      (select count(*) from public.media_likes l where l.media_id = b.id) as likes,
      (select count(*) from public.media_comments c where c.media_id = b.id) as comments
    from base b
  )
  select c.id::text, c.url, c.kind, c.width::integer, c.height::integer, c.created_at,
    c.pid, c.username, c.avatar_url, c.likes, c.comments
  from counted c
  order by
    case when (select s from params) = 'popular' then c.likes else 0 end desc,
    c.created_at desc
  limit (select n from params)
$$;

revoke all on function public.guest_feed(integer, timestamptz, text) from public;
grant execute on function public.guest_feed(integer, timestamptz, text) to anon, authenticated;

-- Public profiles worth a look: most followed first, then most posts, then most recently active.
create or replace function public.guest_recommended(lim integer default 60)
returns table (
  id uuid,
  username text,
  avatar_url text,
  bio text,
  tags text[],
  account_type text,
  follower_count bigint,
  post_count bigint
)
language sql stable security definer set search_path = public as $$
  select p.id, p.username, p.avatar_url, p.bio, p.tags::text[], p.account_type::text,
    (select count(*) from public.follows f where f.followed_id = p.id and coalesce(f.status, 'accepted') = 'accepted') as followers,
    (select count(*) from public.profile_media m where m.user_id = p.id) as posts
  from public.profiles p
  left join public.locations l on l.user_id = p.id
  where coalesce(p.is_private, false) = false
    and coalesce(p.visibility, 'public') not in ('private', 'ghost')
    and p.username is not null and p.avatar_url is not null
  order by followers desc, posts desc, l.updated_at desc nulls last
  limit least(greatest(coalesce(guest_recommended.lim, 60), 1), 120)
$$;

revoke all on function public.guest_recommended(integer) from public;
grant execute on function public.guest_recommended(integer) to anon, authenticated;
