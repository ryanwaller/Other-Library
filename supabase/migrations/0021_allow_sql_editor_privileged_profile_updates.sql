-- Allow privileged updates to public.profiles from Supabase SQL Editor / migrations.
-- Without this, the prevent_profile_privileged_updates() trigger blocks admin bootstrap updates
-- because auth.uid() is null in SQL Editor.

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

  -- SQL editor / migrations are executed as a privileged DB role (no JWT context).
  if current_user in ('postgres', 'supabase_admin') then
    return new;
  end if;

  -- allow admins (authenticated) to manage roles/status
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

