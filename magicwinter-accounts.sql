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
