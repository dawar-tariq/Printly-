-- Printly seed: platform settings + demo users + demo shop + sample orders

-- platform settings
insert into platform_settings(key, value) values
  ('commission_bps', '800'::jsonb),
  ('gst_bps', '1800'::jsonb),
  ('rush_bps', '1000'::jsonb),
  ('default_eta_minutes', '20'::jsonb),
  ('maintenance', 'false'::jsonb),
  ('dropbox_chooser_enabled', 'true'::jsonb)
on conflict (key) do nothing;

-- demo auth users (password: demo1234)
insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, last_sign_in_at, raw_app_meta_data, raw_user_meta_data,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  email_change_token_current, phone_change, phone_change_token, reauthentication_token,
  created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', 'b2222222-2222-4222-8222-222222222221', 'authenticated', 'authenticated',
   'demoshop@printly.test', crypt('demo1234', gen_salt('bf')), now(), now(),
   '{"provider":"email","providers":["email"]}', '{"full_name":"Demo Shop Owner"}',
   '', '', '', '', '', '', '', '', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'b2222222-2222-4222-8222-222222222222', 'authenticated', 'authenticated',
   'admin@printly.test', crypt('demo1234', gen_salt('bf')), now(), now(),
   '{"provider":"email","providers":["email"]}', '{"full_name":"Printly Admin"}',
   '', '', '', '', '', '', '', '', now(), now())
on conflict (id) do nothing;

insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
values
  (gen_random_uuid(), 'b2222222-2222-4222-8222-222222222221', 'b2222222-2222-4222-8222-222222222221',
   '{"sub":"b2222222-2222-4222-8222-222222222221","email":"demoshop@printly.test"}', 'email', now(), now(), now()),
  (gen_random_uuid(), 'b2222222-2222-4222-8222-222222222222', 'b2222222-2222-4222-8222-222222222222',
   '{"sub":"b2222222-2222-4222-8222-222222222222","email":"admin@printly.test"}', 'email', now(), now(), now())
on conflict do nothing;

update profiles set role = 'shop_staff' where email = 'demoshop@printly.test';
update profiles set role = 'admin' where email = 'admin@printly.test';

-- demo shop
insert into shops (id, owner_id, slug, short_code, name, address, city, phone, upi_id,
                   kyc_status, status, commission_bps, eta_minutes, rating_avg, rating_count)
values ('a1111111-1111-4111-8111-111111111111', 'b2222222-2222-4222-8222-222222222221',
        'demo-prints', 'DEMO1', 'Demo Prints — Lal Chowk', 'Shop 14, Residency Road, Lal Chowk', 'Srinagar',
        '+91 99060 00000', 'demoprints@okaxis', 'approved', 'active', 800, 20, 4.6, 128);

insert into shop_staff (shop_id, user_id, role)
values ('a1111111-1111-4111-8111-111111111111', 'b2222222-2222-4222-8222-222222222221', 'owner');

insert into shop_services (shop_id, service, enabled, display_order) values
  ('a1111111-1111-4111-8111-111111111111', 'print', true, 1),
  ('a1111111-1111-4111-8111-111111111111', 'photocopy', true, 2),
  ('a1111111-1111-4111-8111-111111111111', 'scan', true, 3),
  ('a1111111-1111-4111-8111-111111111111', 'bind', true, 4),
  ('a1111111-1111-4111-8111-111111111111', 'laminate', true, 5);

insert into rate_card (shop_id, service, paper_size, color, sides, paper_gsm, option, unit, price_paise) values
  ('a1111111-1111-4111-8111-111111111111', 'print', 'A4', 'bw', 'single', 80, null, 'page', 200),
  ('a1111111-1111-4111-8111-111111111111', 'print', 'A4', 'bw', 'duplex', 80, null, 'page', 150),
  ('a1111111-1111-4111-8111-111111111111', 'print', 'A4', 'color', 'single', 80, null, 'page', 1000),
  ('a1111111-1111-4111-8111-111111111111', 'print', 'A4', 'color', 'duplex', 80, null, 'page', 800),
  ('a1111111-1111-4111-8111-111111111111', 'print', 'A3', 'bw', 'single', 90, null, 'page', 400),
  ('a1111111-1111-4111-8111-111111111111', 'print', 'A3', 'color', 'single', 90, null, 'page', 2000),
  ('a1111111-1111-4111-8111-111111111111', 'print', 'A5', 'bw', 'single', 80, null, 'page', 150),
  ('a1111111-1111-4111-8111-111111111111', 'print', 'A5', 'color', 'single', 80, null, 'page', 800),
  ('a1111111-1111-4111-8111-111111111111', 'photocopy', 'A4', 'bw', null, null, null, 'page', 150),
  ('a1111111-1111-4111-8111-111111111111', 'photocopy', 'A4', 'color', null, null, null, 'page', 800),
  ('a1111111-1111-4111-8111-111111111111', 'photocopy', 'A3', 'bw', null, null, null, 'page', 300),
  ('a1111111-1111-4111-8111-111111111111', 'scan', 'A4', 'color', null, null, null, 'page', 500),
  ('a1111111-1111-4111-8111-111111111111', 'scan', 'A4', 'bw', null, null, null, 'page', 300),
  ('a1111111-1111-4111-8111-111111111111', 'bind', null, null, null, null, 'staple', 'job', 1000),
  ('a1111111-1111-4111-8111-111111111111', 'bind', null, null, null, null, 'spiral', 'job', 3000),
  ('a1111111-1111-4111-8111-111111111111', 'bind', null, null, null, null, 'hard', 'job', 5000),
  ('a1111111-1111-4111-8111-111111111111', 'laminate', 'A4', null, null, null, null, 'sheet', 1000),
  ('a1111111-1111-4111-8111-111111111111', 'laminate', 'A3', null, null, null, null, 'sheet', 2000);

