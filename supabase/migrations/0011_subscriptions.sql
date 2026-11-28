-- One all-features subscription with three fixed terms. UPI is a manual bank
-- transfer: a shop's report never grants access; an admin must verify it.
-- Apply with the matching application in a planned maintenance window.

create table public.subscription_plan (
  id boolean primary key default true check (id),
  monthly_paise integer check (monthly_paise between 1 and 100000000),
  six_months_paise integer check (six_months_paise between 1 and 100000000),
  yearly_paise integer check (yearly_paise between 1 and 100000000),
  upi_id text check (upi_id is null or (length(upi_id) <= 100 and upi_id ~ '^[a-zA-Z0-9_.-]{2,}@[a-zA-Z][a-zA-Z0-9_.-]{1,}$')),
  payee_name text check (payee_name is null or length(trim(payee_name)) between 1 and 50),
  warning_days integer not null default 7 check (warning_days between 1 and 30),
  version bigint not null default 0 check (version >= 0),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id)
);
insert into public.subscription_plan (id) values (true);

create table public.shop_subscriptions (
  shop_id uuid primary key references public.shops(id) on delete cascade,
  term text check (term in ('grace', 'monthly', 'six_months', 'yearly')),
  started_at timestamptz,
  expires_at timestamptz,
  is_permanent boolean not null default false,
  permanent_by uuid references public.profiles(id),
  updated_at timestamptz not null default now(),
  check ((term is null and started_at is null and expires_at is null) or
         (term is not null and started_at is not null and expires_at is not null and expires_at > started_at))
);

-- Only shops already present at cutover receive the agreed one-time transition.
-- New shops have no entitlement until payment is verified or an admin grants it.
insert into public.shop_subscriptions (shop_id, term, started_at, expires_at)
select id, 'grace', now(), now() + interval '30 days' from public.shops;

create table public.subscription_purchases (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id),
  requested_by uuid not null references public.profiles(id),
  term text not null check (term in ('monthly', 'six_months', 'yearly')),
  amount_paise integer not null check (amount_paise between 1 and 100000000),
  upi_id text not null,
  payee_name text not null,
  status text not null default 'initiated' check (status in ('initiated', 'submitted', 'approved', 'rejected', 'cancelled')),
  utr text check (utr is null or utr ~ '^[A-Z0-9][A-Z0-9-]{5,39}$'),
  submitted_at timestamptz,
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  review_note text not null default '' check (length(review_note) <= 500),
  period_start timestamptz,
  period_end timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (status not in ('submitted', 'approved', 'rejected') or (utr is not null and submitted_at is not null)),
  check (status <> 'approved' or (reviewed_by is not null and reviewed_at is not null and period_start is not null and period_end > period_start))
);
create unique index subscription_one_open_purchase on public.subscription_purchases(shop_id)
  where status in ('initiated', 'submitted');
create unique index subscription_one_live_reference on public.subscription_purchases(utr)
  where status in ('submitted', 'approved') and utr is not null;
create index subscription_purchases_shop_created on public.subscription_purchases(shop_id, created_at desc);
create index subscription_purchases_review on public.subscription_purchases(status, submitted_at);

create table public.subscription_events (
  id bigint generated always as identity primary key,
  shop_id uuid not null references public.shops(id),
  purchase_id uuid references public.subscription_purchases(id),
  actor_id uuid references public.profiles(id),
  event text not null,
  note text not null default '' check (length(note) <= 500),
  created_at timestamptz not null default now()
);
create index subscription_events_shop_created on public.subscription_events(shop_id, created_at desc);

alter table public.subscription_plan enable row level security;
alter table public.shop_subscriptions enable row level security;
alter table public.subscription_purchases enable row level security;
alter table public.subscription_events enable row level security;
revoke all on public.subscription_plan, public.shop_subscriptions, public.subscription_purchases, public.subscription_events from public, anon, authenticated;
grant select, insert, update, delete on public.subscription_plan, public.shop_subscriptions, public.subscription_purchases, public.subscription_events to service_role;
grant usage, select on sequence public.subscription_events_id_seq to service_role;

create or replace function public.shop_subscription_active(p_shop_id uuid) returns boolean
language sql volatile security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.shop_subscriptions s where s.shop_id = p_shop_id
    and (s.is_permanent or s.expires_at > clock_timestamp()))
$$;
revoke all on function public.shop_subscription_active(uuid) from public;
grant execute on function public.shop_subscription_active(uuid) to anon, authenticated, service_role;

