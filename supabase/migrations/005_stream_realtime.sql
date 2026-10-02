-- Live Stream screen: lets signed-in clients receive Supabase Realtime INSERT events for
-- profile_media. Realtime postgres_changes respect RLS, so this adds a narrow SELECT policy
-- (own media; otherwise public/ghost owners, or private owners you follow with an accepted
-- follow; never anyone in a block relationship with you) and adds the table to the
-- supabase_realtime publication. Idempotent - safe to run more than once.
-- Without this migration the app falls back to polling /api/content/feed every 10s.

-- Block check that can see both directions of blocked_users regardless of its own RLS.
create or replace function public.stream_can_see_owner(owner uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    owner = auth.uid()
    or (
      not exists (
        select 1 from blocked_users b
        where (b.user_id = auth.uid() and b.blocked_id = owner)
           or (b.user_id = owner and b.blocked_id = auth.uid())
      )
      and exists (
        select 1 from profiles p
        where p.id = owner
          and (
            coalesce(p.visibility, 'public') <> 'private'
            or exists (
              select 1 from follows f
              where f.follower_id = auth.uid() and f.followed_id = owner and f.status = 'accepted'
            )
          )
      )
    );
$$;

revoke all on function public.stream_can_see_owner(uuid) from public;
grant execute on function public.stream_can_see_owner(uuid) to authenticated;

alter table profile_media enable row level security;

drop policy if exists "Stream: authenticated can read visible media" on profile_media;
create policy "Stream: authenticated can read visible media"
  on profile_media for select
  to authenticated
  using (public.stream_can_see_owner(user_id));

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'profile_media'
     ) then
    execute 'alter publication supabase_realtime add table public.profile_media';
  end if;
end $$;
