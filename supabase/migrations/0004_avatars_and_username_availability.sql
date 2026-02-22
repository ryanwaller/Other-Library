-- Avatars + username availability check
-- Safe to run multiple times.

-- Profiles: avatar pointer
alter table public.profiles
add column if not exists avatar_path text;

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

grant execute on function public.is_username_available(text) to anon, authenticated;

-- Storage bucket for avatars
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', false)
on conflict (id) do nothing;

-- Storage policies (avatars are readable if the viewer can view the profile)
-- Path convention: {user_id}/...
drop policy if exists "avatars_select" on storage.objects;
create policy "avatars_select"
on storage.objects
for select
using (
  bucket_id = 'avatars'
  and public.can_view_profile((storage.foldername(name))[1]::uuid)
);

drop policy if exists "avatars_insert_own" on storage.objects;
create policy "avatars_insert_own"
on storage.objects
for insert
with check (
  bucket_id = 'avatars'
  and auth.uid() is not null
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "avatars_update_own" on storage.objects;
create policy "avatars_update_own"
on storage.objects
for update
using (
  bucket_id = 'avatars'
  and auth.uid() is not null
  and (storage.foldername(name))[1] = auth.uid()::text
)
with check (
  bucket_id = 'avatars'
  and auth.uid() is not null
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "avatars_delete_own" on storage.objects;
create policy "avatars_delete_own"
on storage.objects
for delete
using (
  bucket_id = 'avatars'
  and auth.uid() is not null
  and (storage.foldername(name))[1] = auth.uid()::text
);

