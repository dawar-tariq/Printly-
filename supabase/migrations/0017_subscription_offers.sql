-- Subscription promotions and announcements. Existing requests and prices are
-- never rewritten. Paid requests still require independent UPI verification;
-- a fully discounted request is granted once, in the same transaction.

create table public.subscription_promos (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[A-Z0-9][A-Z0-9_-]{2,31}$'),
  discount_type text not null check (discount_type in ('percent', 'fixed')),
  discount_value integer not null,
  terms text[] not null default array['monthly','six_months','yearly']::text[],
  starts_at timestamptz,
  ends_at timestamptz,
  max_uses integer check (max_uses is null or max_uses between 1 and 1000000),
  max_uses_per_shop integer check (max_uses_per_shop is null or max_uses_per_shop between 1 and 1000),
  enabled boolean not null default true,
  version bigint not null default 0 check (version >= 0),
  created_by uuid not null references public.profiles(id),
  updated_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((discount_type = 'percent' and discount_value between 1 and 100) or
         (discount_type = 'fixed' and discount_value between 1 and 100000000)),
  check (cardinality(terms) between 1 and 3 and terms <@ array['monthly','six_months','yearly']::text[] and array_position(terms, null) is null),
  check (starts_at is null or ends_at is null or ends_at > starts_at)
);

create table public.subscription_announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(trim(title)) between 1 and 100),
  message text not null check (length(trim(message)) between 1 and 400),
  promo_id uuid references public.subscription_promos(id),
  starts_at timestamptz,
  ends_at timestamptz,
  enabled boolean not null default true,
  public_visible boolean not null default true,
  version bigint not null default 0 check (version >= 0),
  created_by uuid not null references public.profiles(id),
  updated_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (starts_at is null or ends_at is null or ends_at > starts_at)
);

create index subscription_promos_created on public.subscription_promos(created_at desc,id desc);
create index subscription_announcements_created on public.subscription_announcements(created_at desc,id desc);
alter table public.subscription_promos enable row level security;
alter table public.subscription_announcements enable row level security;
revoke all on public.subscription_promos, public.subscription_announcements from public, anon, authenticated;
grant select, insert, update, delete on public.subscription_promos, public.subscription_announcements to service_role;

-- Historical rows retain their values. New snapshots record the undiscounted
-- term price, monthly comparison and code so later changes cannot rewrite a
-- pending payment or a receipt. Legacy rows have null snapshot fields.
alter table public.subscription_purchases
  add column base_amount_paise integer,
  add column monthly_reference_paise integer,
  add column discount_paise integer not null default 0,
  add column promo_id uuid references public.subscription_promos(id),
  add column promo_code text,
  add column request_key uuid;
create unique index subscription_purchase_request_key on public.subscription_purchases(shop_id, request_key) where request_key is not null;
create index subscription_purchase_promo_usage on public.subscription_purchases(promo_id, status, shop_id) where promo_id is not null;

alter table public.subscription_purchases
  drop constraint subscription_purchases_amount_paise_check,
  drop constraint subscription_purchases_check,
  drop constraint subscription_purchases_check1,
  alter column upi_id drop not null,
  alter column payee_name drop not null;
alter table public.subscription_purchases add constraint subscription_purchase_amount_check
  check (amount_paise between 0 and 100000000);
alter table public.subscription_purchases add constraint subscription_purchase_offer_snapshot_check
  check ((base_amount_paise is null and discount_paise = 0 and promo_id is null and promo_code is null) or
         (base_amount_paise is not null and base_amount_paise between 1 and 100000000 and discount_paise between 0 and base_amount_paise and
          amount_paise = base_amount_paise - discount_paise and
          ((promo_id is null and promo_code is null and discount_paise = 0) or (promo_id is not null and promo_code is not null))));
alter table public.subscription_purchases add constraint subscription_purchase_reference_price_check
  check (monthly_reference_paise is null or monthly_reference_paise between 1 and 1200000000);
