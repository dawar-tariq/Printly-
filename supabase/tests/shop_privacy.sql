-- Regression test for migrations through 0009. Run as a database owner with
-- psql against a Supabase database; all fixture data and writes are rolled back.
begin;
select set_config('printly_test.owner_a', gen_random_uuid()::text, true),
       set_config('printly_test.owner_b', gen_random_uuid()::text, true),
       set_config('printly_test.shop_a', gen_random_uuid()::text, true),
       set_config('printly_test.shop_b', gen_random_uuid()::text, true);

insert into auth.users (id, email, aud, role, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select id::uuid, 'privacy-test-' || id || '@example.invalid', 'authenticated', 'authenticated', '{}'::jsonb, '{}'::jsonb, now(), now()
from (values (current_setting('printly_test.owner_a')), (current_setting('printly_test.owner_b'))) as users(id);

select set_config('printly.checked_shop_name', current_setting('printly_test.shop_a'), true);
insert into public.shops (id, owner_id, slug, short_code, name, status, kyc_status, gstin, commission_bps)
values (current_setting('printly_test.shop_a')::uuid, current_setting('printly_test.owner_a')::uuid,
        'privacy-test-' || current_setting('printly_test.shop_a'), replace(current_setting('printly_test.shop_a'), '-', ''),
        'Privacy test A ' || current_setting('printly_test.shop_a'), 'active', 'approved', '01ABCDE1234F1Z5', 800);
select set_config('printly.checked_shop_name', current_setting('printly_test.shop_b'), true);
insert into public.shops (id, owner_id, slug, short_code, name, status, kyc_status, gstin, commission_bps)
values (current_setting('printly_test.shop_b')::uuid, current_setting('printly_test.owner_b')::uuid,
        'privacy-test-' || current_setting('printly_test.shop_b'), replace(current_setting('printly_test.shop_b'), '-', ''),
        'Privacy test B ' || current_setting('printly_test.shop_b'), 'active', 'approved', '01ABCDE1234F1Z5', 900);
insert into public.shop_staff (shop_id, user_id, role) values
  (current_setting('printly_test.shop_a')::uuid, current_setting('printly_test.owner_a')::uuid, 'owner'),
  (current_setting('printly_test.shop_b')::uuid, current_setting('printly_test.owner_b')::uuid, 'owner');
insert into public.shop_onboarding (shop_id) values
  (current_setting('printly_test.shop_a')::uuid), (current_setting('printly_test.shop_b')::uuid);
insert into public.inventory_items (shop_id, name, category, qty, unit, low_stock_threshold) values
  (current_setting('printly_test.shop_a')::uuid, 'Private A', 'paper', 1, 'sheets', 0),
  (current_setting('printly_test.shop_b')::uuid, 'Private B', 'paper', 1, 'sheets', 0);
insert into public.orders (shop_id, customer_name) values
  (current_setting('printly_test.shop_a')::uuid, 'Private A'),
  (current_setting('printly_test.shop_b')::uuid, 'Private B');
insert into public.shop_services (shop_id, service, enabled) values
  (current_setting('printly_test.shop_a')::uuid, 'print', true);
insert into storage.objects (bucket_id, name) values
  ('shop-name-proofs', current_setting('printly_test.shop_a') || '/privacy-test.png');

do $$ begin
  if not exists (select 1 from storage.buckets where id = 'shop-name-proofs' and public = false) then
    raise exception 'name-proof bucket must be private';
  end if;
end $$;

set local role anon;
do $$ begin
  if not exists (select id from public.shops where id = current_setting('printly_test.shop_a')::uuid) then
    raise exception 'anonymous users cannot read public directory fields';
  end if;
  if not exists (select 1 from public.shop_services where shop_id = current_setting('printly_test.shop_a')::uuid) then
    raise exception 'anonymous users cannot read public services';
  end if;
  if has_column_privilege(current_user, 'public.shops', 'owner_id', 'select')
     or has_column_privilege(current_user, 'public.shops', 'gstin', 'select')
     or has_column_privilege(current_user, 'public.shops', 'commission_bps', 'select')
     or has_table_privilege(current_user, 'public.shops', 'truncate') then
    raise exception 'anonymous users have private shop privileges';
  end if;
  if exists (select 1 from storage.objects where bucket_id = 'shop-name-proofs'
             and name = current_setting('printly_test.shop_a') || '/privacy-test.png') then
    raise exception 'anonymous users can read private proof metadata';
  end if;
end $$;
reset role;

select set_config('request.jwt.claim.sub', current_setting('printly_test.owner_a'), true);
set local role authenticated;
do $$ begin
  if not public.is_shop_owner(current_setting('printly_test.shop_a')::uuid)
     or public.is_shop_owner(current_setting('printly_test.shop_b')::uuid) then
    raise exception 'ownership check is not isolated';
  end if;
  if has_column_privilege(current_user, 'public.shops', 'owner_id', 'select')
     or has_column_privilege(current_user, 'public.shops', 'gstin', 'select')
     or has_column_privilege(current_user, 'public.shops', 'commission_bps', 'select')
     or has_table_privilege(current_user, 'public.inventory_items', 'truncate') then
    raise exception 'authenticated users have private directory or truncate privileges';
  end if;
  if not exists (select 1 from public.inventory_items where shop_id = current_setting('printly_test.shop_a')::uuid)
     or exists (select 1 from public.inventory_items where shop_id = current_setting('printly_test.shop_b')::uuid)
     or not exists (select 1 from public.orders where shop_id = current_setting('printly_test.shop_a')::uuid)
     or exists (select 1 from public.orders where shop_id = current_setting('printly_test.shop_b')::uuid)
     or not exists (select 1 from public.shop_onboarding where shop_id = current_setting('printly_test.shop_a')::uuid)
     or exists (select 1 from public.shop_onboarding where shop_id = current_setting('printly_test.shop_b')::uuid) then
    raise exception 'cross-shop private data was visible, or own data was unavailable';
  end if;
  if exists (select 1 from storage.objects where bucket_id = 'shop-name-proofs'
             and name = current_setting('printly_test.shop_a') || '/privacy-test.png') then
    raise exception 'shop users can read private proof metadata directly';
  end if;
  begin
    update public.profiles set role = 'admin' where id = current_setting('printly_test.owner_a')::uuid;
    raise exception 'self-promotion was permitted';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.shop_staff (shop_id, user_id, role)
    values (current_setting('printly_test.shop_b')::uuid, current_setting('printly_test.owner_a')::uuid, 'staff');
    raise exception 'cross-shop membership was permitted';
  exception when insufficient_privilege then null; end;
  -- Owner membership management for their own shop still works.
  insert into public.shop_staff (shop_id, user_id, role)
  values (current_setting('printly_test.shop_a')::uuid, current_setting('printly_test.owner_b')::uuid, 'staff');
  update public.shop_staff set role = 'manager'
    where shop_id = current_setting('printly_test.shop_a')::uuid and user_id = current_setting('printly_test.owner_b')::uuid;
  delete from public.shop_staff
    where shop_id = current_setting('printly_test.shop_a')::uuid and user_id = current_setting('printly_test.owner_b')::uuid;
end $$;
reset role;

select set_config('request.jwt.claim.sub', current_setting('printly_test.owner_b'), true);
set local role authenticated;
do $$ begin
  if not public.is_shop_owner(current_setting('printly_test.shop_b')::uuid)
     or public.is_shop_owner(current_setting('printly_test.shop_a')::uuid)
     or exists (select 1 from public.inventory_items where shop_id = current_setting('printly_test.shop_a')::uuid)
     or not exists (select 1 from public.inventory_items where shop_id = current_setting('printly_test.shop_b')::uuid) then
    raise exception 'reverse cross-shop access check failed';
  end if;
end $$;
rollback;
