-- Shared catalog memberships for libraries ("catalogs").
-- Safe to run multiple times.

create table if not exists public.catalog_members (
  id uuid primary key default gen_random_uuid(),
  catalog_id bigint not null references public.libraries (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('owner', 'editor', 'viewer')),
  invited_by uuid references auth.users (id),
  invited_at timestamptz not null default now(),
  accepted_at timestamptz,
  unique (catalog_id, user_id)
);

create index if not exists catalog_members_catalog_id_idx on public.catalog_members (catalog_id);
create index if not exists catalog_members_user_id_idx on public.catalog_members (user_id);
create index if not exists catalog_members_catalog_accepted_idx on public.catalog_members (catalog_id, accepted_at);

-- Backfill existing catalogs with their current owner membership.
insert into public.catalog_members (catalog_id, user_id, role, invited_by, invited_at, accepted_at)
select l.id, l.owner_id, 'owner', l.owner_id, now(), now()
from public.libraries l
on conflict (catalog_id, user_id) do update
set role = 'owner',
    accepted_at = coalesce(public.catalog_members.accepted_at, now()),
    invited_by = coalesce(public.catalog_members.invited_by, excluded.invited_by);

alter table public.catalog_members enable row level security;

drop policy if exists "catalog_members_select_self" on public.catalog_members;
create policy "catalog_members_select_self"
on public.catalog_members
for select
to authenticated
using (user_id = auth.uid());

drop policy if exists "catalog_members_select_catalog_members" on public.catalog_members;
create policy "catalog_members_select_catalog_members"
on public.catalog_members
for select
to authenticated
using (
  exists (
    select 1
    from public.catalog_members cm
    where cm.catalog_id = catalog_members.catalog_id
      and cm.user_id = auth.uid()
      and cm.accepted_at is not null
  )
);

drop policy if exists "catalog_members_insert_owner" on public.catalog_members;
create policy "catalog_members_insert_owner"
on public.catalog_members
for insert
to authenticated
with check (
  exists (
    select 1
    from public.libraries l
    where l.id = catalog_members.catalog_id
      and l.owner_id = auth.uid()
  )
);

drop policy if exists "catalog_members_update_owner" on public.catalog_members;
create policy "catalog_members_update_owner"
on public.catalog_members
for update
to authenticated
using (
  exists (
    select 1
    from public.libraries l
    where l.id = catalog_members.catalog_id
      and l.owner_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.libraries l
    where l.id = catalog_members.catalog_id
      and l.owner_id = auth.uid()
  )
);

drop policy if exists "catalog_members_delete_owner" on public.catalog_members;
create policy "catalog_members_delete_owner"
on public.catalog_members
for delete
to authenticated
using (
  exists (
    select 1
    from public.libraries l
    where l.id = catalog_members.catalog_id
      and l.owner_id = auth.uid()
  )
);
