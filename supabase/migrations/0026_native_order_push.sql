-- Candidate native FCM notifications. This migration only creates a private,
-- bounded outbox; it does not configure Firebase, install a scheduler, or send
-- a network request. Roll out separately after disposable and device tests.

create table public.native_push_devices (
  binding_id uuid primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  shop_id uuid not null references public.shops(id) on delete cascade,
  fid text not null unique check (fid ~ '^[A-Za-z0-9_-]{22}$'),
  updated_at timestamptz not null default clock_timestamp()
);
create index native_push_devices_shop on public.native_push_devices(shop_id, user_id);
create index native_push_devices_user on public.native_push_devices(user_id);

create table public.native_push_events (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id) on delete cascade,
  kind text not null check (kind in ('order', 'payment')),
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null default (clock_timestamp() + interval '1 day')
);
create index native_push_events_created on public.native_push_events(created_at);
create table public.native_push_deliveries (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.native_push_events(id) on delete cascade,
  binding_id uuid not null references public.native_push_devices(binding_id) on delete cascade,
  state text not null default 'pending' check (state in ('pending', 'sent', 'discarded')),
  attempts integer not null default 0 check (attempts between 0 and 8),
  next_attempt_at timestamptz not null default clock_timestamp(),
  lease_until timestamptz,
  lease_token uuid,
  completed_at timestamptz,
  unique (event_id, binding_id)
);
create index native_push_pending on public.native_push_deliveries(next_attempt_at, id) where state = 'pending';

alter table public.native_push_devices enable row level security;
alter table public.native_push_events enable row level security;
alter table public.native_push_deliveries enable row level security;
revoke all on public.native_push_devices, public.native_push_events, public.native_push_deliveries from public, anon, authenticated, service_role;

