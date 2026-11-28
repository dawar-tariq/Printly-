-- Candidate only: expose a bounded order token to eligible new native apps.
-- Names, order IDs and other customer data remain absent from push payloads.
-- Old app versions keep receiving the existing generic v1 notification.
alter table public.native_push_events add column order_token text
  check (order_token is null or order_token ~ '^A-[0-9]{1,10}$');

create or replace function public.native_push_order_event() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_order boolean := false; v_payment boolean := false; v_event uuid;
begin
  if tg_op = 'INSERT' then
    v_order := new.status = 'queued';
    v_payment := new.status = 'draft' and new.payment_method = 'upi' and new.payment_status = 'submitted';
  else
    v_order := new.status = 'queued' and old.status is distinct from new.status
      and not (old.status = 'draft' and old.payment_method = 'upi' and old.payment_status = 'submitted');
    v_payment := new.status = 'draft' and new.payment_method = 'upi' and new.payment_status = 'submitted'
      and (old.payment_status is distinct from new.payment_status or old.payment_method is distinct from new.payment_method);
  end if;
  if v_order then
    -- As before, don't create events without currently eligible shop members.
    if exists (select 1 from public.native_push_devices d join public.shop_staff s on s.shop_id=d.shop_id and s.user_id=d.user_id where d.shop_id=new.shop_id) then
      insert into public.native_push_events(shop_id,kind,order_token)
      values(new.shop_id,'order',case when new.token ~ '^A-[0-9]{1,10}$' then new.token else null end)
      returning id into v_event;
      insert into public.native_push_deliveries(event_id,binding_id)
      select v_event,d.binding_id from public.native_push_devices d
        join public.shop_staff s on s.shop_id=d.shop_id and s.user_id=d.user_id where d.shop_id=new.shop_id;
    end if;
  end if;
  if v_payment then perform public.enqueue_native_order_push(new.shop_id,'payment'); end if;
  return null;
exception when others then
  raise warning 'Could not enqueue a native order notification';
  return null;
end $$;

-- Only the server can obtain a token, and only for a live lease for a still
-- eligible member on the first app version that understands the new payload.
-- NULL means the lease or membership is no longer valid; a valid older app
-- gets a JSON object with a null token and keeps its generic v1 notice.
create function public.native_push_order_token(p_delivery uuid,p_lease uuid) returns jsonb
language sql security definer set search_path = public, pg_temp as $$
  select jsonb_build_object('token', case when dev.push_protocol=2 and dev.app_version_code>=6
    and e.order_token ~ '^A-[0-9]{1,10}$' then e.order_token else null end)
  from public.native_push_deliveries d
    join public.native_push_events e on e.id=d.event_id
    join public.native_push_devices dev on dev.binding_id=d.binding_id
    join public.shop_staff s on s.shop_id=dev.shop_id and s.user_id=dev.user_id
  where d.id=p_delivery and d.lease_token=p_lease and d.state='pending'
    and d.lease_until>clock_timestamp() and e.expires_at>clock_timestamp()
    and d.leased_device_generation=dev.generation and dev.shop_id=e.shop_id
    and e.kind='order';
$$;
revoke all on function public.native_push_order_token(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.native_push_order_token(uuid,uuid) to service_role;
