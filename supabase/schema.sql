-- OM Library App schema (run in Supabase SQL editor)
-- Assumes: Supabase Auth is enabled. RLS is enabled on all app tables.

create extension if not exists pgcrypto;

-- -----------------------
-- Enums (as text for simplicity)
-- -----------------------

-- -----------------------
-- Profiles
-- -----------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text not null unique,
  display_name text,
  bio text,
  visibility text not null default 'followers_only' check (visibility in ('followers_only', 'public')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Added later (safe to run on existing projects)
alter table public.profiles
add column if not exists avatar_path text;

alter table public.profiles enable row level security;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_profiles_updated_at on public.profiles;
create trigger trg_profiles_updated_at
before update on public.profiles
for each row
execute function public.set_updated_at();

create or replace function public.generate_default_username(user_id uuid)
returns text
language sql
stable
as $$
  select 'user_' || replace(left(user_id::text, 8), '-', '');
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  uname text;
begin
  uname := coalesce(nullif(new.raw_user_meta_data->>'username', ''), public.generate_default_username(new.id));

  insert into public.profiles (id, username, display_name)
  values (new.id, uname, coalesce(nullif(new.raw_user_meta_data->>'display_name', ''), uname))
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();

-- -----------------------
-- Username aliases (for redirects)
-- -----------------------
create table if not exists public.username_aliases (
  old_username text primary key,
  current_username text not null,
  user_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now()
);

create index if not exists username_aliases_user_id_idx on public.username_aliases (user_id);
create index if not exists username_aliases_current_username_idx on public.username_aliases (current_username);

alter table public.username_aliases enable row level security;

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
      'app','api','u','b','books','setup','settings',
      'auth','login','logout','signup','signin',
      'www','admin','root','support','help'
    ]::text[]
  );
$$;

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

  if exists (select 1 from public.profiles p where p.username = next) then
    raise exception 'username_taken';
  end if;
  if exists (select 1 from public.username_aliases a where a.old_username = next) then
    raise exception 'username_taken';
  end if;

  update public.profiles
  set username = next
  where id = uid;

  update public.username_aliases
  set current_username = next
  where user_id = uid;

  insert into public.username_aliases (old_username, current_username, user_id)
  values (prev, next, uid)
  on conflict (old_username) do update
    set current_username = excluded.current_username,
        user_id = excluded.user_id;

  return jsonb_build_object('ok', true, 'old', prev, 'new', next, 'changed', true);
end;
$$;

