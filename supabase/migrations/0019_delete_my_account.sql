-- Delete the current user's account.
-- WARNING: irreversible. Intended to be called from the Settings page.
-- Safe to run multiple times.

create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

  -- Deleting from auth.users cascades into public.profiles (and then other tables via FKs).
  delete from auth.users where id = auth.uid();
end;
$$;

