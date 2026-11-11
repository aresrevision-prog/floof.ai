-- MagicWinter accounts (username + password) — run once in Supabase → SQL Editor → New query → Run.
-- Works for Floof AI, the MagicWinter Studio site and Frontline. No emails involved.
-- Passwords are stored only as bcrypt hashes. Tables are locked: the website can only call the functions below.

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.mw_accounts (
  username      text primary key check (username ~ '^[a-z0-9][a-z0-9_]{2,19}$'),
  display_name  text not null,
  pass_hash     text not null,
  created_at    timestamptz not null default now(),
  failed        int not null default 0,
  locked_until  timestamptz
);
create table if not exists public.mw_sessions (
  token       text primary key,
  username    text not null references public.mw_accounts(username) on delete cascade,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null
);
alter table public.mw_accounts enable row level security;
alter table public.mw_sessions enable row level security;
revoke all on public.mw_accounts, public.mw_sessions from anon, authenticated;

-- new session token (30 days)
create or replace function public.mw__session(u text) returns text
language plpgsql security definer set search_path = public, extensions as $$
declare t text := encode(extensions.gen_random_bytes(24), 'hex');
begin
  delete from mw_sessions where expires_at < now();
  insert into mw_sessions(token, username, expires_at) values (t, u, now() + interval '30 days');
  return t;
end $$;
revoke all on function public.mw__session(text) from public, anon, authenticated;

create or replace function public.mw_signup(p_username text, p_password text) returns json
language plpgsql security definer set search_path = public, extensions as $$
declare u text := lower(trim(coalesce(p_username, '')));
begin
  if u !~ '^[a-z0-9][a-z0-9_]{2,19}$' then return json_build_object('error', 'Username: 3–20 letters, numbers or _.'); end if;
  if length(coalesce(p_password, '')) < 6 or length(p_password) > 200 then return json_build_object('error', 'Password needs at least 6 characters.'); end if;
  if exists (select 1 from mw_accounts where username = u) then return json_build_object('error', 'That username is taken.'); end if;
  insert into mw_accounts(username, display_name, pass_hash) values (u, trim(p_username), extensions.crypt(p_password, extensions.gen_salt('bf', 10)));
  return json_build_object('ok', true, 'username', trim(p_username), 'token', mw__session(u));
end $$;

create or replace function public.mw_login(p_username text, p_password text) returns json
language plpgsql security definer set search_path = public, extensions as $$
declare u text := lower(trim(coalesce(p_username, ''))); a mw_accounts;
begin
  select * into a from mw_accounts where username = u;
  if not found then perform pg_sleep(0.3); return json_build_object('error', 'Wrong username or password.'); end if;
  if a.locked_until is not null and a.locked_until > now() then
    return json_build_object('error', 'Too many tries — wait a minute and try again.'); end if;
  if extensions.crypt(coalesce(p_password, ''), a.pass_hash) <> a.pass_hash then
    update mw_accounts set
      locked_until = case when failed + 1 >= 5 then now() + interval '1 minute' else null end,
      failed       = case when failed + 1 >= 5 then 0 else failed + 1 end
    where username = u;
    return json_build_object('error', 'Wrong username or password.');
  end if;
  update mw_accounts set failed = 0, locked_until = null where username = u;
  return json_build_object('ok', true, 'username', a.display_name, 'token', mw__session(u));
end $$;

create or replace function public.mw_change_password(p_username text, p_old text, p_new text) returns json
language plpgsql security definer set search_path = public, extensions as $$
declare r json := mw_login(p_username, p_old); u text := lower(trim(coalesce(p_username, '')));
begin
  if (r->>'ok') is null then return json_build_object('error', 'Current password is wrong.'); end if;
  if length(coalesce(p_new, '')) < 6 or length(p_new) > 200 then return json_build_object('error', 'New password needs at least 6 characters.'); end if;
  update mw_accounts set pass_hash = extensions.crypt(p_new, extensions.gen_salt('bf', 10)) where username = u;
  delete from mw_sessions where username = u;
  return json_build_object('ok', true, 'username', r->>'username', 'token', mw__session(u));
end $$;

