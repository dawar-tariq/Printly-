-- Temporary single-attempt production notification test, not a scheduler.
-- Direct synthetic event, not a real order/payment. Remove helper after use.
create function public.claim_printly_prod_token_test_once()
returns table (delivery_id uuid, lease_token uuid, event_id uuid, binding_id uuid, fid text, kind text, expires_at timestamptz, order_token text)
language plpgsql security definer set search_path=public,pg_temp as $$
declare dev public.native_push_devices%rowtype; eid uuid := '810af132-64b7-4ee1-b145-50b2958955b6'; did uuid := gen_random_uuid(); lease uuid := gen_random_uuid(); expires timestamptz := clock_timestamp()+interval '10 minutes';
begin
  perform pg_advisory_xact_lock(2112026,1);
  if has_function_privilege('service_role','public.claim_native_push_deliveries(integer)','execute')
    or has_function_privilege('service_role','public.claim_native_push_deliveries_budgeted(integer)','execute')
    or has_function_privilege('service_role','public.claim_native_push_deliveries_unbudgeted(integer)','execute')
    or exists(select 1 from public.native_notification_audit where request_id=eid)
    or exists(select 1 from public.native_push_deliveries where state='pending')
    or exists(select 1 from public.native_notification_campaigns where status in ('scheduled','sending'))
    or (select count(*) from public.native_push_devices)<>1 then return; end if;
  select d.* into dev from public.native_push_devices d join public.shop_staff s on s.user_id=d.user_id and s.shop_id=d.shop_id
    where d.push_protocol=2 and d.app_version_code=6 and d.app_version_name='2.1.1' and s.role='owner' for update of d;
  if not found then return; end if;
  insert into public.native_notification_audit(action,subject_id,request_id) values('production_synthetic_token_test',eid,eid);
  insert into public.native_push_events(id,shop_id,kind,order_token,expires_at) values(eid,dev.shop_id,'order','A-1234567890',expires);
  insert into public.native_push_deliveries(id,event_id,binding_id,attempts,lease_until,lease_token,leased_device_generation)
    values(did,eid,dev.binding_id,8,clock_timestamp()+interval '2 minutes',lease,dev.generation);
  return query select did,lease,eid,dev.binding_id,dev.fid,'order'::text,expires,'A-1234567890'::text;
end $$;
revoke all on function public.claim_printly_prod_token_test_once() from public,anon,authenticated,service_role;
grant execute on function public.claim_printly_prod_token_test_once() to service_role;
notify pgrst,'reload schema';
