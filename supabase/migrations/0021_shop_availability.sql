-- The owner's temporary opening switch is independent of approval and subscription.
-- Existing shops remain open; administrative status/entitlement still applies.
alter table public.shops add column is_open boolean not null default true;
grant select (is_open) on public.shops to anon, authenticated;

-- Only the server can invoke this function. Checking ownership in the same
-- locked transaction as the change prevents a stale membership/owner check.
create function public.set_shop_open(p_shop_id uuid, p_actor_id uuid, p_is_open boolean)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
declare v_owner uuid;
begin
  if p_shop_id is null or p_actor_id is null or p_is_open is null then
    raise exception 'INVALID_AVAILABILITY' using errcode = 'P0001';
  end if;
  select owner_id into v_owner from public.shops where id = p_shop_id for update;
  if not found or v_owner is distinct from p_actor_id then
    raise exception 'SHOP_OWNER_REQUIRED' using errcode = 'P0001';
  end if;
  update public.shops set is_open = p_is_open where id = p_shop_id;
  return p_is_open;
end $$;
revoke all on function public.set_shop_open(uuid, uuid, boolean) from public, anon, authenticated;
grant execute on function public.set_shop_open(uuid, uuid, boolean) to service_role;

-- Serialize every new order insert and a draft's first checkout transition
-- with closing/reopening the same shop. This also protects older app versions
-- and direct privileged writes, not just the current UI. Once checkout has
-- started, UPI submission/recovery and management of placed orders remain
-- possible while closed. The checkout transaction already locks order -> shop;
-- preserve that order here to avoid introducing a deadlock.
create function public.guard_shop_open_for_order() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_is_open boolean;
begin
  if tg_op = 'INSERT' then
    select is_open into v_is_open from public.shops where id = new.shop_id for update;
    if not found or v_is_open is not true then raise exception 'SHOP_CLOSED' using errcode = 'P0001'; end if;
  elsif old.status = 'draft' and old.payment_method is null and
    (new.payment_method is not null or new.status in ('queued', 'printing', 'ready', 'collected')) then
    select is_open into v_is_open from public.shops where id = new.shop_id for update;
    if not found or v_is_open is not true then raise exception 'SHOP_CLOSED' using errcode = 'P0001'; end if;
  end if;
  return new;
end $$;
create trigger guard_shop_open_for_order before insert or update on public.orders
  for each row execute function public.guard_shop_open_for_order();
revoke all on function public.guard_shop_open_for_order() from public, anon, authenticated;
notify pgrst, 'reload schema';
