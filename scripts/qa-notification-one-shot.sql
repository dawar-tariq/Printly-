-- TEMPORARY: install only in the separately verified isolated QA database.
-- Remove this helper after the single authorized phone test; not a migration.
-- The fixed owner/shop/event are synthetic and this function accepts no input.
begin;
create function public.claim_printly_qa_c47d26a6_once()
returns table (delivery_id uuid, lease_token uuid, event_id uuid, binding_id uuid, fid text, kind text, expires_at timestamptz)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_device public.native_push_devices%rowtype;
  v_delivery uuid := pg_catalog.gen_random_uuid();
  v_lease uuid := pg_catalog.gen_random_uuid();
  v_expires timestamptz := clock_timestamp() + interval '10 minutes';
begin
  -- Serialize with registration and opt-out. Do not claim someone else's
  -- device, create an additional alert, or touch an unrelated pending queue.
  perform pg_advisory_xact_lock(2112026, 1);
  if exists (select 1 from public.native_push_events e where e.id = '3b1c6a49-f9f9-447b-ac45-6f399ea5d974'::uuid)
     or exists (select 1 from public.native_push_deliveries q where q.state = 'pending')
     or (select count(*) from public.native_push_devices) <> 1 then return; end if;
  perform 1 from public.shop_staff s
    where s.user_id = '14013050-0d77-4a6a-966b-46671008afe1'::uuid
      and s.shop_id = '43e05bb4-23d6-42ec-82aa-5fe7f8fcf3f4'::uuid and s.role = 'owner'
    for key share;
  if not found then return; end if;
  select d.* into v_device from public.native_push_devices d
    where d.user_id = '14013050-0d77-4a6a-966b-46671008afe1'::uuid
      and d.shop_id = '43e05bb4-23d6-42ec-82aa-5fe7f8fcf3f4'::uuid
    for update;
  if not found then return; end if;

  insert into public.native_push_events(id, shop_id, kind, expires_at)
    values ('3b1c6a49-f9f9-447b-ac45-6f399ea5d974'::uuid, v_device.shop_id, 'order', v_expires);
  -- Start at the maximum attempts. A crash, a timeout or an unconfirmed
  -- acknowledgement cannot make the general worker issue a second send.
  insert into public.native_push_deliveries(id, event_id, binding_id, state, attempts, lease_until, lease_token, leased_device_generation)
    values (v_delivery, '3b1c6a49-f9f9-447b-ac45-6f399ea5d974'::uuid, v_device.binding_id, 'pending', 8,
      clock_timestamp() + interval '2 minutes', v_lease, v_device.generation);
  return query select v_delivery, v_lease, '3b1c6a49-f9f9-447b-ac45-6f399ea5d974'::uuid,
    v_device.binding_id, v_device.fid, 'order'::text, v_expires;
end $$;
revoke all on function public.claim_printly_qa_c47d26a6_once() from public, anon, authenticated, service_role;
grant execute on function public.claim_printly_qa_c47d26a6_once() to service_role;
commit;
