-- Optional: lets the app's Activity and Recap screens read the rows that concern the signed-in
-- user directly (they are built client-side because /api/activity and /api/profiles/me/recap
-- don't exist on the deployed API). Without this, those screens fall back to the API routes
-- that do exist and simply show less. Read-only, scoped to your own rows. Idempotent.

alter table follows enable row level security;
drop policy if exists "Read follows involving me" on follows;
create policy "Read follows involving me" on follows
  for select to authenticated
  using (follower_id = auth.uid() or followed_id = auth.uid());

alter table media_likes enable row level security;
drop policy if exists "Read likes on my media or by me" on media_likes;
create policy "Read likes on my media or by me" on media_likes
  for select to authenticated
  using (
    user_id = auth.uid()
    or exists (select 1 from profile_media m where m.id = media_likes.media_id and m.user_id = auth.uid())
  );

alter table media_comments enable row level security;
drop policy if exists "Read comments on my media or by me" on media_comments;
create policy "Read comments on my media or by me" on media_comments
  for select to authenticated
  using (
    user_id = auth.uid()
    or exists (select 1 from profile_media m where m.id = media_comments.media_id and m.user_id = auth.uid())
  );

alter table profile_views enable row level security;
drop policy if exists "Read views of my profile" on profile_views;
create policy "Read views of my profile" on profile_views
  for select to authenticated
  using (viewed_user_id = auth.uid());
