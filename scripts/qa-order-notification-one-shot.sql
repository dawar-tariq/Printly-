-- TEMPORARY; isolated QA only. Install only after disposable tests and preflight.
-- One fixed synthetic order, one target and one attempt. Remove after the test.
begin;
create function public.claim_printly_qa_order_00a80dd5_once()
returns table (delivery_id uuid, lease_token uuid, event_id uuid, binding_id uuid, fid text, kind text, expires_at timestamptz)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_device public.native_push_devices%rowtype;
  v_event uuid;
  v_delivery uuid;
  v_lease uuid := pg_catalog.gen_random_uuid();
  v_count integer;
  v_expires timestamptz := clock_timestamp() + interval '10 minutes';
begin
  -- Registration/opt-out use this same lock. Lock event writes so the only
  -- pending rows introduced after our empty-queue check are from this order.
  perform pg_advisory_xact_lock(2112026, 1);
  lock table public.native_push_events in share row exclusive mode;
  if has_function_privilege('service_role','public.claim_native_push_deliveries(integer)','execute')
     or has_function_privilege('service_role','public.claim_native_push_deliveries_budgeted(integer)','execute')
     or has_function_privilege('service_role','public.claim_native_push_deliveries_unbudgeted(integer)','execute')
     or exists (select 1 from public.orders o where o.id='00a80dd5-0c74-49ab-961f-7a12577ba75d'::uuid)
     or exists (select 1 from public.native_notification_audit a where a.request_id='00a80dd5-0c74-49ab-961f-7a12577ba75d'::uuid)
     or exists (select 1 from public.native_push_deliveries d where d.state='pending')
     or exists (select 1 from public.native_notification_campaigns c where c.status in ('scheduled','sending'))
     then return; end if;
  perform 1 from public.shop_staff s where s.user_id='14013050-0d77-4a6a-966b-46671008afe1'::uuid
    and s.shop_id='43e05bb4-23d6-42ec-82aa-5fe7f8fcf3f4'::uuid and s.role='owner' for update;
  if not found then return; end if;
  -- Fail closed if registrations changed. Never identify or expose the FIDs.
  if (select count(*) from public.native_push_devices) <> 2
    or (select count(*) from public.native_push_devices d where d.user_id='14013050-0d77-4a6a-966b-46671008afe1'::uuid
      and d.shop_id='43e05bb4-23d6-42ec-82aa-5fe7f8fcf3f4'::uuid and d.push_protocol=1) <> 1
    or (select count(*) from public.native_push_devices d where d.user_id='14013050-0d77-4a6a-966b-46671008afe1'::uuid
      and d.shop_id='43e05bb4-23d6-42ec-82aa-5fe7f8fcf3f4'::uuid and d.push_protocol=2
      and d.app_version_code=5 and d.app_version_name='2.1.0-isolated-test') <> 1 then return; end if;
  select d.* into v_device from public.native_push_devices d where d.user_id='14013050-0d77-4a6a-966b-46671008afe1'::uuid
    and d.shop_id='43e05bb4-23d6-42ec-82aa-5fe7f8fcf3f4'::uuid and d.push_protocol=2
    and d.app_version_code=5 and d.app_version_name='2.1.0-isolated-test' for update;
  if not found then return; end if;
  -- The real order trigger makes the event and snapshots both installations.
  -- The deterministic ID ensures duplicate invocations cannot create/send again.
  insert into public.orders(id, shop_id, customer_name, status, payment_method, notes)
  select '00a80dd5-0c74-49ab-961f-7a12577ba75d'::uuid, s.id, 'SYNTHETIC QA - Notification test',
    'queued', null, 'Isolated test only. No real payment or file.'
  from public.shops s where s.id='43e05bb4-23d6-42ec-82aa-5fe7f8fcf3f4'::uuid
    and s.owner_id='14013050-0d77-4a6a-966b-46671008afe1'::uuid and s.name='QA Test Shop c47d26a6' and s.is_open is true;
  if not found then return; end if;
  select count(*), min(d.event_id::text)::uuid into v_count,v_event from public.native_push_deliveries d where d.state='pending';
  if v_count <> 2 or (select count(distinct d.event_id) from public.native_push_deliveries d where d.state='pending') <> 1
    or not exists (select 1 from public.native_push_events e where e.id=v_event and e.shop_id=v_device.shop_id and e.kind='order')
    or not exists (select 1 from public.native_push_deliveries d where d.event_id=v_event and d.binding_id=v_device.binding_id and d.state='pending')
    then raise exception 'QA_ORDER_SNAPSHOT_MISMATCH'; end if;
  update public.native_push_events e set expires_at=v_expires where e.id=v_event;
  update public.native_push_deliveries d set state='discarded', attempts=8, completed_at=clock_timestamp()
    where d.event_id=v_event and d.binding_id<>v_device.binding_id and d.state='pending';
  get diagnostics v_count = row_count;
  if v_count <> 1 then raise exception 'QA_ORDER_NON_TARGET_MISMATCH'; end if;
  update public.native_push_deliveries d set attempts=8, lease_until=clock_timestamp()+interval '2 minutes',
    lease_token=v_lease, leased_device_generation=v_device.generation
    where d.event_id=v_event and d.binding_id=v_device.binding_id and d.state='pending' returning d.id into v_delivery;
  if not found then raise exception 'QA_ORDER_TARGET_MISMATCH'; end if;
  -- This independent durable marker survives deletion of the synthetic order.
  insert into public.native_notification_audit(actor,action,subject_id,request_id)
    values(null,'isolated_qa_order_one_shot','00a80dd5-0c74-49ab-961f-7a12577ba75d'::uuid,'00a80dd5-0c74-49ab-961f-7a12577ba75d'::uuid);
  return query select v_delivery,v_lease,v_event,v_device.binding_id,v_device.fid,'order'::text,v_expires;
end $$;
revoke all on function public.claim_printly_qa_order_00a80dd5_once() from public,anon,authenticated,service_role;
grant execute on function public.claim_printly_qa_order_00a80dd5_once() to service_role;
commit;
