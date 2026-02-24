-- Borrow request scope: settings-only and expanded options.
-- Adds: followers, following. Renames legacy approved_followers -> followers.
-- Safe to run multiple times.

-- Drop old constraints first (so data updates don't violate them).
do $$
begin
  if exists (
    select 1
    from information_schema.table_constraints tc
    where tc.table_schema = 'public'
      and tc.table_name = 'profiles'
      and tc.constraint_type = 'CHECK'
      and tc.constraint_name = 'profiles_borrow_request_scope_check'
  ) then
    alter table public.profiles
      drop constraint profiles_borrow_request_scope_check;
  end if;
end $$;

do $$
begin
  if exists (
    select 1
    from information_schema.table_constraints tc
    where tc.table_schema = 'public'
      and tc.table_name = 'user_books'
      and tc.constraint_type = 'CHECK'
      and tc.constraint_name = 'user_books_borrow_request_scope_override_check'
  ) then
    alter table public.user_books
      drop constraint user_books_borrow_request_scope_override_check;
  end if;
end $$;

-- Normalize legacy values.
update public.profiles
set borrow_request_scope = 'followers'
where borrow_request_scope = 'approved_followers';

-- Per-book request scope overrides are no longer used (settings-only).
update public.user_books
set borrow_request_scope_override = null
where borrow_request_scope_override is not null;

-- Default scope: followers.
alter table public.profiles
  alter column borrow_request_scope set default 'followers';

-- Re-add constraints with expanded options.
alter table public.profiles
  add constraint profiles_borrow_request_scope_check check (borrow_request_scope in ('anyone', 'followers', 'following'));

alter table public.user_books
  add constraint user_books_borrow_request_scope_override_check check (
    borrow_request_scope_override is null
    or borrow_request_scope_override in ('anyone', 'followers', 'following')
  );

-- viewer is "approved following" of owner if owner follows viewer (and viewer approved).
create or replace function public.is_approved_following(viewer uuid, owner uuid)
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from public.follows f
    where f.follower_id = owner
      and f.followee_id = viewer
      and f.status = 'approved'
  );
$$;

-- Update requester insert policy (scope comes from profiles only).
drop policy if exists "borrow_requests_insert_requester" on public.borrow_requests;
create policy "borrow_requests_insert_requester"
on public.borrow_requests
for insert
with check (
  auth.uid() = requester_id
  and status = 'pending'
  and kind = 'borrow'
  and message is not null
  and length(trim(message)) > 0
  and exists (
    select 1
    from public.user_books ub
    join public.profiles p on p.id = ub.owner_id
    where ub.id = user_book_id
      and ub.owner_id = owner_id
      and public.can_view_user_book(ub)
      and (
        case
          when ub.borrowable_override is null then p.borrowable_default
          else ub.borrowable_override
        end
      )
      and (
        p.borrow_request_scope = 'anyone'
        or (p.borrow_request_scope = 'followers' and public.is_approved_follower(auth.uid(), ub.owner_id))
        or (p.borrow_request_scope = 'following' and public.is_approved_following(auth.uid(), ub.owner_id))
      )
  )
);
