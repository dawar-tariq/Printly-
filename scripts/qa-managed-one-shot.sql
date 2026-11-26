-- TEMPORARY: install only in the separately verified isolated QA database.
-- One authorized v2 test for the fixed synthetic owner/shop. Remove the
-- function immediately after the test. Never enable the general worker.
begin;
create function public.claim_printly_qa_v2_e320520dd717_once()
returns table (delivery_id uuid, lease_token uuid, event_id uuid, binding_id uuid, fid text, kind text, expires_at timestamptz)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_device public.native_push_devices%rowtype;
  v_delivery uuid := pg_catalog.gen_random_uuid();
  v_lease uuid := pg_catalog.gen_random_uuid();
  v_expires timestamptz := clock_timestamp() + interval '10 minutes';
begin
  -- Serialize with the existing registration/opt-out functions. Fail closed if
  -- a general worker can claim, any pending work exists, or this fixed test
  -- has already been created. The old v1 installation is never targeted.
  perform pg_advisory_xact_lock(2112026, 1);
  if has_function_privilege('service_role', 'public.claim_native_push_deliveries(integer)', 'execute')
     or has_function_privilege('service_role', 'public.claim_native_push_deliveries_budgeted(integer)', 'execute')
     or has_function_privilege('service_role', 'public.claim_native_push_deliveries_unbudgeted(integer)', 'execute')
     or exists (select 1 from public.native_push_events e where e.id = '997a24b9-9460-4565-833c-f0cfbe580f11'::uuid)
     or exists (select 1 from public.native_notification_campaigns c where c.id = '90e80914-b861-4f31-94b1-523d20191e35'::uuid)
     or exists (select 1 from public.native_push_deliveries q where q.state = 'pending')
     or exists (select 1 from public.native_notification_campaigns c where c.status in ('scheduled', 'sending'))
     then return; end if;
  perform 1 from public.shop_staff s
    where s.user_id = '14013050-0d77-4a6a-966b-46671008afe1'::uuid
      and s.shop_id = '43e05bb4-23d6-42ec-82aa-5fe7f8fcf3f4'::uuid and s.role = 'owner'
    for key share;
  if not found then return; end if;
  if (select count(*) from public.native_push_devices d
      where d.user_id = '14013050-0d77-4a6a-966b-46671008afe1'::uuid
        and d.shop_id = '43e05bb4-23d6-42ec-82aa-5fe7f8fcf3f4'::uuid
        and d.push_protocol = 2 and d.app_version_code = 5 and d.app_version_name = '2.1.0-isolated-test') <> 1
    then return; end if;
  select d.* into v_device from public.native_push_devices d
    where d.user_id = '14013050-0d77-4a6a-966b-46671008afe1'::uuid
      and d.shop_id = '43e05bb4-23d6-42ec-82aa-5fe7f8fcf3f4'::uuid
      and d.push_protocol = 2 and d.app_version_code = 5 and d.app_version_name = '2.1.0-isolated-test'
    for update;
  if not found then return; end if;

  -- This is an explicitly marked QA record, not an impersonated admin action.
  -- The fixed device audience and campaign payload use the same production
  -- v2 message, display-receipt and delivery-log contracts.
  insert into public.native_notification_campaigns
    (id, title, message, notification_type, tap_action, audience_kind, device_ids, status, scheduled_at)
    values ('90e80914-b861-4f31-94b1-523d20191e35'::uuid, 'Printly QA test',
      'This is a test notification. No action is needed.', 'general', 'home', 'devices',
      array[v_device.binding_id], 'sending', clock_timestamp());
  insert into public.native_notification_audit(actor, action, subject_id)
    values (null, 'isolated_qa_one_time_test', '90e80914-b861-4f31-94b1-523d20191e35'::uuid);
  insert into public.native_push_events(id, shop_id, kind, campaign_id, expires_at)
    values ('997a24b9-9460-4565-833c-f0cfbe580f11'::uuid, v_device.shop_id, 'general',
      '90e80914-b861-4f31-94b1-523d20191e35'::uuid, v_expires);
  -- Start at the maximum attempts. A crash or ambiguous FCM response cannot
  -- make a general worker issue a second send after the lease expires.
  insert into public.native_push_deliveries(id, event_id, binding_id, state, attempts, lease_until, lease_token, leased_device_generation)
    values (v_delivery, '997a24b9-9460-4565-833c-f0cfbe580f11'::uuid, v_device.binding_id, 'pending', 8,
      clock_timestamp() + interval '2 minutes', v_lease, v_device.generation);
  return query select v_delivery, v_lease, '997a24b9-9460-4565-833c-f0cfbe580f11'::uuid,
    v_device.binding_id, v_device.fid, 'general'::text, v_expires;
end $$;
revoke all on function public.claim_printly_qa_v2_e320520dd717_once() from public, anon, authenticated, service_role;
grant execute on function public.claim_printly_qa_v2_e320520dd717_once() to service_role;
commit;
