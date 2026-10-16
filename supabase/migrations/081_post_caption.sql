-- Post descriptions: the caption written on the upload screen after shooting (shown under the
-- post in the feed and viewer). Idempotent.
alter table public.profile_media add column if not exists caption text;
do $$ begin
  alter table public.profile_media add constraint profile_media_caption_len check (caption is null or char_length(caption) <= 2200);
exception when duplicate_object then null; end $$;