insert into inventory_items (shop_id, name, category, qty, unit, low_stock_threshold) values
  ('a1111111-1111-4111-8111-111111111111', 'A4 75gsm — reams', 'paper', 40, 'reams', 10),
  ('a1111111-1111-4111-8111-111111111111', 'A3 90gsm — sheets', 'paper', 800, 'sheets', 100),
  ('a1111111-1111-4111-8111-111111111111', 'Black toner cartridge', 'ink', 2, 'cartridges', 1),
  ('a1111111-1111-4111-8111-111111111111', 'Spiral binding combs', 'binding', 40, 'combs', 10),
  ('a1111111-1111-4111-8111-111111111111', 'Laminating rolls', 'laminate', 12, 'rolls', 3);

-- sample orders (this date)
insert into orders (id, shop_id, customer_name, customer_phone, token, token_date, status, payment_status,
  payment_method, subtotal_paise, tax_paise, total_paise, commission_paise, eta_minutes, ready_at)
values
  ('c3333333-3333-4333-8333-333333330001', 'a1111111-1111-4111-8111-111111111111', 'Aisha Khan', '+91 97970 00001',
   'A-001', current_date, 'printing', 'confirmed', 'upi', 7800, 1404, 9204, 736, 15, null),
  ('c3333333-3333-4333-8333-333333330002', 'a1111111-1111-4111-8111-111111111111', 'Rohit Sharma', '+91 97970 00002',
   'A-002', current_date, 'queued', 'cod_pending', 'cod', 8000, 1440, 9440, 755, 25, null),
  ('c3333333-3333-4333-8333-333333330003', 'a1111111-1111-4111-8111-111111111111', 'Mehak Bhat', '+91 97970 00003',
   'A-003', current_date, 'ready', 'confirmed', 'upi', 6000, 1080, 7080, 566, 10, now() - interval '5 minutes'),
  ('c3333333-3333-4333-8333-333333330004', 'a1111111-1111-4111-8111-111111111111', 'Faizan Mir', '+91 97970 00004',
   null, current_date, 'draft', 'submitted', 'upi', 750, 135, 885, 71, null, null);

insert into order_items (order_id, service, paper_size, color, sides, paper_gsm, option, copies, pages, binding, unit_price_paise, line_total_paise)
values
  ('c3333333-3333-4333-8333-333333330001', 'print', 'A4', 'bw', 'single', 80, null, 2, 12, 'none', 200, 4800),
  ('c3333333-3333-4333-8333-333333330001', 'bind', 'A4', 'bw', 'single', 80, 'spiral', 1, 1, 'spiral', 3000, 3000),
  ('c3333333-3333-4333-8333-333333330002', 'print', 'A4', 'bw', 'single', 80, null, 1, 40, 'none', 200, 8000),
  ('c3333333-3333-4333-8333-333333330003', 'print', 'A4', 'color', 'single', 80, null, 1, 6, 'none', 1000, 6000),
  ('c3333333-3333-4333-8333-333333330004', 'photocopy', 'A4', 'bw', 'single', 80, null, 1, 5, 'none', 150, 750);

insert into payments (order_id, provider, amount_paise, status, utr, confirmed_by, confirmed_at) values
  ('c3333333-3333-4333-8333-333333330001', 'upi', 9204, 'confirmed', 'UPI/426178900123', 'b2222222-2222-4222-8222-222222222221', now() - interval '20 minutes'),
  ('c3333333-3333-4333-8333-333333330002', 'cod', 9440, 'cod_pending', null, null, null),
  ('c3333333-3333-4333-8333-333333330003', 'upi', 7080, 'confirmed', 'UPI/426178900456', 'b2222222-2222-4222-8222-222222222221', now() - interval '40 minutes'),
  ('c3333333-3333-4333-8333-333333330004', 'upi', 885, 'submitted', '426178900789', null, null);

update orders set utr = '426178900789' where id = 'c3333333-3333-4333-8333-333333330004';

insert into order_status_events (order_id, from_status, to_status, by, note) values
  ('c3333333-3333-4333-8333-333333330001', 'draft', 'queued', null, 'Payment confirmed by shop (UPI)'),
  ('c3333333-3333-4333-8333-333333330001', 'queued', 'printing', 'b2222222-2222-4222-8222-222222222221', null),
  ('c3333333-3333-4333-8333-333333330002', 'draft', 'queued', null, 'COD order — confirm cash on collection'),
  ('c3333333-3333-4333-8333-333333330003', 'printing', 'ready', 'b2222222-2222-4222-8222-222222222221', null),
  ('c3333333-3333-4333-8333-333333330004', 'draft', 'draft', null, 'Customer marked UPI payment done (UTR 426178900789)');
