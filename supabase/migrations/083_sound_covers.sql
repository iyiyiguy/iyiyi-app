-- 083: cover art (thumbnail) for sounds, set by the owner from Music (applied 2026-10-17).
-- Images live in profile-media/<uid>/sounds/covers/. Owners can already update their rows
-- (policy "Own sounds update").
alter table public.sounds add column if not exists cover_url text;
