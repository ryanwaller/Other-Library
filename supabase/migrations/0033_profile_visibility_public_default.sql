-- Make newly created profiles public by default.
alter table public.profiles
  alter column visibility set default 'public';

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
  uname := lower(regexp_replace(uname, '[^a-z0-9_]', '', 'g'));
  if uname = '' then
    uname := public.generate_default_username(new.id);
  end if;
  insert into public.profiles (id, username, display_name, visibility)
  values (new.id, uname, coalesce(nullif(new.raw_user_meta_data->>'display_name', ''), null), 'public');
  return new;
end;
$$;
