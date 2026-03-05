-- Reopen soft-deleted conversations for participants when a new non-delete-notice message is sent.

create or replace function public.touch_borrow_request_updated_at()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.borrow_requests
  set updated_at = now()
  where id = new.borrow_request_id;

  -- Keep delete action hidden: do not reopen when the inserted message is the delete notice itself.
  if not (coalesce(new.message, '') ~* 'deleted this conversation\\.\\s*also delete\\?$') then
    delete from public.borrow_request_deleted_for
    where borrow_request_id = new.borrow_request_id;
  end if;

  return new;
end;
$$;
