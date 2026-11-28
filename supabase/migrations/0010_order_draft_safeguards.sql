-- Serialize draft mutations and checkout. Storage and Postgres are separate
-- services: tombstones make a removed path permanently ineligible for re-use,
-- even when a delayed finalize races a removal. Failed storage cleanup remains
-- recorded so an operator can retry it; it is not an automatic retention job.

alter table public.orders add column if not exists draft_version bigint not null default 0;
alter table public.orders add column if not exists checkout_quote_token text;

create table if not exists public.order_file_tombstones (
  storage_path text primary key,
  order_id uuid not null references public.orders(id) on delete cascade,
  file_id uuid not null,
  created_at timestamptz not null default now(),
  cleaned_at timestamptz
);
create index if not exists order_file_tombstones_file on public.order_file_tombstones(order_id, file_id);
alter table public.order_file_tombstones enable row level security;
revoke all on public.order_file_tombstones from public, anon, authenticated;
grant select, insert, update, delete on public.order_file_tombstones to service_role;

-- Draft capabilities are checked by the application, not by a guessable order
-- UUID. Do not permit direct PostgREST mutations that bypass those checks.
revoke insert, update, delete on public.order_items from public, anon, authenticated;
revoke insert, update, delete on public.order_files from public, anon, authenticated;

create or replace function public.valid_order_file_path(p_shop uuid, p_order uuid, p_file uuid, p_path text)
returns boolean language sql immutable set search_path = public, pg_temp as $$
  select p_path is not null and length(p_path) <= 500
    and left(p_path, length(p_shop::text || '/' || p_order::text || '/' || p_file::text || '-')) =
        p_shop::text || '/' || p_order::text || '/' || p_file::text || '-'
    and length(p_path) > length(p_shop::text || '/' || p_order::text || '/' || p_file::text || '-')
    and position('/' in substr(p_path, length(p_shop::text || '/' || p_order::text || '/' || p_file::text || '-') + 1)) = 0
$$;

-- Every file/item write locks the order, so a checkout cannot observe a half
-- changed draft. The version also catches changes between loading and checkout.
-- This trigger covers legacy server writes as well as the RPCs below.
create or replace function public.guard_draft_rows() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_order_id uuid;
  v_status public.order_status;
  v_method public.payment_method;
begin
  if tg_op = 'DELETE' then v_order_id := old.order_id; else v_order_id := new.order_id; end if;
  if tg_op = 'UPDATE' and new.order_id is distinct from old.order_id then
    raise exception 'ORDER_MOVE_FORBIDDEN' using errcode = 'P0001';
  end if;
  select status, payment_method into v_status, v_method from public.orders where id = v_order_id for update;
  if not found then
    -- ON DELETE CASCADE after the parent order has already disappeared.
    if tg_op = 'DELETE' then return old; end if;
    raise exception 'ORDER_NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_status <> 'draft' or v_method is not null then
    raise exception 'ORDER_LOCKED' using errcode = 'P0001';
  end if;
  if tg_table_name = 'order_files' then
    if tg_op = 'INSERT' then
      if (select count(*) from public.order_files where order_id = v_order_id) >= 10 then
        raise exception 'TOO_MANY_FILES' using errcode = 'P0001';
      end if;
      if exists (select 1 from public.order_file_tombstones where storage_path = new.storage_path) then
        raise exception 'FILE_REMOVED' using errcode = 'P0001';
      end if;
    elsif tg_op = 'UPDATE' and new.storage_path is distinct from old.storage_path then
      if exists (select 1 from public.order_file_tombstones where storage_path = new.storage_path) then
        raise exception 'FILE_REMOVED' using errcode = 'P0001';
      end if;
    end if;
  end if;
  update public.orders set draft_version = draft_version + 1 where id = v_order_id;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;

drop trigger if exists guard_draft_items on public.order_items;
create trigger guard_draft_items before insert or update or delete on public.order_items
for each row execute function public.guard_draft_rows();
drop trigger if exists guard_draft_files on public.order_files;
create trigger guard_draft_files before insert or update or delete on public.order_files
for each row execute function public.guard_draft_rows();

