-- Invite-only beta + admin roles + waitlist
-- Safe to run multiple times (where possible).

create extension if not exists pgcrypto;

-- -----------------------
-- Profiles (augment existing)
-- -----------------------
alter table public.profiles
  add column if not exists email text;

alter table public.profiles
  add column if not exists role text not null default 'user';

alter table public.profiles
  add column if not exists status text not null default 'active';

do $$
begin
  if not exists (
    select 1
    from information_schema.table_constraints tc
    where tc.table_schema = 'public'
      and tc.table_name = 'profiles'
      and tc.constraint_type = 'CHECK'
      and tc.constraint_name = 'profiles_role_check'
  ) then
    alter table public.profiles
      add constraint profiles_role_check check (role in ('user', 'admin'));
  end if;

  if not exists (
    select 1
    from information_schema.table_constraints tc
    where tc.table_schema = 'public'
      and tc.table_name = 'profiles'
      and tc.constraint_type = 'CHECK'
      and tc.constraint_name = 'profiles_status_check'
  ) then
    alter table public.profiles
      add constraint profiles_status_check check (status in ('active', 'disabled', 'pending'));
  end if;
end $$;

-- Backfill email for existing profiles (if missing)
update public.profiles p
set email = u.email
from auth.users u
where p.id = u.id
  and (p.email is null or p.email = '');

-- -----------------------
-- Admin helper
-- -----------------------
create or replace function public.is_admin(uid uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = uid
      and p.role = 'admin'
      and p.status = 'active'
  );
$$;

grant execute on function public.is_admin(uuid) to authenticated;

-- Prevent self-updating privileged profile fields (role/status/email) unless service_role or admin.
create or replace function public.prevent_profile_privileged_updates()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- service role bypass (server-side admin actions)
  if auth.role() = 'service_role' then
    return new;
  end if;

  -- allow admins (via SQL editor or future admin tooling)
  if public.is_admin(auth.uid()) then
    return new;
  end if;

  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

  if auth.uid() <> old.id then
    raise exception 'forbidden';
  end if;

  if new.role is distinct from old.role then
    raise exception 'cannot_change_role';
  end if;
  if new.status is distinct from old.status then
    raise exception 'cannot_change_status';
  end if;
  if new.email is distinct from old.email then
    raise exception 'cannot_change_email';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_profiles_prevent_privileged_updates on public.profiles;
create trigger trg_profiles_prevent_privileged_updates
before update on public.profiles
for each row
execute function public.prevent_profile_privileged_updates();

-- -----------------------
-- Invites
-- -----------------------
create table if not exists public.invites (
  id uuid primary key default gen_random_uuid(),
  token text unique not null,
  email text,
  created_by uuid references auth.users (id),
  expires_at timestamptz,
  used_by uuid references auth.users (id),
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists invites_token_idx on public.invites (token);
create index if not exists invites_used_at_idx on public.invites (used_at);
create index if not exists invites_email_idx on public.invites (email);

alter table public.invites enable row level security;

drop policy if exists "invites_admin_all" on public.invites;
create policy "invites_admin_all"
on public.invites
for all
using (public.is_admin(auth.uid()))
with check (public.is_admin(auth.uid()));

-- Public validation helper (keeps invites table admin-only while allowing token checks)
create or replace function public.invite_status(input_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  t text;
  inv record;
  expired boolean;
begin
  t := nullif(trim(input_token), '');
  if t is null then
    return jsonb_build_object('ok', false, 'reason', 'missing_token');
  end if;

  select i.id, i.email, i.expires_at, i.used_at
  into inv
  from public.invites i
  where i.token = t
  limit 1;

  if inv.id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  expired := (inv.expires_at is not null and inv.expires_at <= now());
  if expired then
    return jsonb_build_object('ok', false, 'reason', 'expired', 'email', inv.email, 'expires_at', inv.expires_at, 'used_at', inv.used_at);
  end if;
  if inv.used_at is not null then
    return jsonb_build_object('ok', false, 'reason', 'used', 'email', inv.email, 'expires_at', inv.expires_at, 'used_at', inv.used_at);
  end if;

  return jsonb_build_object('ok', true, 'id', inv.id, 'email', inv.email, 'expires_at', inv.expires_at);
end;
$$;

grant execute on function public.invite_status(text) to anon, authenticated;

-- -----------------------
-- Waitlist
-- -----------------------
create table if not exists public.waitlist (
  id uuid primary key default gen_random_uuid(),
  email text unique not null,
  note text,
  created_at timestamptz not null default now(),
  status text not null default 'pending',
  approved_by uuid references auth.users (id),
  approved_at timestamptz
);

do $$
begin
  if not exists (
    select 1
    from information_schema.table_constraints tc
    where tc.table_schema = 'public'
      and tc.table_name = 'waitlist'
      and tc.constraint_type = 'CHECK'
      and tc.constraint_name = 'waitlist_status_check'
  ) then
    alter table public.waitlist
      add constraint waitlist_status_check check (status in ('pending', 'approved', 'rejected'));
  end if;
end $$;

create index if not exists waitlist_status_created_idx on public.waitlist (status, created_at desc);
create index if not exists waitlist_email_idx on public.waitlist (email);

alter table public.waitlist enable row level security;

drop policy if exists "waitlist_insert_anyone" on public.waitlist;
create policy "waitlist_insert_anyone"
on public.waitlist
for insert
with check (true);

drop policy if exists "waitlist_select_admin" on public.waitlist;
create policy "waitlist_select_admin"
on public.waitlist
for select
using (public.is_admin(auth.uid()));

drop policy if exists "waitlist_update_admin" on public.waitlist;
create policy "waitlist_update_admin"
on public.waitlist
for update
using (public.is_admin(auth.uid()))
with check (public.is_admin(auth.uid()));

drop policy if exists "waitlist_delete_admin" on public.waitlist;
create policy "waitlist_delete_admin"
on public.waitlist
for delete
using (public.is_admin(auth.uid()));

-- -----------------------
-- Enforce invite-only signup via auth.users trigger
-- -----------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  uname text;
  inv_token text;
  inv_id uuid;
  inv_email text;
begin
  -- Require an invite token for any new signup.
  inv_token := nullif(trim(new.raw_user_meta_data->>'invite_token'), '');
  if inv_token is null then
    raise exception 'invite_required';
  end if;

  select i.id, i.email
  into inv_id, inv_email
  from public.invites i
  where i.token = inv_token
    and i.used_at is null
    and (i.expires_at is null or i.expires_at > now())
  limit 1;

  if inv_id is null then
    raise exception 'invalid_invite';
  end if;

  if inv_email is not null and lower(inv_email) <> lower(new.email) then
    raise exception 'invite_email_mismatch';
  end if;

  update public.invites
  set used_by = new.id,
      used_at = now()
  where id = inv_id
    and used_at is null;

  if not found then
    raise exception 'invite_already_used';
  end if;

  uname := coalesce(nullif(new.raw_user_meta_data->>'username', ''), public.generate_default_username(new.id));

  insert into public.profiles (id, email, role, status, username, display_name)
  values (
    new.id,
    new.email,
    'user',
    'active',
    uname,
    coalesce(nullif(new.raw_user_meta_data->>'display_name', ''), uname)
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