-- Only the server calls this after verifying the bearer token. Recheck membership
-- inside the transaction. A device can belong to only one account/shop; handover
-- or FID rotation deletes old pending deliveries. Serialize the low-volume
-- registrations so the device limit and handover cannot race.
create function public.register_native_push_device(p_user uuid, p_shop uuid, p_binding uuid, p_fid text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_old public.native_push_devices%rowtype;
begin
  if p_user is null or p_shop is null or p_binding is null or p_fid is null or p_fid !~ '^[A-Za-z0-9_-]{22}$' then
    raise exception 'INVALID_NATIVE_PUSH_DEVICE' using errcode = 'P0001';
  end if;
  perform pg_advisory_xact_lock(2112026, 1);
  -- Hold the membership until registration commits. A concurrent removal then
  -- runs its cleanup after the device exists, rather than missing it.
  perform 1 from public.shop_staff where user_id = p_user and shop_id = p_shop for key share;
  if not found then
    raise exception 'SHOP_MEMBERSHIP_REQUIRED' using errcode = 'P0001';
  end if;
  select * into v_old from public.native_push_devices where binding_id = p_binding for update;
  if found and (v_old.user_id <> p_user or v_old.shop_id <> p_shop) then
    raise exception 'PUSH_BINDING_IN_USE' using errcode = 'P0001';
  end if;
  if found and v_old.fid = p_fid then
    update public.native_push_devices set updated_at = clock_timestamp() where binding_id = p_binding;
    return;
  end if;
  -- Deleting first cancels pending deliveries from the former association.
  delete from public.native_push_devices where binding_id = p_binding or fid = p_fid;
  if (select count(*) from public.native_push_devices where user_id = p_user) >= 10 then
    raise exception 'NATIVE_PUSH_DEVICE_LIMIT' using errcode = 'P0001';
  end if;
  insert into public.native_push_devices(binding_id, user_id, shop_id, fid) values (p_binding, p_user, p_shop, p_fid);
end $$;

create function public.unregister_native_push_device(p_user uuid, p_binding uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if p_user is null or p_binding is null then raise exception 'INVALID_NATIVE_PUSH_DEVICE' using errcode = 'P0001'; end if;
  perform pg_advisory_xact_lock(2112026, 1);
  delete from public.native_push_devices where binding_id = p_binding and user_id = p_user;
end $$;

-- Snapshot eligible devices at event time. The event stores neither an order ID
-- nor customer data; users who opt in later do not receive historical orders.
create function public.enqueue_native_order_push(p_shop uuid, p_kind text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_event uuid;
begin
  if p_shop is null or p_kind not in ('order', 'payment') then raise exception 'INVALID_NATIVE_PUSH_EVENT' using errcode = 'P0001'; end if;
  if not exists (select 1 from public.native_push_devices d join public.shop_staff s on s.shop_id = d.shop_id and s.user_id = d.user_id where d.shop_id = p_shop) then return; end if;
  insert into public.native_push_events(shop_id, kind) values (p_shop, p_kind) returning id into v_event;
  insert into public.native_push_deliveries(event_id, binding_id)
    select v_event, d.binding_id from public.native_push_devices d
    join public.shop_staff s on s.shop_id = d.shop_id and s.user_id = d.user_id
    where d.shop_id = p_shop;
end $$;

create function public.native_push_order_event() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_order boolean := false; v_payment boolean := false;
begin
  if tg_op = 'INSERT' then
    v_order := new.status = 'queued';
    v_payment := new.status = 'draft' and new.payment_method = 'upi' and new.payment_status = 'submitted';
  else
    v_order := new.status = 'queued' and old.status is distinct from new.status
      -- The shop's own confirmation of a reported UPI order is not a second new order.
      and not (old.status = 'draft' and old.payment_method = 'upi' and old.payment_status = 'submitted');
    v_payment := new.status = 'draft' and new.payment_method = 'upi' and new.payment_status = 'submitted'
      and (old.payment_status is distinct from new.payment_status or old.payment_method is distinct from new.payment_method);
  end if;
  if v_order then perform public.enqueue_native_order_push(new.shop_id, 'order'); end if;
  if v_payment then perform public.enqueue_native_order_push(new.shop_id, 'payment'); end if;
  return null;
exception when others then
  -- Order and payment writes must never depend on notification availability.
  raise warning 'Could not enqueue a native order notification';
  return null;
end $$;
create trigger native_push_order_event after insert or update of status, payment_status, payment_method on public.orders
  for each row execute function public.native_push_order_event();

create function public.native_push_membership_removed() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op = 'DELETE' or old.user_id is distinct from new.user_id or old.shop_id is distinct from new.shop_id then
    delete from public.native_push_devices where user_id = old.user_id and shop_id = old.shop_id;
  end if;
  return null;
end $$;
create trigger native_push_membership_removed after delete or update of user_id, shop_id on public.shop_staff
  for each row execute function public.native_push_membership_removed();

-- Lease tokens make overlapping scheduler runs safe. Delivery remains at-least-
-- once: an accepted message can be repeated after a worker crash. The Android
-- app uses the event ID as a notification tag to collapse such duplicates.
create function public.claim_native_push_deliveries(p_limit integer default 20)
returns table (delivery_id uuid, lease_token uuid, event_id uuid, binding_id uuid, fid text, kind text, expires_at timestamptz)
language sql security definer set search_path = public, pg_temp as $$
  with candidates as (
    select d.id from public.native_push_deliveries d
    join public.native_push_events e on e.id = d.event_id
    join public.native_push_devices device on device.binding_id = d.binding_id
    where d.state = 'pending' and d.attempts < 8 and d.next_attempt_at <= clock_timestamp()
      and (d.lease_until is null or d.lease_until < clock_timestamp()) and e.expires_at > clock_timestamp()
      and device.shop_id = e.shop_id
      and exists (select 1 from public.shop_staff s where s.shop_id = device.shop_id and s.user_id = device.user_id)
    order by d.next_attempt_at, d.id for update of d skip locked
    limit greatest(1, least(coalesce(p_limit, 20), 30))
  ), claimed as (
    update public.native_push_deliveries d set attempts = d.attempts + 1,
      lease_until = clock_timestamp() + interval '2 minutes', lease_token = gen_random_uuid()
    from candidates c where d.id = c.id
    returning d.id, d.event_id, d.binding_id, d.lease_token
  )
  select c.id, c.lease_token, e.id, device.binding_id, device.fid, e.kind, e.expires_at
    from claimed c join public.native_push_events e on e.id = c.event_id
    join public.native_push_devices device on device.binding_id = c.binding_id;
$$;

create function public.finish_native_push_delivery(p_id uuid, p_lease uuid, p_outcome text)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
declare v_delivery public.native_push_deliveries%rowtype;
begin
  if p_id is null or p_lease is null or p_outcome is null or p_outcome not in ('sent','gone','retry','drop') then
    raise exception 'INVALID_NATIVE_PUSH_OUTCOME' using errcode = 'P0001';
  end if;
  select * into v_delivery from public.native_push_deliveries where id = p_id and lease_token = p_lease
    and state = 'pending' and lease_until > clock_timestamp() for update;
  if not found then return false; end if;
  if p_outcome = 'gone' then
    delete from public.native_push_devices where binding_id = v_delivery.binding_id;
  elsif p_outcome in ('sent','drop') or v_delivery.attempts >= 8 then
    update public.native_push_deliveries set state = case when p_outcome = 'sent' then 'sent' else 'discarded' end,
      completed_at = clock_timestamp(), lease_until = null, lease_token = null where id = p_id;
  else
    update public.native_push_deliveries set next_attempt_at = clock_timestamp() + make_interval(secs => least(3600, (60 * power(2, v_delivery.attempts - 1))::integer)),
      lease_until = null, lease_token = null where id = p_id;
  end if;
  return true;
end $$;

create function public.sweep_native_push() returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  -- A worker can die while holding its final lease. Do not let that leave a
  -- forever-pending row; never steal a lease which is still in use.
  update public.native_push_deliveries d set state = 'discarded', completed_at = clock_timestamp(), lease_until = null, lease_token = null
    where d.id in (
      select q.id from public.native_push_deliveries q join public.native_push_events e on e.id = q.event_id
      where q.state = 'pending' and (q.attempts >= 8 or e.expires_at <= clock_timestamp())
        and (q.lease_until is null or q.lease_until < clock_timestamp())
      order by q.next_attempt_at limit 1000 for update of q skip locked
    );
  delete from public.native_push_events where id in (
    select id from public.native_push_events where created_at < clock_timestamp() - interval '7 days' order by created_at limit 1000
  );
  delete from public.native_push_devices where binding_id in (
    select binding_id from public.native_push_devices where updated_at < clock_timestamp() - interval '180 days' order by updated_at limit 1000
  );
end $$;

revoke all on function public.register_native_push_device(uuid,uuid,uuid,text), public.unregister_native_push_device(uuid,uuid),
  public.enqueue_native_order_push(uuid,text), public.native_push_order_event(), public.native_push_membership_removed(),
  public.claim_native_push_deliveries(integer), public.finish_native_push_delivery(uuid,uuid,text), public.sweep_native_push()
  from public, anon, authenticated, service_role;
grant execute on function public.register_native_push_device(uuid,uuid,uuid,text), public.unregister_native_push_device(uuid,uuid),
  public.claim_native_push_deliveries(integer), public.finish_native_push_delivery(uuid,uuid,text), public.sweep_native_push() to service_role;