-- Username availability RPC (works even if profiles are private)
create or replace function public.is_username_available(input_username text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  u text;
begin
  u := public.normalize_username(input_username);
  if not public.is_valid_username(u) then
    return false;
  end if;
  if public.is_reserved_username(u) then
    return false;
  end if;
  if exists (select 1 from public.profiles p where p.username = u) then
    return false;
  end if;
  if exists (select 1 from public.username_aliases a where a.old_username = u) then
    return false;
  end if;
  return true;
end;
$$;

-- -----------------------
-- Follows
-- -----------------------
create table if not exists public.follows (
  follower_id uuid not null references public.profiles (id) on delete cascade,
  followee_id uuid not null references public.profiles (id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (follower_id, followee_id),
  check (follower_id <> followee_id)
);

alter table public.follows enable row level security;

drop trigger if exists trg_follows_updated_at on public.follows;
create trigger trg_follows_updated_at
before update on public.follows
for each row
execute function public.set_updated_at();

create or replace function public.is_approved_follower(viewer uuid, owner uuid)
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from public.follows f
    where f.follower_id = viewer
      and f.followee_id = owner
      and f.status = 'approved'
  );
$$;

create or replace function public.is_public_profile(target uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = target
      and p.visibility = 'public'
  );
$$;

create or replace function public.has_public_books(target uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.user_books ub
    where ub.owner_id = target
      and ub.visibility = 'public'
  );
$$;

create or replace function public.can_view_profile(target uuid)
returns boolean
language sql
stable
as $$
  select
    (auth.uid() = target)
    or public.is_public_profile(target)
    or (auth.uid() is not null and public.is_approved_follower(auth.uid(), target))
    or public.has_public_books(target);
$$;

-- -----------------------
-- Books (metadata)
-- -----------------------
create table if not exists public.editions (
  id bigint generated by default as identity primary key,
  isbn10 text,
  isbn13 text unique,
  title text,
  authors text[] not null default '{}'::text[],
  publisher text,
  publish_date date,
  description text,
  subjects text[] not null default '{}'::text[],
  cover_url text,
  raw jsonb,
  created_at timestamptz not null default now()
);

alter table public.editions enable row level security;

-- -----------------------
-- User books
-- -----------------------
create table if not exists public.user_books (
  id bigint generated by default as identity primary key,
  owner_id uuid not null references public.profiles (id) on delete cascade,
  edition_id bigint references public.editions (id) on delete set null,
  title_override text,
  authors_override text[],
  publisher_override text,
  publish_date_override date,
  description_override text,
  subjects_override text[],
  visibility text not null default 'inherit' check (visibility in ('inherit', 'followers_only', 'public')),
  status text not null default 'owned' check (status in ('owned', 'loaned', 'selling', 'trading')),
  location text,
  shelf text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.user_books enable row level security;

drop trigger if exists trg_user_books_updated_at on public.user_books;
create trigger trg_user_books_updated_at
before update on public.user_books
for each row
execute function public.set_updated_at();

create or replace function public.can_view_user_book(book public.user_books)
returns boolean
language sql
stable
as $$
  select
    (auth.uid() = book.owner_id)
    or (book.visibility = 'public')
    or (
      book.visibility = 'followers_only'
      and auth.uid() is not null
      and public.is_approved_follower(auth.uid(), book.owner_id)
    )
    or (
      book.visibility = 'inherit'
      and (
        public.is_public_profile(book.owner_id)
        or (auth.uid() is not null and public.is_approved_follower(auth.uid(), book.owner_id))
      )
    );
$$;

-- -----------------------
-- Tags
-- -----------------------
create table if not exists public.tags (
  id bigint generated by default as identity primary key,
  owner_id uuid not null references public.profiles (id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  unique (owner_id, name)
);

alter table public.tags enable row level security;

create table if not exists public.user_book_tags (
  user_book_id bigint not null references public.user_books (id) on delete cascade,
  tag_id bigint not null references public.tags (id) on delete cascade,
  primary key (user_book_id, tag_id)
);

alter table public.user_book_tags enable row level security;

-- -----------------------
-- User book media (images)
-- -----------------------
create table if not exists public.user_book_media (
  id bigint generated by default as identity primary key,
  user_book_id bigint not null references public.user_books (id) on delete cascade,
  kind text not null check (kind in ('cover', 'image')),
  storage_path text not null unique,
  caption text,
  created_at timestamptz not null default now()
);

create index if not exists user_book_media_user_book_id_idx on public.user_book_media (user_book_id);

alter table public.user_book_media enable row level security;

-- -----------------------
-- Wishlist
-- -----------------------
create table if not exists public.wishlist_items (
  id bigint generated by default as identity primary key,
  owner_id uuid not null references public.profiles (id) on delete cascade,
  isbn13 text,
  edition_id bigint references public.editions (id) on delete set null,
  notes text,
  created_at timestamptz not null default now(),
  unique (owner_id, isbn13),
  check (isbn13 is not null or edition_id is not null)
);

alter table public.wishlist_items enable row level security;

-- -----------------------
-- Feed events + notifications (in-app)
-- -----------------------
create table if not exists public.events (
  id bigint generated by default as identity primary key,
  owner_id uuid not null references public.profiles (id) on delete cascade,
  type text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.events enable row level security;

create table if not exists public.notifications (
  id bigint generated by default as identity primary key,
  owner_id uuid not null references public.profiles (id) on delete cascade,
  type text not null,
  payload jsonb not null default '{}'::jsonb,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.notifications enable row level security;

-- -----------------------
-- RLS policies
-- -----------------------

-- profiles
drop policy if exists "profiles_select" on public.profiles;
create policy "profiles_select"
on public.profiles
for select
using (public.can_view_profile(id));

-- username_aliases
drop policy if exists "username_aliases_select_all" on public.username_aliases;
create policy "username_aliases_select_all"
on public.username_aliases
for select
using (true);

drop policy if exists "profiles_insert_self" on public.profiles;
create policy "profiles_insert_self"
on public.profiles
for insert
with check (auth.uid() = id);

drop policy if exists "profiles_update_self" on public.profiles;
create policy "profiles_update_self"
on public.profiles
for update
using (auth.uid() = id)
with check (auth.uid() = id);

-- follows
drop policy if exists "follows_select_participants" on public.follows;
create policy "follows_select_participants"
on public.follows
for select
using (auth.uid() = follower_id or auth.uid() = followee_id);

drop policy if exists "follows_insert_self" on public.follows;
create policy "follows_insert_self"
on public.follows
for insert
with check (auth.uid() = follower_id);

drop policy if exists "follows_update_followee" on public.follows;
create policy "follows_update_followee"
on public.follows
for update
using (auth.uid() = followee_id)
with check (auth.uid() = followee_id);

drop policy if exists "follows_delete_participants" on public.follows;
create policy "follows_delete_participants"
on public.follows
for delete
using (auth.uid() = follower_id or auth.uid() = followee_id);

-- editions (metadata is safe to read; allow anon + authed)
drop policy if exists "editions_select_all" on public.editions;
create policy "editions_select_all"
on public.editions
for select
using (true);

drop policy if exists "editions_insert_authed" on public.editions;
create policy "editions_insert_authed"
on public.editions
for insert
with check (auth.uid() is not null);

-- user_books
drop policy if exists "user_books_select_viewable" on public.user_books;
create policy "user_books_select_viewable"
on public.user_books
for select
using (public.can_view_user_book(user_books));

drop policy if exists "user_books_insert_owner" on public.user_books;
create policy "user_books_insert_owner"
on public.user_books
for insert
with check (auth.uid() = owner_id);

drop policy if exists "user_books_update_owner" on public.user_books;
create policy "user_books_update_owner"
on public.user_books
for update
using (auth.uid() = owner_id)
with check (auth.uid() = owner_id);

drop policy if exists "user_books_delete_owner" on public.user_books;
create policy "user_books_delete_owner"
on public.user_books
for delete
using (auth.uid() = owner_id);

-- tags
drop policy if exists "tags_owner_all" on public.tags;
create policy "tags_owner_all"
on public.tags
for all
using (auth.uid() = owner_id)
with check (auth.uid() = owner_id);

-- user_book_tags (must be owner of user_book via join)
drop policy if exists "user_book_tags_owner_all" on public.user_book_tags;
create policy "user_book_tags_owner_all"
on public.user_book_tags
for all
using (
  exists (
    select 1
    from public.user_books ub
    join public.tags t on t.id = tag_id
    where ub.id = user_book_id
      and ub.owner_id = auth.uid()
      and t.owner_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.user_books ub
    join public.tags t on t.id = tag_id
    where ub.id = user_book_id
      and ub.owner_id = auth.uid()
      and t.owner_id = auth.uid()
  )
);

-- user_book_media
drop policy if exists "user_book_media_select_viewable" on public.user_book_media;
create policy "user_book_media_select_viewable"
on public.user_book_media
for select
using (
  exists (
    select 1
    from public.user_books ub
    where ub.id = user_book_id
      and public.can_view_user_book(ub)
  )
);

drop policy if exists "user_book_media_insert_owner" on public.user_book_media;
create policy "user_book_media_insert_owner"
on public.user_book_media
for insert
with check (
  exists (
    select 1
    from public.user_books ub
    where ub.id = user_book_id
      and ub.owner_id = auth.uid()
  )
);

drop policy if exists "user_book_media_update_owner" on public.user_book_media;
create policy "user_book_media_update_owner"
on public.user_book_media
for update
using (
  exists (
    select 1
    from public.user_books ub
    where ub.id = user_book_id
      and ub.owner_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.user_books ub
    where ub.id = user_book_id
      and ub.owner_id = auth.uid()
  )
);

drop policy if exists "user_book_media_delete_owner" on public.user_book_media;
create policy "user_book_media_delete_owner"
on public.user_book_media
for delete
using (
  exists (
    select 1
    from public.user_books ub
    where ub.id = user_book_id
      and ub.owner_id = auth.uid()
  )
);

-- wishlist_items
drop policy if exists "wishlist_owner_all" on public.wishlist_items;
create policy "wishlist_owner_all"
on public.wishlist_items
for all
using (auth.uid() = owner_id)
with check (auth.uid() = owner_id);

-- events
drop policy if exists "events_owner_all" on public.events;
create policy "events_owner_all"
on public.events
for all
using (auth.uid() = owner_id)
with check (auth.uid() = owner_id);

-- notifications
drop policy if exists "notifications_owner_all" on public.notifications;
create policy "notifications_owner_all"
on public.notifications
for all
using (auth.uid() = owner_id)
with check (auth.uid() = owner_id);

-- -----------------------
-- Storage (user-book-media bucket)
-- -----------------------
-- Note: Supabase Storage `storage.objects` is not always editable from the SQL editor role.
-- Create the `user-book-media` bucket and its Storage policies in the Supabase Dashboard instead.
