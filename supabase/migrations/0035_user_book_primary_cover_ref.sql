-- Canonical cover reference for homepage and other list surfaces.
-- Stores either a storage path from `user-book-media` or an external URL.

alter table public.user_books
  add column if not exists primary_cover_ref text;

create or replace function public.sync_user_book_primary_cover(p_user_book_id bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cover_original_url text;
  v_cover_media_path text;
  v_edition_cover_url text;
begin
  select
    nullif(trim(ub.cover_original_url), ''),
    (
      select nullif(trim(ubm.storage_path), '')
      from public.user_book_media ubm
      where ubm.user_book_id = ub.id
        and ubm.kind = 'cover'
      order by ubm.created_at desc, ubm.id desc
      limit 1
    ),
    nullif(trim(e.cover_url), '')
  into v_cover_original_url, v_cover_media_path, v_edition_cover_url
  from public.user_books ub
  left join public.editions e on e.id = ub.edition_id
  where ub.id = p_user_book_id;

  if not found then
    return;
  end if;

  update public.user_books
  set primary_cover_ref = coalesce(v_cover_original_url, v_cover_media_path, v_edition_cover_url)
  where id = p_user_book_id;
end;
$$;

update public.user_books ub
set primary_cover_ref = coalesce(
  nullif(trim(ub.cover_original_url), ''),
  (
    select nullif(trim(ubm.storage_path), '')
    from public.user_book_media ubm
    where ubm.user_book_id = ub.id
      and ubm.kind = 'cover'
    order by ubm.created_at desc, ubm.id desc
    limit 1
  ),
  (
    select nullif(trim(e.cover_url), '')
    from public.editions e
    where e.id = ub.edition_id
  )
);

create or replace function public.trg_sync_user_book_primary_cover_from_user_books()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.sync_user_book_primary_cover(new.id);
  return new;
end;
$$;

drop trigger if exists trg_sync_user_book_primary_cover_from_user_books on public.user_books;
create trigger trg_sync_user_book_primary_cover_from_user_books
after insert or update of cover_original_url, edition_id
on public.user_books
for each row
execute function public.trg_sync_user_book_primary_cover_from_user_books();

create or replace function public.trg_sync_user_book_primary_cover_from_media()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.sync_user_book_primary_cover(coalesce(new.user_book_id, old.user_book_id));
  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_sync_user_book_primary_cover_from_media on public.user_book_media;
create trigger trg_sync_user_book_primary_cover_from_media
after insert or update of user_book_id, kind, storage_path or delete
on public.user_book_media
for each row
execute function public.trg_sync_user_book_primary_cover_from_media();

create or replace function public.trg_sync_user_book_primary_cover_from_editions()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.user_books ub
  set primary_cover_ref = coalesce(
    nullif(trim(ub.cover_original_url), ''),
    (
      select nullif(trim(ubm.storage_path), '')
      from public.user_book_media ubm
      where ubm.user_book_id = ub.id
        and ubm.kind = 'cover'
      order by ubm.created_at desc, ubm.id desc
      limit 1
    ),
    nullif(trim(new.cover_url), '')
  )
  where ub.edition_id = new.id;

  return new;
end;
$$;

drop trigger if exists trg_sync_user_book_primary_cover_from_editions on public.editions;
create trigger trg_sync_user_book_primary_cover_from_editions
after update of cover_url
on public.editions
for each row
execute function public.trg_sync_user_book_primary_cover_from_editions();
