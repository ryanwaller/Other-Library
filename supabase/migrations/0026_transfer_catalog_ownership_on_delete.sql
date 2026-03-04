-- Transfer catalog ownership before deleting the current user.
-- If a catalog owner has accepted members, promote the earliest accepted member.
-- If not, catalog deletion proceeds via FK cascade as before.

create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_catalog_id bigint;
  v_next_owner uuid;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;

  -- Reassign ownership where possible before deleting auth user/profile.
  for v_catalog_id in
    select l.id
    from public.libraries l
    where l.owner_id = v_uid
  loop
    select cm.user_id
      into v_next_owner
    from public.catalog_members cm
    where cm.catalog_id = v_catalog_id
      and cm.user_id <> v_uid
      and cm.accepted_at is not null
    order by cm.accepted_at asc, cm.invited_at asc, cm.id asc
    limit 1;

    if v_next_owner is null then
      -- No accepted member to transfer to; this catalog will be deleted by cascade.
      continue;
    end if;

    update public.libraries
    set owner_id = v_next_owner
    where id = v_catalog_id;

    -- Ensure only one owner role in membership rows.
    update public.catalog_members
    set role = 'editor'
    where catalog_id = v_catalog_id
      and role = 'owner'
      and user_id <> v_next_owner;

    update public.catalog_members
    set role = 'owner',
        accepted_at = coalesce(accepted_at, now())
    where catalog_id = v_catalog_id
      and user_id = v_next_owner;
  end loop;

  -- Deleting from auth.users cascades into public.profiles (and then other tables via FKs).
  delete from auth.users where id = v_uid;
end;
$$;
