-- Username aliases + username change RPC
-- Safe to run multiple times.

create table if not exists public.username_aliases (
  old_username text primary key,
  current_username text not null,
  user_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now()
);

create index if not exists username_aliases_user_id_idx on public.username_aliases (user_id);
create index if not exists username_aliases_current_username_idx on public.username_aliases (current_username);

alter table public.username_aliases enable row level security;

-- Public redirect lookup: anyone can resolve an old username to the current username.
drop policy if exists "username_aliases_select_all" on public.username_aliases;
create policy "username_aliases_select_all"
on public.username_aliases
for select
using (true);

-- Basic username validation helpers.
create or replace function public.normalize_username(input text)
returns text
language sql
immutable
as $$
  select lower(trim(input));
$$;

create or replace function public.is_valid_username(input text)
returns boolean
language sql
immutable
as $$
  select
    input is not null
    and length(input) between 3 and 24
    and input ~ '^[a-z0-9_]+$'
    and input !~ '^_'
    and input !~ '_$';
$$;

create or replace function public.is_reserved_username(input text)
returns boolean
language sql
immutable
as $$
  select public.normalize_username(input) = any (
    array[
      -- app routes / common paths
      'app','api','u','b','books','setup','settings',
      -- auth-ish
      'auth','login','logout','signup','signin',
      -- common infra
      'www','admin','root','support','help'
    ]::text[]
  );
$$;

-- Change username and maintain aliases for redirects.
-- - Inserts old -> new alias
-- - Updates existing aliases to point to latest username
create or replace function public.change_username(new_username text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid;
  next text;
  prev text;
begin
  uid := auth.uid();
  if uid is null then
    raise exception 'not_authenticated';
  end if;

  next := public.normalize_username(new_username);
  if not public.is_valid_username(next) then
    raise exception 'invalid_username';
  end if;
  if public.is_reserved_username(next) then
    raise exception 'reserved_username';
  end if;

  select p.username into prev
  from public.profiles p
  where p.id = uid;

  if prev is null then
    raise exception 'profile_not_found';
  end if;

  if next = prev then
    return jsonb_build_object('ok', true, 'old', prev, 'new', next, 'changed', false);
  end if;

  -- Reject if username is already in use by someone else.
  if exists (select 1 from public.profiles p where p.username = next) then
    raise exception 'username_taken';
  end if;
  -- Reject if username is an old alias for any user.
  if exists (select 1 from public.username_aliases a where a.old_username = next) then
    raise exception 'username_taken';
  end if;

  update public.profiles
  set username = next
  where id = uid;

  -- Point all existing aliases for this user to the latest username.
  update public.username_aliases
  set current_username = next
  where user_id = uid;

  -- Record the previous username as an alias.
  insert into public.username_aliases (old_username, current_username, user_id)
  values (prev, next, uid)
  on conflict (old_username) do update
    set current_username = excluded.current_username,
        user_id = excluded.user_id;

  return jsonb_build_object('ok', true, 'old', prev, 'new', next, 'changed', true);
end;
$$;