-- Rate edits use the same shop row lock that checkout uses while comparing the
-- rate snapshot, including inserts/deletes that a row lock alone would miss.
create or replace function public.lock_rate_card_shop() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_shop uuid;
begin
  if tg_op = 'DELETE' then v_shop := old.shop_id; else v_shop := new.shop_id; end if;
  if tg_op = 'UPDATE' and new.shop_id is distinct from old.shop_id then
    raise exception 'SHOP_MOVE_FORBIDDEN' using errcode = 'P0001';
  end if;
  perform 1 from public.shops where id = v_shop for update;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;
drop trigger if exists lock_rate_card_shop on public.rate_card;
create trigger lock_rate_card_shop before insert or update or delete on public.rate_card
for each row execute function public.lock_rate_card_shop();

-- Replacing a rate card must be one transaction: a failed insert must not
-- leave the shop without rates, and concurrent saves must not interleave.
create or replace function public.replace_shop_rate_card(p_shop_id uuid, p_rows jsonb) returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform 1 from public.shops where id = p_shop_id for update;
  if not found then raise exception 'SHOP_NOT_FOUND' using errcode = 'P0001'; end if;
  if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) not between 1 and 120 then
    raise exception 'INVALID_RATES' using errcode = 'P0001';
  end if;
  delete from public.rate_card where shop_id = p_shop_id;
  insert into public.rate_card (shop_id, service, paper_size, color, sides, paper_gsm, option, unit, price_paise)
  select p_shop_id, service, paper_size, color, sides, paper_gsm, option, unit, price_paise
  from jsonb_to_recordset(p_rows) as x(service text, paper_size public.paper_size, color public.color_mode,
    sides public.sides_mode, paper_gsm int, option text, unit text, price_paise int);
  return jsonb_array_length(p_rows);
end $$;