-- check a saved sign-in is still valid (returns the display name)
create or replace function public.mw_whoami(p_token text) returns json
language sql security definer set search_path = public, extensions as $$
  select coalesce((select json_build_object('ok', true, 'username', a.display_name)
                   from mw_sessions s join mw_accounts a using (username)
                   where s.token = p_token and s.expires_at > now()), json_build_object('error', 'signed out'));
$$;

grant execute on function public.mw_signup(text, text), public.mw_login(text, text),
  public.mw_change_password(text, text, text), public.mw_whoami(text) to anon, authenticated;

-- delete your own account (needs the password)
create or replace function public.mw_delete_account(p_username text, p_password text) returns json
language plpgsql security definer set search_path = public, extensions as $$
declare r json := mw_login(p_username, p_password);
begin
  if (r->>'ok') is null then return json_build_object('error', 'Wrong password — nothing deleted.'); end if;
  delete from mw_accounts where username = lower(trim(p_username));
  return json_build_object('ok', true);
end $$;
grant execute on function public.mw_delete_account(text, text) to anon, authenticated;

-- ===================== Floof Pro =====================
alter table public.mw_accounts add column if not exists pro_until timestamptz;
create table if not exists public.mw_codes (
  code        text primary key,
  months      int not null default 1,
  created_at  timestamptz not null default now(),
  used_by     text references public.mw_accounts(username) on delete set null,
  used_at     timestamptz
);
alter table public.mw_codes enable row level security;
revoke all on public.mw_codes from anon, authenticated;

-- account status for a signed-in token (username + Pro end date)
create or replace function public.mw_status(p_token text) returns json
language sql security definer set search_path = public, extensions as $$
  select coalesce((select json_build_object('ok', true, 'username', a.display_name, 'pro_until', a.pro_until)
                   from mw_sessions s join mw_accounts a using (username)
                   where s.token = p_token and s.expires_at > now()), json_build_object('error', 'signed out'));
$$;

-- redeem a Pro code (codes are made by the studio after someone pays)
create or replace function public.mw_redeem(p_token text, p_code text) returns json
language plpgsql security definer set search_path = public, extensions as $$
declare u text; c mw_codes; newend timestamptz;
begin
  select username into u from mw_sessions where token = p_token and expires_at > now();
  if u is null then return json_build_object('error', 'Please sign in again.'); end if;
  select * into c from mw_codes where code = upper(trim(coalesce(p_code, ''))) for update;
  if not found then perform pg_sleep(0.5); return json_build_object('error', 'That code isn''t valid.'); end if;
  if c.used_by is not null then return json_build_object('error', 'That code has already been used.'); end if;
  update mw_accounts set pro_until = greatest(coalesce(pro_until, now()), now()) + make_interval(months => c.months)
    where username = u returning pro_until into newend;
  update mw_codes set used_by = u, used_at = now() where code = c.code;
  return json_build_object('ok', true, 'pro_until', newend);
end $$;

-- STUDIO ONLY (run in the SQL editor, never callable from the website):
--   select * from public.mw_make_codes(5, 1);   -- 5 codes, 1 month each
--   select public.mw_grant_pro('username', 1);  -- give someone 1 month directly
create or replace function public.mw_make_codes(p_count int, p_months int default 1) returns setof text
language plpgsql security definer set search_path = public, extensions as $$
declare i int; c text;
begin
  for i in 1..least(greatest(p_count, 1), 200) loop
    c := 'FLOOF-' || upper(substr(encode(extensions.gen_random_bytes(8), 'hex'), 1, 4)) || '-' || upper(substr(encode(extensions.gen_random_bytes(8), 'hex'), 1, 4));
    insert into mw_codes(code, months) values (c, greatest(p_months, 1));
    return next c;
  end loop;
end $$;
create or replace function public.mw_grant_pro(p_username text, p_months int default 1) returns timestamptz
language sql security definer set search_path = public as $$
  update mw_accounts set pro_until = greatest(coalesce(pro_until, now()), now()) + make_interval(months => greatest(p_months, 1))
  where username = lower(trim(p_username)) returning pro_until;
$$;
revoke all on function public.mw_make_codes(int, int), public.mw_grant_pro(text, int) from public, anon, authenticated;
grant execute on function public.mw_status(text), public.mw_redeem(text, text) to anon, authenticated;