-- Compare-and-swap prevents a stale admin tab from silently overwriting a
-- newer price or payment recipient. The API validates the supplied fields;
-- table constraints remain the final authority.
create or replace function public.update_subscription_plan(p_expected_version bigint, p_changes jsonb, p_actor uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_plan public.subscription_plan%rowtype;
begin
  if not exists (select 1 from public.profiles where id = p_actor and role = 'admin') then raise exception 'ADMIN_REQUIRED' using errcode = 'P0001'; end if;
  if jsonb_typeof(p_changes) is distinct from 'object' or p_changes = '{}'::jsonb or exists (
    select 1 from jsonb_object_keys(p_changes) k where k not in ('monthly_paise', 'six_months_paise', 'yearly_paise', 'upi_id', 'payee_name', 'warning_days')
  ) then raise exception 'INVALID_PLAN' using errcode = 'P0001'; end if;
  update public.subscription_plan set
    monthly_paise = case when p_changes ? 'monthly_paise' then (p_changes->>'monthly_paise')::int else monthly_paise end,
    six_months_paise = case when p_changes ? 'six_months_paise' then (p_changes->>'six_months_paise')::int else six_months_paise end,
    yearly_paise = case when p_changes ? 'yearly_paise' then (p_changes->>'yearly_paise')::int else yearly_paise end,
    upi_id = case when p_changes ? 'upi_id' then p_changes->>'upi_id' else upi_id end,
    payee_name = case when p_changes ? 'payee_name' then p_changes->>'payee_name' else payee_name end,
    warning_days = case when p_changes ? 'warning_days' then (p_changes->>'warning_days')::int else warning_days end,
    version = version + 1, updated_at = clock_timestamp(), updated_by = p_actor
    where id = true and version = p_expected_version returning * into v_plan;
  if not found then raise exception 'SETTINGS_CHANGED' using errcode = 'P0001'; end if;
  return to_jsonb(v_plan);
end $$;
revoke all on function public.update_subscription_plan(bigint, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.update_subscription_plan(bigint, jsonb, uuid) to service_role;

-- Owners may start only one unresolved purchase. Price and recipient are
-- snapshotted on the server, so later admin edits cannot silently change it.
create or replace function public.start_subscription_purchase(p_shop_id uuid, p_actor uuid, p_term text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_owner uuid; v_plan public.subscription_plan%rowtype; v_purchase public.subscription_purchases%rowtype; v_amount int;
begin
  select owner_id into v_owner from public.shops where id = p_shop_id for update;
  if not found then raise exception 'SHOP_NOT_FOUND' using errcode = 'P0001'; end if;
  if v_owner is distinct from p_actor then raise exception 'OWNER_REQUIRED' using errcode = 'P0001'; end if;
  if p_term not in ('monthly', 'six_months', 'yearly') or p_term is null then raise exception 'INVALID_TERM' using errcode = 'P0001'; end if;
  select * into v_purchase from public.subscription_purchases
    where shop_id = p_shop_id and status in ('initiated', 'submitted') for update;
  if found then return jsonb_build_object('purchase', to_jsonb(v_purchase), 'existing', true); end if;
  if exists (select 1 from public.shop_subscriptions where shop_id = p_shop_id and is_permanent) then
    raise exception 'PERMANENT_ACCESS' using errcode = 'P0001';
  end if;
  select * into v_plan from public.subscription_plan where id = true;
  v_amount := case p_term when 'monthly' then v_plan.monthly_paise when 'six_months' then v_plan.six_months_paise else v_plan.yearly_paise end;
  if v_amount is null or v_plan.upi_id is null or v_plan.payee_name is null then
    raise exception 'SUBSCRIPTION_NOT_CONFIGURED' using errcode = 'P0001';
  end if;
  insert into public.subscription_purchases(shop_id, requested_by, term, amount_paise, upi_id, payee_name)
    values (p_shop_id, p_actor, p_term, v_amount, v_plan.upi_id, v_plan.payee_name) returning * into v_purchase;
  insert into public.subscription_events(shop_id, purchase_id, actor_id, event) values (p_shop_id, v_purchase.id, p_actor, 'purchase_started');
  return jsonb_build_object('purchase', to_jsonb(v_purchase), 'existing', false);
end $$;

create or replace function public.submit_subscription_purchase(p_shop_id uuid, p_purchase_id uuid, p_actor uuid, p_utr text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_owner uuid; v_purchase public.subscription_purchases%rowtype; v_utr text := upper(regexp_replace(coalesce(p_utr, ''), '\s+', '', 'g'));
begin
  select owner_id into v_owner from public.shops where id = p_shop_id for update;
  if not found then raise exception 'SHOP_NOT_FOUND' using errcode = 'P0001'; end if;
  if v_owner is distinct from p_actor then raise exception 'OWNER_REQUIRED' using errcode = 'P0001'; end if;
  if v_utr !~ '^[A-Z0-9][A-Z0-9-]{5,39}$' then raise exception 'INVALID_REFERENCE' using errcode = 'P0001'; end if;
  select * into v_purchase from public.subscription_purchases where id = p_purchase_id and shop_id = p_shop_id for update;
  if not found then raise exception 'PURCHASE_NOT_FOUND' using errcode = 'P0001'; end if;
  if v_purchase.status = 'submitted' and v_purchase.utr = v_utr then return to_jsonb(v_purchase); end if;
  if v_purchase.status <> 'initiated' then raise exception 'BAD_PURCHASE_STATE' using errcode = 'P0001'; end if;
  begin
    update public.subscription_purchases set status = 'submitted', utr = v_utr, submitted_at = now(), updated_at = now()
      where id = p_purchase_id returning * into v_purchase;
  exception when unique_violation then raise exception 'DUPLICATE_REFERENCE' using errcode = 'P0001'; end;
  insert into public.subscription_events(shop_id, purchase_id, actor_id, event) values (p_shop_id, p_purchase_id, p_actor, 'payment_reported');
  return to_jsonb(v_purchase);
end $$;

create or replace function public.cancel_subscription_purchase(p_shop_id uuid, p_purchase_id uuid, p_actor uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_owner uuid; v_purchase public.subscription_purchases%rowtype;
begin
  select owner_id into v_owner from public.shops where id = p_shop_id for update;
  if not found then raise exception 'SHOP_NOT_FOUND' using errcode = 'P0001'; end if;
  if v_owner is distinct from p_actor then raise exception 'OWNER_REQUIRED' using errcode = 'P0001'; end if;
  select * into v_purchase from public.subscription_purchases where id = p_purchase_id and shop_id = p_shop_id for update;
  if not found then raise exception 'PURCHASE_NOT_FOUND' using errcode = 'P0001'; end if;
  if v_purchase.status = 'cancelled' then return to_jsonb(v_purchase); end if;
  if v_purchase.status <> 'initiated' then raise exception 'BAD_PURCHASE_STATE' using errcode = 'P0001'; end if;
  update public.subscription_purchases set status = 'cancelled', updated_at = now() where id = p_purchase_id returning * into v_purchase;
  insert into public.subscription_events(shop_id, purchase_id, actor_id, event) values (p_shop_id, p_purchase_id, p_actor, 'purchase_cancelled');
  return to_jsonb(v_purchase);
end $$;

-- Lock the shop, purchase and entitlement in a consistent order. A retry is
-- idempotent and concurrent approvals cannot grant the same period twice.
create or replace function public.review_subscription_purchase(p_purchase_id uuid, p_actor uuid, p_action text, p_note text default '') returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_shop_id uuid; v_purchase public.subscription_purchases%rowtype; v_sub public.shop_subscriptions%rowtype;
        v_anchor timestamptz; v_end timestamptz; v_start timestamptz; v_months int; v_note text := trim(coalesce(p_note, ''));
begin
  if not exists (select 1 from public.profiles where id = p_actor and role = 'admin') then raise exception 'ADMIN_REQUIRED' using errcode = 'P0001'; end if;
  if p_action not in ('approve', 'reject') or p_action is null or length(v_note) > 500 then raise exception 'INVALID_REVIEW' using errcode = 'P0001'; end if;
  if p_action = 'reject' and length(v_note) < 3 then raise exception 'REASON_REQUIRED' using errcode = 'P0001'; end if;
  select shop_id into v_shop_id from public.subscription_purchases where id = p_purchase_id;
  if not found then raise exception 'PURCHASE_NOT_FOUND' using errcode = 'P0001'; end if;
  perform 1 from public.shops where id = v_shop_id for update;
  select * into v_purchase from public.subscription_purchases where id = p_purchase_id for update;
  if (p_action = 'approve' and v_purchase.status = 'approved') or (p_action = 'reject' and v_purchase.status = 'rejected') then
    return to_jsonb(v_purchase);
  end if;
  if v_purchase.status <> 'submitted' then raise exception 'BAD_PURCHASE_STATE' using errcode = 'P0001'; end if;
  if p_action = 'approve' then
    select * into v_sub from public.shop_subscriptions where shop_id = v_shop_id for update;
    v_anchor := greatest(now(), coalesce(v_sub.expires_at, now()));
    v_start := case when v_sub.expires_at > now() then v_sub.started_at else now() end;
    v_months := case v_purchase.term when 'monthly' then 1 when 'six_months' then 6 else 12 end;
    -- Calendar months follow the same India time zone used in the UI, even
    -- when UTC and local dates differ near midnight.
    v_end := ((v_anchor at time zone 'Asia/Kolkata') + make_interval(months => v_months)) at time zone 'Asia/Kolkata';
    insert into public.shop_subscriptions(shop_id, term, started_at, expires_at, updated_at)
      values (v_shop_id, v_purchase.term, v_start, v_end, now())
      on conflict (shop_id) do update set term = excluded.term, started_at = excluded.started_at,
        expires_at = excluded.expires_at, updated_at = now();
    update public.subscription_purchases set status = 'approved', reviewed_by = p_actor, reviewed_at = now(),
      review_note = v_note, period_start = v_anchor, period_end = v_end, updated_at = now()
      where id = p_purchase_id returning * into v_purchase;
  else
    update public.subscription_purchases set status = 'rejected', reviewed_by = p_actor, reviewed_at = now(),
      review_note = v_note, updated_at = now() where id = p_purchase_id returning * into v_purchase;
  end if;
  insert into public.subscription_events(shop_id, purchase_id, actor_id, event, note)
    values (v_shop_id, p_purchase_id, p_actor, case when p_action = 'approve' then 'payment_approved' else 'payment_rejected' end, v_note);
  return to_jsonb(v_purchase);
end $$;

-- Permanent access overrides (but does not erase) any underlying paid period.
-- Removing the override restores the paid period only if it is still current.
create or replace function public.set_shop_permanent_subscription(p_shop_id uuid, p_actor uuid, p_enabled boolean, p_note text default '') returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_sub public.shop_subscriptions%rowtype; v_note text := trim(coalesce(p_note, ''));
begin
  if not exists (select 1 from public.profiles where id = p_actor and role = 'admin') then raise exception 'ADMIN_REQUIRED' using errcode = 'P0001'; end if;
  if p_enabled is null or length(v_note) > 500 then raise exception 'INVALID_REVIEW' using errcode = 'P0001'; end if;
  perform 1 from public.shops where id = p_shop_id for update;
  if not found then raise exception 'SHOP_NOT_FOUND' using errcode = 'P0001'; end if;
  insert into public.shop_subscriptions(shop_id) values (p_shop_id) on conflict (shop_id) do nothing;
  select * into v_sub from public.shop_subscriptions where shop_id = p_shop_id for update;
  if v_sub.is_permanent = p_enabled then return to_jsonb(v_sub); end if;
  update public.shop_subscriptions set is_permanent = p_enabled, permanent_by = case when p_enabled then p_actor else null end,
    updated_at = now() where shop_id = p_shop_id returning * into v_sub;
  insert into public.subscription_events(shop_id, actor_id, event, note)
    values (p_shop_id, p_actor, case when p_enabled then 'permanent_granted' else 'permanent_revoked' end, v_note);
  return to_jsonb(v_sub);
end $$;

revoke all on function public.start_subscription_purchase(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.submit_subscription_purchase(uuid, uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.cancel_subscription_purchase(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.review_subscription_purchase(uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.set_shop_permanent_subscription(uuid, uuid, boolean, text) from public, anon, authenticated;
grant execute on function public.start_subscription_purchase(uuid, uuid, text) to service_role;
grant execute on function public.submit_subscription_purchase(uuid, uuid, uuid, text) to service_role;
grant execute on function public.cancel_subscription_purchase(uuid, uuid, uuid) to service_role;
grant execute on function public.review_subscription_purchase(uuid, uuid, text, text) to service_role;
grant execute on function public.set_shop_permanent_subscription(uuid, uuid, boolean, text) to service_role;

-- Application routes use the service role after checking membership and
-- entitlement. Do not permit direct table writes to bypass those checks.
revoke insert, update, delete on public.shops, public.shop_staff, public.shop_services, public.rate_card,
  public.inventory_items, public.orders, public.payments, public.order_status_events from public, anon, authenticated;
-- Disputes are created through the customer route and managed by an admin;
-- the old broad staff update policy must not bypass the expired-shop lock.
revoke update on public.disputes from public, anon, authenticated;
drop policy if exists inventory_all on public.inventory_items;
create policy inventory_subscription_select on public.inventory_items for select using (
  public.is_admin() or (shop_id in (select public.my_shop_ids()) and public.shop_subscription_active(shop_id))
);
-- Keep historical financial records for audit, but remove settlement access
-- and all operational commission settings. New orders record zero commission.
revoke all on public.payouts from public, anon, authenticated;
delete from public.platform_settings where key = 'commission_bps';
alter table public.shops alter column commission_bps set default 0;

drop policy if exists orders_select on public.orders;
create policy orders_select on public.orders for select using (
  customer_id = auth.uid() or public.is_admin() or
  (shop_id in (select public.my_shop_ids()) and
    (public.shop_subscription_active(shop_id) or status in ('queued', 'printing', 'ready') or
      (status = 'draft' and payment_method = 'upi')))
);

-- While expired, staff can access files only for recoverable open orders.
drop policy if exists order_files_storage_read on storage.objects;
create policy order_files_storage_read on storage.objects for select using (
  bucket_id = 'order-files' and (public.is_admin() or exists (
    select 1 from public.orders o where o.id::text = (storage.foldername(name))[2]
      and o.shop_id::text = (storage.foldername(name))[1]
      and o.shop_id in (select public.my_shop_ids()) and
      (public.shop_subscription_active(o.shop_id) or o.status in ('queued', 'printing', 'ready') or
        (o.status = 'draft' and o.payment_method = 'upi'))
  ))
);

create or replace function public.guard_subscription_new_order() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.status = 'draft' and new.payment_method is null then
    perform 1 from public.shops where id = new.shop_id for update;
    if not public.shop_subscription_active(new.shop_id) then raise exception 'SHOP_UNAVAILABLE' using errcode = 'P0001'; end if;
  end if;
  return new;
end $$;
drop trigger if exists guard_subscription_new_order on public.orders;
create trigger guard_subscription_new_order before insert on public.orders for each row execute function public.guard_subscription_new_order();
revoke all on function public.guard_subscription_new_order() from public, anon, authenticated;

-- Replace the existing checkout transaction: check subscription while holding
-- the shop lock and record no new commission, preserving legacy order records.
create or replace function public.commit_draft_checkout(p_order_id uuid, p_version bigint, p_rates jsonb, p_gst_bps int, p_shop jsonb, p_lines jsonb, p_checkout jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_order public.orders%rowtype;
  v_shop public.shops%rowtype;
  v_rates jsonb;
  v_gst jsonb;
  v_gst_text text;
  v_gst_bps int := 1800;
  v_line record;
  v_line_count int;
  v_total_lines bigint := 0;
  v_method text := p_checkout->>'method';
  v_token text;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'ORDER_NOT_FOUND' using errcode = 'P0001'; end if;
  if v_order.status <> 'draft' or v_order.payment_method is not null then raise exception 'ORDER_LOCKED' using errcode = 'P0001'; end if;
  if v_order.draft_version is distinct from p_version then raise exception 'ORDER_CHANGED' using errcode = 'P0001'; end if;
  select * into v_shop from public.shops where id = v_order.shop_id for update;
  if not found or v_shop.status <> 'active' then raise exception 'SHOP_UNAVAILABLE' using errcode = 'P0001'; end if;
  if not public.shop_subscription_active(v_order.shop_id) then raise exception 'SHOP_UNAVAILABLE' using errcode = 'P0001'; end if;
  if jsonb_build_object('name', v_shop.name, 'upi_id', v_shop.upi_id, 'eta_minutes', v_shop.eta_minutes,
       'rush_surcharge_bps', v_shop.rush_surcharge_bps, 'status', v_shop.status) is distinct from p_shop then
    raise exception 'PRICING_CHANGED' using errcode = 'P0001';
  end if;
  select coalesce(jsonb_agg(to_jsonb(r) order by r.id), '[]'::jsonb) into v_rates
  from (select id, service, paper_size, color, sides, paper_gsm, option, unit, price_paise
        from public.rate_card where shop_id = v_order.shop_id) r;
  if v_rates is distinct from p_rates then raise exception 'PRICING_CHANGED' using errcode = 'P0001'; end if;
  lock table public.platform_settings in share mode;
  select value into v_gst from public.platform_settings where key = 'gst_bps';
  v_gst_text := v_gst #>> '{}';
  if v_gst_text ~ '^[0-9]{1,4}$' and v_gst_text::int <= 5000 then v_gst_bps := v_gst_text::int; end if;
  if v_gst_bps is distinct from p_gst_bps then raise exception 'PRICING_CHANGED' using errcode = 'P0001'; end if;
  if v_method not in ('upi', 'cod') or v_method is null then raise exception 'INVALID_PAYMENT' using errcode = 'P0001'; end if;
  if v_method = 'upi' and nullif(v_shop.upi_id, '') is null then raise exception 'UPI_MISSING' using errcode = 'P0001'; end if;
  if jsonb_typeof(p_lines) <> 'array' then raise exception 'INVALID_LINES' using errcode = 'P0001'; end if;
  select count(*) into v_line_count from public.order_items where order_id = p_order_id;
  if v_line_count = 0 then raise exception 'EMPTY_ORDER' using errcode = 'P0001'; end if;
  if v_line_count <> jsonb_array_length(p_lines) or v_line_count <> (select count(distinct value->>'id') from jsonb_array_elements(p_lines)) then
    raise exception 'ORDER_CHANGED' using errcode = 'P0001';
  end if;
  for v_line in select * from jsonb_to_recordset(p_lines) as x(id uuid, unit_price_paise int, line_total_paise int) loop
    if v_line.unit_price_paise < 0 or v_line.line_total_paise < 0 then raise exception 'INVALID_LINES' using errcode = 'P0001'; end if;
    update public.order_items set unit_price_paise = v_line.unit_price_paise, line_total_paise = v_line.line_total_paise
      where id = v_line.id and order_id = p_order_id;
    if not found then raise exception 'ORDER_CHANGED' using errcode = 'P0001'; end if;
    v_total_lines := v_total_lines + v_line.line_total_paise;
  end loop;
  if v_total_lines <> (p_checkout->>'subtotal_paise')::bigint or
     (p_checkout->>'total_paise')::bigint <> v_total_lines + (p_checkout->>'tax_paise')::bigint or
     (p_checkout->>'total_paise')::bigint < 0 then raise exception 'INVALID_TOTAL' using errcode = 'P0001'; end if;
  if v_method = 'cod' then v_token := public.next_token(v_order.shop_id); end if;
  update public.orders set
    customer_name = p_checkout->>'customer_name', customer_phone = p_checkout->>'customer_phone',
    customer_email = coalesce(p_checkout->>'customer_email', ''), notes = coalesce(p_checkout->>'notes', ''),
    rush = coalesce((p_checkout->>'rush')::boolean, false), subtotal_paise = (p_checkout->>'subtotal_paise')::int,
    discount_paise = 0, tax_paise = (p_checkout->>'tax_paise')::int, total_paise = (p_checkout->>'total_paise')::int,
    commission_paise = 0, payment_method = v_method::public.payment_method,
    checkout_quote_token = p_checkout->>'quote_token', eta_minutes = v_shop.eta_minutes, token = v_token,
    token_date = case when v_method = 'cod' then current_date else token_date end,
    status = case when v_method = 'cod' then 'queued'::public.order_status else 'draft'::public.order_status end,
    payment_status = case when v_method = 'cod' then 'cod_pending'::public.payment_status else 'pending'::public.payment_status end,
    updated_at = now() where id = p_order_id;
  insert into public.payments(order_id, provider, amount_paise, status, raw)
  values (p_order_id, v_method, (p_checkout->>'total_paise')::int, case when v_method = 'cod' then 'cod_pending' else 'created' end,
    case when v_method = 'upi' then jsonb_build_object('checkout_upi_id', v_shop.upi_id, 'checkout_shop_name', v_shop.name) else '{}'::jsonb end)
  on conflict (order_id) do update set provider = excluded.provider, amount_paise = excluded.amount_paise,
    status = excluded.status, raw = excluded.raw, updated_at = now();
  if v_method = 'cod' then
    insert into public.order_status_events(order_id, from_status, to_status, note)
    values (p_order_id, 'draft', 'queued', 'COD order placed — token assigned');
  end if;
  return jsonb_build_object('token', v_token);
end $$;
