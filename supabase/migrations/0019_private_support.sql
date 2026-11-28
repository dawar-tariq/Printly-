-- Private two-way support. Browsers never have direct table/RPC privileges.
-- Access to a conversation requires a 256-bit bearer secret; only its SHA-256
-- digest is stored. Rotating the service-role key does not invalidate tickets.
create table public.support_tickets (
  id uuid primary key,
  secret_hash text not null check (secret_hash ~ '^[0-9a-f]{64}$'),
  subject text not null check (char_length(btrim(subject)) between 3 and 120),
  status text not null default 'open' check (status in ('open', 'answered', 'closed')),
  message_count integer not null default 0 check (message_count between 0 and 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index support_tickets_inbox on public.support_tickets (status, updated_at desc, id desc);
create table public.support_messages (
  id uuid primary key,
  ticket_id uuid not null references public.support_tickets(id) on delete cascade,
  sender text not null check (sender in ('customer', 'admin')),
  actor_id uuid,
  position integer not null check (position between 1 and 100),
  body text not null check (char_length(btrim(body)) between 1 and 3000),
  created_at timestamptz not null default clock_timestamp(),
  unique (ticket_id, position),
  check ((sender = 'customer' and actor_id is null) or (sender = 'admin' and actor_id is not null))
);
alter table public.support_tickets enable row level security;
alter table public.support_messages enable row level security;
revoke all on public.support_tickets, public.support_messages from public, anon, authenticated;
grant select, insert, update, delete on public.support_tickets, public.support_messages to service_role;

-- A caller chooses its ID/secret before sending. Repeating the same request
-- after a lost response is safe and cannot create a second conversation.
create function public.create_support_ticket(p_id uuid, p_secret_hash text, p_subject text, p_message_id uuid, p_body text)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare v_ticket public.support_tickets%rowtype; v_message public.support_messages%rowtype;
begin
  if p_id is null or p_message_id is null or p_secret_hash is null or p_secret_hash !~ '^[0-9a-f]{64}$'
     or p_subject is null or char_length(btrim(p_subject)) not between 3 and 120
     or p_body is null or char_length(btrim(p_body)) not between 1 and 3000 then
    raise exception 'INVALID_SUPPORT_INPUT' using errcode = 'P0001';
  end if;
  insert into public.support_tickets (id, secret_hash, subject, message_count)
    values (p_id, p_secret_hash, btrim(p_subject), 1) on conflict (id) do nothing;
  if found then
    insert into public.support_messages (id, ticket_id, sender, position, body)
      values (p_message_id, p_id, 'customer', 1, btrim(p_body));
    return 'created';
  end if;
  select * into v_ticket from public.support_tickets where id = p_id;
  select * into v_message from public.support_messages where id = p_message_id;
  if v_ticket.secret_hash is distinct from p_secret_hash or v_ticket.subject is distinct from btrim(p_subject)
     or v_message.ticket_id is distinct from p_id or v_message.sender is distinct from 'customer'
     or v_message.body is distinct from btrim(p_body) then
    raise exception 'SUPPORT_CONFLICT' using errcode = 'P0001';
  end if;
  return 'exists';
end
$$;

-- Serialise replies and cap each conversation, even under concurrent retries.
-- The message UUID also makes a lost response safe to retry.
create function public.append_support_message(p_ticket_id uuid, p_message_id uuid, p_sender text, p_actor_id uuid, p_body text)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare v_ticket public.support_tickets%rowtype; v_previous public.support_messages%rowtype;
begin
  if p_ticket_id is null or p_message_id is null or p_sender is null or p_sender not in ('customer', 'admin')
     or (p_sender = 'customer' and p_actor_id is not null) or (p_sender = 'admin' and p_actor_id is null)
     or p_body is null or char_length(btrim(p_body)) not between 1 and 3000 then
    raise exception 'INVALID_SUPPORT_INPUT' using errcode = 'P0001';
  end if;
  select * into v_ticket from public.support_tickets where id = p_ticket_id for update;
  if not found then raise exception 'SUPPORT_NOT_FOUND' using errcode = 'P0001'; end if;
  select * into v_previous from public.support_messages where id = p_message_id;
  if found then
    if v_previous.ticket_id = p_ticket_id and v_previous.sender = p_sender
       and v_previous.actor_id is not distinct from p_actor_id and v_previous.body = btrim(p_body) then
      return 'exists';
    end if;
    raise exception 'SUPPORT_MESSAGE_CONFLICT' using errcode = 'P0001';
  end if;
  if v_ticket.message_count >= 100 then raise exception 'SUPPORT_FULL' using errcode = 'P0001'; end if;
  insert into public.support_messages (id, ticket_id, sender, actor_id, position, body)
    values (p_message_id, p_ticket_id, p_sender, p_actor_id, v_ticket.message_count + 1, btrim(p_body));
  update public.support_tickets set message_count = message_count + 1,
    status = case when p_sender = 'admin' then 'answered' else 'open' end, updated_at = clock_timestamp()
    where id = p_ticket_id;
  return 'created';
end
$$;
revoke all on function public.create_support_ticket(uuid,text,text,uuid,text) from public, anon, authenticated;
revoke all on function public.append_support_message(uuid,uuid,text,uuid,text) from public, anon, authenticated;
grant execute on function public.create_support_ticket(uuid,text,text,uuid,text) to service_role;
grant execute on function public.append_support_message(uuid,uuid,text,uuid,text) to service_role;
