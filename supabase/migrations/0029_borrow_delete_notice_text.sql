-- Update delete conversation notice wording.

create or replace function public.delete_borrow_conversation(input_borrow_request_id bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_owner uuid;
  v_requester uuid;
  v_username text;
  v_message text;
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;

  select br.owner_id, br.requester_id
  into v_owner, v_requester
  from public.borrow_requests br
  where br.id = input_borrow_request_id
  limit 1;

  if v_owner is null then
    raise exception 'borrow_request_not_found';
  end if;

  if v_uid <> v_owner and v_uid <> v_requester then
    raise exception 'forbidden';
  end if;

  select p.username into v_username
  from public.profiles p
  where p.id = v_uid
  limit 1;

  if v_username is null or btrim(v_username) = '' then
    v_username := 'A user';
  end if;

  v_message := format('%s deleted this conversation. Also delete?', v_username);

  insert into public.borrow_request_messages (borrow_request_id, sender_id, message)
  values (input_borrow_request_id, v_uid, v_message);

  insert into public.borrow_request_deleted_for (borrow_request_id, user_id, deleted_at)
  values (input_borrow_request_id, v_uid, now())
  on conflict (borrow_request_id, user_id)
  do update set deleted_at = excluded.deleted_at;
end;
$$;

grant execute on function public.delete_borrow_conversation(bigint) to authenticated;
