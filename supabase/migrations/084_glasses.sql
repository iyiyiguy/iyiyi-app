-- 084: link Meta Ray-Ban Display glasses (the iYiYi glasses web app at iyiyi.xyz/glasses) to an
-- account without typing a password on the glasses.
--
--   1. The glasses make a random secret, keep it, and call glasses_link_start(sha256(secret)).
--      They get a short code and show it in the lens.
--   2. The member types the code in the iYiYi app (signed in): glasses_link_claim(code).
--   3. The glasses poll the edge function glasses-link with { code, secret }. Once claimed it
--      checks the secret against the hash and hands back a one-time sign-in token for that
--      member (service role), so the glasses get their own session. Each code works once and
--      only for 10 minutes.
--
-- glasses_pair_key(): a random per-member key. The phone and the glasses both read it (each with
-- their own session) and talk over the realtime topic glasses:<user id>:<key> (head aim + fire
-- from the glasses, the laser tag HUD from the phone).

create table if not exists public.glasses_links (
  code text primary key,
  secret_hash text not null,
  user_id uuid references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  claimed_at timestamptz,
  consumed_at timestamptz
);
alter table public.glasses_links enable row level security;
-- no policies: only the functions below (and the service role) touch it

create table if not exists public.glasses_pairs (
  user_id uuid primary key references auth.users (id) on delete cascade,
  pair_key text not null,
  created_at timestamptz not null default now()
);
alter table public.glasses_pairs enable row level security;

create or replace function public.glasses_link_start(p_secret_hash text)
returns text language plpgsql security definer set search_path = public as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  c text;
  i int;
begin
  if p_secret_hash is null or p_secret_hash !~ '^[0-9a-f]{64}$' then raise exception 'bad secret'; end if;
  delete from public.glasses_links where created_at < now() - interval '1 hour';
  -- light flood guard: at most 300 open codes at once across everyone
  if (select count(*) from public.glasses_links where consumed_at is null) > 300 then raise exception 'busy, try again in a minute'; end if;
  for attempt in 1..8 loop
    c := '';
    for i in 1..6 loop c := c || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1); end loop;
    begin
      insert into public.glasses_links (code, secret_hash) values (c, p_secret_hash);
      return c;
    exception when unique_violation then null;
    end;
  end loop;
  raise exception 'could not make a code';
end $$;
grant execute on function public.glasses_link_start(text) to anon, authenticated;

create or replace function public.glasses_link_claim(p_code text)
returns boolean language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if auth.uid() is null then raise exception 'sign in first'; end if;
  update public.glasses_links set user_id = auth.uid(), claimed_at = now()
  where code = upper(trim(p_code)) and user_id is null and consumed_at is null
    and created_at > now() - interval '10 minutes';
  get diagnostics n = row_count;
  return n > 0;
end $$;
grant execute on function public.glasses_link_claim(text) to authenticated;

create or replace function public.glasses_pair_key()
returns text language plpgsql security definer set search_path = public as $$
declare k text;
begin
  if auth.uid() is null then raise exception 'sign in first'; end if;
  select pair_key into k from public.glasses_pairs where user_id = auth.uid();
  if k is null then
    k := encode(extensions.gen_random_bytes(18), 'hex');
    insert into public.glasses_pairs (user_id, pair_key) values (auth.uid(), k)
    on conflict (user_id) do update set pair_key = public.glasses_pairs.pair_key
    returning pair_key into k;
  end if;
  return k;
end $$;
grant execute on function public.glasses_pair_key() to authenticated;