alter table public.subscription_purchases add constraint subscription_purchase_payment_state_check
  check (
    (amount_paise > 0 and upi_id is not null and payee_name is not null and
      (status not in ('submitted','approved','rejected') or (utr is not null and submitted_at is not null)) and
      (status <> 'approved' or (reviewed_by is not null and reviewed_at is not null and period_start is not null and period_end is not null and period_end > period_start)))
    or
    (amount_paise = 0 and promo_id is not null and base_amount_paise is not null and status = 'approved' and
      upi_id is null and payee_name is null and utr is null and submitted_at is null and reviewed_by is null and
      reviewed_at is not null and period_start is not null and period_end is not null and period_end > period_start)
  );

-- Service-role RPCs also verify the acting admin, rather than trusting an ID
-- from a browser. Updates use compare-and-swap; codes are immutable because
-- purchases retain them as audit snapshots. Disabling never changes a request.
create function public.save_subscription_promo(p_actor uuid, p_id uuid, p_expected_version bigint, p_input jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_row public.subscription_promos%rowtype; v_code text; v_terms text[];
begin
  if not exists(select 1 from public.profiles where id = p_actor and role = 'admin') then raise exception 'ADMIN_REQUIRED' using errcode = 'P0001'; end if;
  if jsonb_typeof(p_input) is distinct from 'object' or jsonb_typeof(p_input->'terms') is distinct from 'array' then raise exception 'INVALID_PROMO' using errcode = 'P0001'; end if;
  v_code := upper(trim(coalesce(p_input->>'code','')));
  select array_agg(value) into v_terms from jsonb_array_elements_text(p_input->'terms') as t(value);
  if p_id is null then
    insert into public.subscription_promos(code,discount_type,discount_value,terms,starts_at,ends_at,max_uses,max_uses_per_shop,enabled,created_by,updated_by)
    values (v_code,p_input->>'discount_type',(p_input->>'discount_value')::integer,v_terms,
      (p_input->>'starts_at')::timestamptz,(p_input->>'ends_at')::timestamptz,(p_input->>'max_uses')::integer,
      (p_input->>'max_uses_per_shop')::integer,coalesce((p_input->>'enabled')::boolean,true),p_actor,p_actor) returning * into v_row;
  else
    select * into v_row from public.subscription_promos where id=p_id for update;
    if not found then raise exception 'PROMO_NOT_FOUND' using errcode = 'P0001'; end if;
    if v_row.version is distinct from p_expected_version then raise exception 'OFFER_CHANGED' using errcode = 'P0001'; end if;
    if v_row.code is distinct from v_code then raise exception 'PROMO_CODE_IMMUTABLE' using errcode = 'P0001'; end if;
    update public.subscription_promos set discount_type=p_input->>'discount_type',discount_value=(p_input->>'discount_value')::integer,
      terms=v_terms,starts_at=(p_input->>'starts_at')::timestamptz,ends_at=(p_input->>'ends_at')::timestamptz,
      max_uses=(p_input->>'max_uses')::integer,max_uses_per_shop=(p_input->>'max_uses_per_shop')::integer,
      enabled=(p_input->>'enabled')::boolean,version=version+1,updated_by=p_actor,updated_at=clock_timestamp()
      where id=p_id returning * into v_row;
  end if;
  return to_jsonb(v_row);
end $$;

create function public.save_subscription_announcement(p_actor uuid, p_id uuid, p_expected_version bigint, p_input jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_row public.subscription_announcements%rowtype; v_promo_id uuid; v_code text;
begin
  if not exists(select 1 from public.profiles where id=p_actor and role='admin') then raise exception 'ADMIN_REQUIRED' using errcode='P0001'; end if;
  if jsonb_typeof(p_input) is distinct from 'object' or not (p_input ? 'promo_code') or
     jsonb_typeof(p_input->'promo_code') not in ('string','null') then
    raise exception 'INVALID_ANNOUNCEMENT' using errcode='P0001';
  end if;
  v_code := nullif(upper(trim(coalesce(p_input->>'promo_code',''))),'');
  if v_code is not null then
    select id into v_promo_id from public.subscription_promos where code=v_code;
    if not found then raise exception 'PROMO_NOT_FOUND' using errcode='P0001'; end if;
  end if;
  if p_id is null then
    insert into public.subscription_announcements(title,message,promo_id,starts_at,ends_at,enabled,public_visible,created_by,updated_by)
    values (trim(p_input->>'title'),trim(p_input->>'message'),v_promo_id,
      (p_input->>'starts_at')::timestamptz,(p_input->>'ends_at')::timestamptz,coalesce((p_input->>'enabled')::boolean,true),
      coalesce((p_input->>'public_visible')::boolean,true),p_actor,p_actor) returning * into v_row;
  else
    select * into v_row from public.subscription_announcements where id=p_id for update;
    if not found then raise exception 'ANNOUNCEMENT_NOT_FOUND' using errcode='P0001'; end if;
    if v_row.version is distinct from p_expected_version then raise exception 'OFFER_CHANGED' using errcode='P0001'; end if;
    update public.subscription_announcements set title=trim(p_input->>'title'),message=trim(p_input->>'message'),promo_id=v_promo_id,
      starts_at=(p_input->>'starts_at')::timestamptz,ends_at=(p_input->>'ends_at')::timestamptz,
      enabled=(p_input->>'enabled')::boolean,public_visible=(p_input->>'public_visible')::boolean,
      version=version+1,updated_by=p_actor,updated_at=clock_timestamp() where id=p_id returning * into v_row;
  end if;
  return to_jsonb(v_row);
end $$;

-- Reserved = initiated or submitted. Reservations do not expire silently,
-- because a shop may already have sent money. Cancelled/rejected requests
-- release their slot; approved requests consume it permanently.
create function public.admin_subscription_offers(p_actor uuid, p_promo_page integer default 0, p_announcement_page integer default 0) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not exists(select 1 from public.profiles where id=p_actor and role='admin') then raise exception 'ADMIN_REQUIRED' using errcode='P0001'; end if;
  if p_promo_page is null or p_promo_page not between 0 and 10000 or p_announcement_page is null or p_announcement_page not between 0 and 10000 then
    raise exception 'INVALID_OFFER_PAGE' using errcode='P0001';
  end if;
  return jsonb_build_object(
    'promos', coalesce((select jsonb_agg(to_jsonb(p) || jsonb_build_object(
      'approved_uses',(select count(*) from public.subscription_purchases s where s.promo_id=p.id and s.status='approved'),
      'reserved_uses',(select count(*) from public.subscription_purchases s where s.promo_id=p.id and s.status in ('initiated','submitted')))
      order by p.created_at desc,p.id desc) from (select * from public.subscription_promos order by created_at desc,id desc limit 100 offset (p_promo_page * 100)) p),'[]'::jsonb),
    'promos_has_more', p_promo_page < 10000 and exists(select 1 from public.subscription_promos offset ((p_promo_page + 1) * 100) limit 1),
    'announcements', coalesce((select jsonb_agg(to_jsonb(a) || jsonb_build_object('promo_code',p.code) order by a.created_at desc,a.id desc)
      from (select * from public.subscription_announcements order by created_at desc,id desc limit 100 offset (p_announcement_page * 100)) a
      left join public.subscription_promos p on p.id=a.promo_id),'[]'::jsonb),
    'announcements_has_more', p_announcement_page < 10000 and exists(select 1 from public.subscription_announcements offset ((p_announcement_page + 1) * 100) limit 1)
  );
end $$;

-- Do not advertise a linked code once it is disabled, outside its window, or
-- fully reserved. Generic announcements can still be scheduled independently.
create function public.visible_subscription_announcements(p_public_only boolean) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(visible.item order by visible.created_at desc),'[]'::jsonb)
  from (
    select a.created_at,jsonb_build_object('id',a.id,'title',a.title,'message',a.message,'ends_at',a.ends_at,
      'promo',case when p.id is null then null else jsonb_build_object('code',p.code,'discount_type',p.discount_type,
        'discount_value',p.discount_value,'terms',p.terms,'ends_at',p.ends_at) end) as item
    from public.subscription_announcements a
    left join public.subscription_promos p on p.id=a.promo_id
    where a.enabled and (not coalesce(p_public_only,false) or a.public_visible)
      and (a.starts_at is null or a.starts_at <= now()) and (a.ends_at is null or a.ends_at > now())
      and (a.promo_id is null or (p.enabled and (p.starts_at is null or p.starts_at <= now()) and (p.ends_at is null or p.ends_at > now())
        and (p.max_uses is null or (select count(*) from public.subscription_purchases s where s.promo_id=p.id and s.status in ('initiated','submitted','approved')) < p.max_uses)))
    order by a.created_at desc limit 100
  ) visible;
$$;

-- Internal quote helper. The public RPC checks the owner; the purchase RPC
-- holds locks before re-evaluating this helper, so its preview is not a promise.
create function public.subscription_offer_quote_internal(p_shop_id uuid, p_term text, p_code text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_plan public.subscription_plan%rowtype; v_promo public.subscription_promos%rowtype; v_code text;
  v_base integer; v_reference integer; v_discount integer := 0; v_uses bigint; v_shop_uses bigint; v_months integer;
  v_access_expires_at timestamptz;
begin
  if p_term not in ('monthly','six_months','yearly') or p_term is null then raise exception 'INVALID_TERM' using errcode='P0001'; end if;
  select * into v_plan from public.subscription_plan where id=true;
  v_base := case p_term when 'monthly' then v_plan.monthly_paise when 'six_months' then v_plan.six_months_paise else v_plan.yearly_paise end;
  if v_base is null then raise exception 'SUBSCRIPTION_NOT_CONFIGURED' using errcode='P0001'; end if;
  v_months := case p_term when 'monthly' then 1 when 'six_months' then 6 else 12 end;
  v_reference := case when v_plan.monthly_paise is null then null else v_plan.monthly_paise * v_months end;
  v_code := nullif(upper(trim(coalesce(p_code,''))),'');
  if v_code is not null then
    select * into v_promo from public.subscription_promos where code=v_code;
    if not found or not v_promo.enabled or (v_promo.starts_at is not null and v_promo.starts_at > clock_timestamp()) or
      (v_promo.ends_at is not null and v_promo.ends_at <= clock_timestamp()) then raise exception 'PROMO_UNAVAILABLE' using errcode='P0001'; end if;
    if not (p_term = any(v_promo.terms)) then raise exception 'PROMO_TERM_INELIGIBLE' using errcode='P0001'; end if;
    select count(*),count(*) filter (where shop_id=p_shop_id) into v_uses,v_shop_uses from public.subscription_purchases
      where promo_id=v_promo.id and status in ('initiated','submitted','approved');
    if (v_promo.max_uses is not null and v_uses >= v_promo.max_uses) or
       (v_promo.max_uses_per_shop is not null and v_shop_uses >= v_promo.max_uses_per_shop) then raise exception 'PROMO_LIMIT_REACHED' using errcode='P0001'; end if;
    -- Round percentage discounts down to whole paise. A percentage below
    -- 100 can therefore never become a free purchase just through rounding.
    v_discount := case v_promo.discount_type when 'percent' then ((v_base::bigint * v_promo.discount_value) / 100)::integer
      else least(v_base,v_promo.discount_value) end;
    if v_discount = 0 then raise exception 'PROMO_TOO_SMALL' using errcode='P0001'; end if;
  end if;
  -- A confirmed free term changes this value. A second tab/device using an
  -- older quote must review the new access period before extending it again,
  -- even when it generated a different request key for an unlimited code.
  select expires_at into v_access_expires_at from public.shop_subscriptions where shop_id=p_shop_id;
  return jsonb_build_object('term',p_term,'base_paise',v_base,'monthly_reference_paise',v_reference,
    'discount_paise',v_discount,'amount_paise',v_base-v_discount,'promo_code',v_code,'promo_id',v_promo.id,
    'promo_version',v_promo.version,'plan_version',v_plan.version,
    'access_expires_at',case when v_access_expires_at is null then null
      else to_char(v_access_expires_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') end);
end $$;

create function public.quote_subscription_offer(p_shop_id uuid,p_actor uuid,p_term text,p_code text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_owner uuid;
begin
  select owner_id into v_owner from public.shops where id=p_shop_id;
  if not found then raise exception 'SHOP_NOT_FOUND' using errcode='P0001'; end if;
  if v_owner is distinct from p_actor then raise exception 'OWNER_REQUIRED' using errcode='P0001'; end if;
  return public.subscription_offer_quote_internal(p_shop_id,p_term,p_code);
end $$;

create function public.start_subscription_purchase_with_offer(p_shop_id uuid,p_actor uuid,p_term text,p_code text,p_request_key uuid,p_expected_quote jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_owner uuid; v_purchase public.subscription_purchases%rowtype; v_sub public.shop_subscriptions%rowtype;
  v_plan public.subscription_plan%rowtype; v_quote jsonb; v_code text := nullif(upper(trim(coalesce(p_code,''))),'');
  v_anchor timestamptz; v_start timestamptz; v_end timestamptz; v_now timestamptz; v_months integer; v_amount integer;
begin
  -- The lock-then-count protocol relies on a fresh statement snapshot after
  -- waiting. Fail closed if a caller changes PostgreSQL's default isolation.
  if current_setting('transaction_isolation') <> 'read committed' then raise exception 'SUBSCRIPTION_ISOLATION_UNSUPPORTED' using errcode='P0001'; end if;
  select owner_id into v_owner from public.shops where id=p_shop_id for update;
  if not found then raise exception 'SHOP_NOT_FOUND' using errcode='P0001'; end if;
  if v_owner is distinct from p_actor then raise exception 'OWNER_REQUIRED' using errcode='P0001'; end if;
  if p_request_key is null then raise exception 'REQUEST_KEY_REQUIRED' using errcode='P0001'; end if;
  select * into v_purchase from public.subscription_purchases where shop_id=p_shop_id and request_key=p_request_key;
  if found then
    -- The original response may have been lost. Always return that outcome,
    -- even if the owner has since selected a different term or code; never
    -- create a second purchase under an unresolved idempotency key.
    return jsonb_build_object('purchase',to_jsonb(v_purchase),'existing',true,
      'different_selection',(v_purchase.term is distinct from p_term or v_purchase.promo_code is distinct from v_code));
  end if;
  select * into v_purchase from public.subscription_purchases where shop_id=p_shop_id and status in ('initiated','submitted') for update;
  if found then return jsonb_build_object('purchase',to_jsonb(v_purchase),'existing',true); end if;
  if exists(select 1 from public.shop_subscriptions where shop_id=p_shop_id and is_permanent) then raise exception 'PERMANENT_ACCESS' using errcode='P0001'; end if;
  -- Plan and code edits serialize with purchase creation. All starts for the
  -- same code lock this row, making both global and per-shop caps atomic.
  select * into v_plan from public.subscription_plan where id=true for share;
  if v_code is not null then perform 1 from public.subscription_promos where code=v_code for update; end if;
  v_quote := public.subscription_offer_quote_internal(p_shop_id,p_term,v_code);
  if v_quote is distinct from p_expected_quote then raise exception 'SUBSCRIPTION_QUOTE_CHANGED' using errcode='P0001'; end if;
  v_amount := (v_quote->>'amount_paise')::integer;
  if v_amount > 0 then
    if v_plan.upi_id is null or v_plan.payee_name is null then raise exception 'SUBSCRIPTION_NOT_CONFIGURED' using errcode='P0001'; end if;
    insert into public.subscription_purchases(shop_id,requested_by,term,amount_paise,upi_id,payee_name,base_amount_paise,monthly_reference_paise,discount_paise,promo_id,promo_code,request_key)
      values(p_shop_id,p_actor,p_term,v_amount,v_plan.upi_id,v_plan.payee_name,(v_quote->>'base_paise')::integer,
        (v_quote->>'monthly_reference_paise')::integer,(v_quote->>'discount_paise')::integer,(v_quote->>'promo_id')::uuid,v_code,p_request_key) returning * into v_purchase;
    insert into public.subscription_events(shop_id,purchase_id,actor_id,event) values(p_shop_id,v_purchase.id,p_actor,'purchase_started');
  else
    if v_code is null then raise exception 'INVALID_PROMO' using errcode='P0001'; end if;
    select * into v_sub from public.shop_subscriptions where shop_id=p_shop_id for update;
    v_now := clock_timestamp();
    v_anchor := greatest(v_now,coalesce(v_sub.expires_at,v_now));
    v_start := case when v_sub.expires_at > v_now then v_sub.started_at else v_now end;
    v_months := case p_term when 'monthly' then 1 when 'six_months' then 6 else 12 end;
    v_end := ((v_anchor at time zone 'Asia/Kolkata') + make_interval(months => v_months)) at time zone 'Asia/Kolkata';
    insert into public.shop_subscriptions(shop_id,term,started_at,expires_at,updated_at) values(p_shop_id,p_term,v_start,v_end,v_now)
      on conflict(shop_id) do update set term=excluded.term,started_at=excluded.started_at,expires_at=excluded.expires_at,updated_at=v_now;
    insert into public.subscription_purchases(shop_id,requested_by,term,amount_paise,upi_id,payee_name,status,reviewed_at,period_start,period_end,
      base_amount_paise,monthly_reference_paise,discount_paise,promo_id,promo_code,request_key)
      values(p_shop_id,p_actor,p_term,0,null,null,'approved',v_now,v_anchor,v_end,(v_quote->>'base_paise')::integer,
        (v_quote->>'monthly_reference_paise')::integer,(v_quote->>'discount_paise')::integer,(v_quote->>'promo_id')::uuid,v_code,p_request_key) returning * into v_purchase;
    insert into public.subscription_events(shop_id,purchase_id,actor_id,event) values(p_shop_id,v_purchase.id,p_actor,'promo_free_activated');
  end if;
  return jsonb_build_object('purchase',to_jsonb(v_purchase),'existing',false);
end $$;

revoke all on function public.save_subscription_promo(uuid,uuid,bigint,jsonb) from public, anon, authenticated;
revoke all on function public.save_subscription_announcement(uuid,uuid,bigint,jsonb) from public, anon, authenticated;
revoke all on function public.admin_subscription_offers(uuid,integer,integer) from public, anon, authenticated;
revoke all on function public.visible_subscription_announcements(boolean) from public, anon, authenticated;
revoke all on function public.subscription_offer_quote_internal(uuid,text,text) from public, anon, authenticated, service_role;
revoke all on function public.quote_subscription_offer(uuid,uuid,text,text) from public, anon, authenticated;
revoke all on function public.start_subscription_purchase_with_offer(uuid,uuid,text,text,uuid,jsonb) from public, anon, authenticated;
grant execute on function public.save_subscription_promo(uuid,uuid,bigint,jsonb) to service_role;
grant execute on function public.save_subscription_announcement(uuid,uuid,bigint,jsonb) to service_role;
grant execute on function public.admin_subscription_offers(uuid,integer,integer) to service_role;
grant execute on function public.visible_subscription_announcements(boolean) to service_role;
grant execute on function public.quote_subscription_offer(uuid,uuid,text,text) to service_role;
grant execute on function public.start_subscription_purchase_with_offer(uuid,uuid,text,text,uuid,jsonb) to service_role;
notify pgrst, 'reload schema';
