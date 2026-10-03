-- Guest "Explore" (logged-out visitors on the app and app.iyiyi.xyz can look around before
-- signing up). Only profiles that are already public (not private, not ghost) are listed, and
-- only coarse information leaves the database: no coordinates, and the distance is a label
-- for the range the person falls in. The smallest guest range is 1 mile, so a visitor can't
-- pin anyone down more precisely than that (150 ft is for signed-in members).
create or replace function public.guest_explore(
  lat double precision default null,
  lng double precision default null,
  radius_m double precision default null,
  lim integer default 60
)
returns table (id uuid, username text, avatar_url text, bio text, tags text[], account_type text, range_label text)
language sql stable security definer set search_path = public as $$
  with params as (
    select
      case when lat between -90 and 90 and lng between -180 and 180 and radius_m is not null
           then greatest(radius_m, 1609.34) end as r,
      least(greatest(coalesce(lim, 60), 1), 120) as n
  ),
  base as (
    select p.id, p.username, p.avatar_url, p.bio, p.tags::text[] as tags, p.account_type::text as account_type,
      case when l.latitude is null or (select r from params) is null then null
        else 2 * 6371000 * asin(sqrt(
          power(sin(radians(l.latitude - lat) / 2), 2) +
          cos(radians(lat)) * cos(radians(l.latitude)) * power(sin(radians(l.longitude - lng) / 2), 2)
        )) end as d,
      l.updated_at
    from public.profiles p
    left join public.locations l on l.user_id = p.id
    where coalesce(p.is_private, false) = false
      and coalesce(p.visibility, 'public') not in ('private', 'ghost')
      and p.username is not null and p.avatar_url is not null
  )
  select b.id, b.username, b.avatar_url, b.bio, b.tags, b.account_type,
    case
      when (select r from params) is null then null
      when b.d <= 1609.34 then 'Within 1 mi'
      when b.d <= 8046.7 then 'Within 5 mi'
      when b.d <= 40233.6 then 'Within 25 mi'
      when b.d <= 482803 then 'Within 300 mi'
      else 'Far away'
    end
  from base b
  where (select r from params) is null or (b.d is not null and b.d <= (select r from params))
  -- Ordered by range bucket, then most recently active, never by exact distance.
  order by case
      when b.d is null then 9 when b.d <= 1609.34 then 1 when b.d <= 8046.7 then 2
      when b.d <= 40233.6 then 3 when b.d <= 482803 then 4 else 5 end,
    b.updated_at desc nulls last
  limit (select n from params)
$$;

revoke all on function public.guest_explore(double precision, double precision, double precision, integer) from public;
grant execute on function public.guest_explore(double precision, double precision, double precision, integer) to anon, authenticated;