-- Replace all lines atomically and re-check the file bindings while holding the
-- order lock; a concurrent file removal cannot leave a paid-for missing file.
create or replace function public.replace_draft_items(p_order_id uuid, p_rows jsonb) returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_order public.orders%rowtype;
  v_row record;
  v_file record;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'ORDER_NOT_FOUND' using errcode = 'P0001'; end if;
  if v_order.status <> 'draft' or v_order.payment_method is not null then raise exception 'ORDER_LOCKED' using errcode = 'P0001'; end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 40 then raise exception 'INVALID_ITEMS' using errcode = 'P0001'; end if;
  for v_row in select * from jsonb_to_recordset(p_rows) as x(file_id uuid, service text, pages int) loop
    if v_row.file_id is null then raise exception 'FILE_REQUIRED' using errcode = 'P0001'; end if;
    select mime, page_count into v_file from public.order_files where id = v_row.file_id and order_id = p_order_id;
    if not found then raise exception 'INVALID_FILE' using errcode = 'P0001'; end if;
    if v_row.service = 'bind' then
      if v_row.pages <> 1 then raise exception 'INVALID_PAGES' using errcode = 'P0001'; end if;
    elsif v_file.mime not in ('application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
      and (v_file.page_count is null or v_row.pages is distinct from v_file.page_count) then
      raise exception 'INVALID_PAGES' using errcode = 'P0001';
    end if;
  end loop;
  delete from public.order_items where order_id = p_order_id;
  insert into public.order_items(order_id, file_id, service, paper_size, color, sides, paper_gsm, option, binding, lamination, copies, pages, unit_price_paise, line_total_paise)
  select p_order_id, file_id, service, paper_size, color, sides, paper_gsm, option, binding, lamination, copies, pages, 0, 0
  from jsonb_to_recordset(p_rows) as x(file_id uuid, service text, paper_size public.paper_size, color public.color_mode,
    sides public.sides_mode, paper_gsm int, option text, binding public.binding_type, lamination boolean, copies int, pages int);
  return jsonb_array_length(p_rows);
end $$;

-- A removal first makes its path ineligible for later finalization and removes
-- its order lines in one transaction. Storage cleanup happens afterwards; a
-- retry finds the same tombstones even if the response was lost.
create or replace function public.remove_draft_file(p_order_id uuid, p_file_id uuid, p_path text default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_order public.orders%rowtype;
  v_file public.order_files%rowtype;
  v_exists boolean;
  v_paths jsonb;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'ORDER_NOT_FOUND' using errcode = 'P0001'; end if;
  select * into v_file from public.order_files where id = p_file_id and order_id = p_order_id;
  v_exists := found;
  if v_exists then
    if v_order.status <> 'draft' or v_order.payment_method is not null then raise exception 'ORDER_LOCKED' using errcode = 'P0001'; end if;
    insert into public.order_file_tombstones(storage_path, order_id, file_id) values (v_file.storage_path, p_order_id, p_file_id)
      on conflict (storage_path) do nothing;
    delete from public.order_items where order_id = p_order_id and file_id = p_file_id;
    delete from public.order_files where id = p_file_id and order_id = p_order_id;
  end if;
  if p_path is not null then
    if not public.valid_order_file_path(v_order.shop_id, p_order_id, p_file_id, p_path) then raise exception 'INVALID_PATH' using errcode = 'P0001'; end if;
    if exists (select 1 from public.order_files where storage_path = p_path) then raise exception 'FILE_IN_USE' using errcode = 'P0001'; end if;
    insert into public.order_file_tombstones(storage_path, order_id, file_id) values (p_path, p_order_id, p_file_id)
      on conflict (storage_path) do nothing;
  end if;
  if not v_exists and not exists (select 1 from public.order_file_tombstones where order_id = p_order_id and file_id = p_file_id) then
    raise exception 'FILE_NOT_FOUND' using errcode = 'P0001';
  end if;
  select coalesce(jsonb_agg(storage_path order by created_at, storage_path), '[]'::jsonb) into v_paths
  from public.order_file_tombstones where order_id = p_order_id and file_id = p_file_id and cleaned_at is null;
  return v_paths;
end $$;

-- Mark an uncommitted upload/edit before deleting it. This is also allowed
-- after checkout, but it can never mark a path still referenced by an order.
create or replace function public.discard_order_file_object(p_order_id uuid, p_file_id uuid, p_path text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_order public.orders%rowtype;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'ORDER_NOT_FOUND' using errcode = 'P0001'; end if;
  if not public.valid_order_file_path(v_order.shop_id, p_order_id, p_file_id, p_path) then raise exception 'INVALID_PATH' using errcode = 'P0001'; end if;
  if exists (select 1 from public.order_files where storage_path = p_path) then raise exception 'FILE_IN_USE' using errcode = 'P0001'; end if;
  insert into public.order_file_tombstones(storage_path, order_id, file_id) values (p_path, p_order_id, p_file_id)
    on conflict (storage_path) do nothing;
end $$;

-- Swap the active object only if the edit is still based on the current file.
-- The old path is tombstoned before cleanup and the page count cannot change.
create or replace function public.replace_draft_file(p_order_id uuid, p_file_id uuid, p_previous_path text, p_new_path text, p_size int, p_pages int) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_order public.orders%rowtype; v_file public.order_files%rowtype;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'ORDER_NOT_FOUND' using errcode = 'P0001'; end if;
  if v_order.status <> 'draft' or v_order.payment_method is not null then raise exception 'ORDER_LOCKED' using errcode = 'P0001'; end if;
  select * into v_file from public.order_files where id = p_file_id and order_id = p_order_id;
  if not found then raise exception 'FILE_NOT_FOUND' using errcode = 'P0001'; end if;
  if v_file.storage_path = p_new_path then return jsonb_build_object('page_count', v_file.page_count, 'size', v_file.size_bytes); end if;
  if v_file.storage_path <> p_previous_path then raise exception 'STALE_EDIT' using errcode = 'P0001'; end if;
  if not public.valid_order_file_path(v_order.shop_id, p_order_id, p_file_id, p_new_path) then raise exception 'INVALID_PATH' using errcode = 'P0001'; end if;
  if v_file.page_count is distinct from p_pages then raise exception 'INVALID_PAGES' using errcode = 'P0001'; end if;
  if p_size < 1 or p_size > 26214400 then raise exception 'INVALID_SIZE' using errcode = 'P0001'; end if;
  insert into public.order_file_tombstones(storage_path, order_id, file_id) values (v_file.storage_path, p_order_id, p_file_id)
    on conflict (storage_path) do nothing;
  update public.order_files set storage_path = p_new_path, size_bytes = p_size, page_count = p_pages where id = p_file_id and order_id = p_order_id;
  return jsonb_build_object('page_count', p_pages, 'size', p_size);
end $$;

-- Serialize token allocation and catch up with already-issued tokens if a
-- counter is missing (for example, on a freshly seeded demo). Do not truncate
-- four-digit sequence numbers, and do not let browser roles advance counters.
create or replace function public.next_token(p_shop_id uuid) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_last int; v_max bigint; v_next bigint;
begin
  insert into public.shop_counters(shop_id, day, last_seq) values (p_shop_id, current_date, 0)
  on conflict (shop_id, day) do update set last_seq = shop_counters.last_seq
  returning last_seq into v_last;
  select coalesce(max(substring(token from 3)::bigint), 0) into v_max
    from public.orders where shop_id = p_shop_id and token_date = current_date
      and token ~ '^A-[0-9]{1,10}$';
  v_next := greatest(v_last::bigint, v_max) + 1;
  if v_next > 2147483647 then raise exception 'TOKEN_LIMIT_REACHED' using errcode = 'P0001'; end if;
  update public.shop_counters set last_seq = v_next::int where shop_id = p_shop_id and day = current_date;
  return 'A-' || lpad(v_next::text, greatest(3, length(v_next::text)), '0');
end $$;
revoke all on function public.next_token(uuid) from public, anon, authenticated;
grant execute on function public.next_token(uuid) to service_role;

-- Commit the prices, items, order, payment and COD event together. Only the
-- server's service role can invoke this function; all prices were calculated
-- by the server, and are compared with the current items/rates before commit.
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
  if jsonb_build_object('name', v_shop.name, 'upi_id', v_shop.upi_id, 'eta_minutes', v_shop.eta_minutes,
       'commission_bps', v_shop.commission_bps, 'rush_surcharge_bps', v_shop.rush_surcharge_bps, 'status', v_shop.status) is distinct from p_shop then
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
    commission_paise = (p_checkout->>'commission_paise')::int, payment_method = v_method::public.payment_method,
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

-- Payment state changes also take the order lock, so a retry or shop action
-- cannot partially overwrite a confirmation or create duplicate events.
create or replace function public.submit_upi_payment(p_order_id uuid, p_utr text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_order public.orders%rowtype;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'ORDER_NOT_FOUND' using errcode = 'P0001'; end if;
  if v_order.status <> 'draft' then raise exception 'ORDER_LOCKED' using errcode = 'P0001'; end if;
  if v_order.payment_method is distinct from 'upi'::public.payment_method then raise exception 'WRONG_METHOD' using errcode = 'P0001'; end if;
  if v_order.payment_status = 'submitted' then return; end if;
  if v_order.payment_status not in ('pending', 'rejected') then raise exception 'BAD_PAYMENT_STATE' using errcode = 'P0001'; end if;
  perform 1 from public.payments where order_id = p_order_id for update;
  if not found then raise exception 'PAYMENT_MISSING' using errcode = 'P0001'; end if;
  update public.orders set payment_status = 'submitted', utr = p_utr, updated_at = now() where id = p_order_id;
  update public.payments set status = 'submitted', utr = p_utr, updated_at = now() where order_id = p_order_id;
  insert into public.order_status_events(order_id, from_status, to_status, note)
    values (p_order_id, 'draft', 'draft', 'Customer marked UPI payment done' || case when p_utr is null then '' else ' (UTR ' || p_utr || ')' end);
end $$;

create or replace function public.decide_shop_upi_payment(p_order_id uuid, p_shop_id uuid, p_action text, p_actor uuid, p_utr text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_order public.orders%rowtype; v_eta int; v_token text;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'ORDER_NOT_FOUND' using errcode = 'P0001'; end if;
  if v_order.shop_id <> p_shop_id then raise exception 'WRONG_SHOP' using errcode = 'P0001'; end if;
  if v_order.status <> 'draft' or v_order.payment_method is distinct from 'upi'::public.payment_method then raise exception 'BAD_PAYMENT_STATE' using errcode = 'P0001'; end if;
  if p_action not in ('confirm', 'reject', 'report') or p_action is null then raise exception 'BAD_PAYMENT_STATE' using errcode = 'P0001'; end if;
  if p_action = 'confirm' and v_order.payment_status <> 'submitted' then raise exception 'BAD_PAYMENT_STATE' using errcode = 'P0001'; end if;
  if p_action = 'reject' and v_order.payment_status not in ('pending', 'submitted') then raise exception 'BAD_PAYMENT_STATE' using errcode = 'P0001'; end if;
  if p_action = 'report' and v_order.payment_status not in ('pending', 'rejected', 'submitted') then raise exception 'BAD_PAYMENT_STATE' using errcode = 'P0001'; end if;
  perform 1 from public.payments where order_id = p_order_id for update;
  if not found then raise exception 'PAYMENT_MISSING' using errcode = 'P0001'; end if;
  if p_action = 'report' then
    -- A shop can record a customer's claim after direct contact, for example if
    -- the customer lost their browser session. This is NOT confirmation; staff
    -- must still verify the actual transfer before the separate confirm action.
    if v_order.payment_status = 'submitted' then return jsonb_build_object('outcome', 'submitted'); end if;
    update public.orders set payment_status = 'submitted', utr = coalesce(p_utr, v_order.utr), updated_at = now() where id = p_order_id;
    update public.payments set status = 'submitted', utr = coalesce(p_utr, v_order.utr), updated_at = now() where order_id = p_order_id;
    insert into public.order_status_events(order_id, from_status, to_status, by, note)
      values (p_order_id, 'draft', 'draft', p_actor, 'Shop recorded a customer payment report; payment not yet verified');
    return jsonb_build_object('outcome', 'submitted');
  end if;
  if p_action = 'reject' then
    update public.orders set payment_status = 'rejected', updated_at = now() where id = p_order_id;
    update public.payments set status = 'rejected', updated_at = now() where order_id = p_order_id;
    insert into public.order_status_events(order_id, from_status, to_status, by, note)
      values (p_order_id, 'draft', 'draft', p_actor, 'Shop could not verify the UPI payment');
    return jsonb_build_object('outcome', 'rejected');
  end if;
  select eta_minutes into v_eta from public.shops where id = p_shop_id;
  v_token := public.next_token(p_shop_id);
  update public.orders set status = 'queued', payment_status = 'confirmed', token = v_token, token_date = current_date,
    eta_minutes = coalesce(v_eta, 20), utr = coalesce(p_utr, utr), updated_at = now() where id = p_order_id;
  update public.payments set status = 'confirmed', confirmed_by = p_actor, confirmed_at = now(),
    utr = coalesce(p_utr, utr), updated_at = now() where order_id = p_order_id;
  insert into public.order_status_events(order_id, from_status, to_status, by, note)
    values (p_order_id, 'draft', 'queued', p_actor, 'Payment confirmed by shop — token ' || v_token || ' assigned');
  return jsonb_build_object('outcome', 'confirmed', 'token', v_token);
end $$;

revoke all on function public.valid_order_file_path(uuid, uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.guard_draft_rows() from public, anon, authenticated;
revoke all on function public.lock_rate_card_shop() from public, anon, authenticated;
revoke all on function public.replace_shop_rate_card(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.replace_draft_items(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.remove_draft_file(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.discard_order_file_object(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.replace_draft_file(uuid, uuid, text, text, int, int) from public, anon, authenticated;
revoke all on function public.commit_draft_checkout(uuid, bigint, jsonb, int, jsonb, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.submit_upi_payment(uuid, text) from public, anon, authenticated;
revoke all on function public.decide_shop_upi_payment(uuid, uuid, text, uuid, text) from public, anon, authenticated;
grant execute on function public.valid_order_file_path(uuid, uuid, uuid, text) to service_role;
grant execute on function public.replace_shop_rate_card(uuid, jsonb) to service_role;
grant execute on function public.replace_draft_items(uuid, jsonb) to service_role;
grant execute on function public.remove_draft_file(uuid, uuid, text) to service_role;
grant execute on function public.discard_order_file_object(uuid, uuid, text) to service_role;
grant execute on function public.replace_draft_file(uuid, uuid, text, text, int, int) to service_role;
grant execute on function public.commit_draft_checkout(uuid, bigint, jsonb, int, jsonb, jsonb, jsonb) to service_role;
grant execute on function public.submit_upi_payment(uuid, text) to service_role;
grant execute on function public.decide_shop_upi_payment(uuid, uuid, text, uuid, text) to service_role;
