-- Matching references are only a warning, never proof of payment. Staff must
-- independently check the receiving account and can explicitly override a
-- possible duplicate after investigating it.
create index if not exists orders_shop_upi_reference on public.orders
  (shop_id, upper(regexp_replace(btrim(utr), '[[:space:]-]', '', 'g')))
  where payment_method = 'upi' and utr is not null;

create function public.decide_shop_upi_payment_checked(
  p_order_id uuid, p_shop_id uuid, p_action text, p_actor uuid, p_utr text, p_acknowledge_duplicate boolean
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_order public.orders%rowtype;
  v_reference text;
  v_count bigint;
  v_duplicates jsonb;
  v_result jsonb;
begin
  if p_action <> 'confirm' then
    return public.decide_shop_upi_payment(p_order_id, p_shop_id, p_action, p_actor, p_utr);
  end if;
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'ORDER_NOT_FOUND' using errcode = 'P0001'; end if;
  if v_order.shop_id <> p_shop_id then raise exception 'WRONG_SHOP' using errcode = 'P0001'; end if;
  if v_order.status <> 'draft' or v_order.payment_method is distinct from 'upi'::public.payment_method
     or v_order.payment_status <> 'submitted' then raise exception 'BAD_PAYMENT_STATE' using errcode = 'P0001'; end if;
  v_reference := upper(regexp_replace(btrim(coalesce(p_utr, v_order.utr, '')), '[[:space:]-]', '', 'g'));
  if v_reference <> '' then
    -- Serialize confirmations for the same shop/reference. A customer report
    -- may still arrive later, so this is advisory, not a uniqueness guarantee.
    perform pg_advisory_xact_lock(hashtext(p_shop_id::text), hashtext(v_reference));
    select count(*) into v_count from public.orders
      where shop_id = p_shop_id and id <> p_order_id and payment_method = 'upi' and utr is not null
        and upper(regexp_replace(btrim(utr), '[[:space:]-]', '', 'g')) = v_reference;
    if v_count > 0 and not coalesce(p_acknowledge_duplicate, false) then
      select coalesce(jsonb_agg(to_jsonb(matches)), '[]'::jsonb) into v_duplicates from (
        select id, token, payment_status, total_paise, created_at from public.orders
        where shop_id = p_shop_id and id <> p_order_id and payment_method = 'upi' and utr is not null
          and upper(regexp_replace(btrim(utr), '[[:space:]-]', '', 'g')) = v_reference
        order by created_at desc, id desc limit 5
      ) matches;
      return jsonb_build_object('outcome', 'possible_duplicate', 'duplicate_count', v_count, 'duplicates', v_duplicates);
    end if;
  end if;
  v_result := public.decide_shop_upi_payment(p_order_id, p_shop_id, p_action, p_actor, p_utr);
  if coalesce(v_count, 0) > 0 and coalesce(p_acknowledge_duplicate, false) then
    insert into public.order_status_events(order_id, from_status, to_status, by, note)
      values (p_order_id, 'queued', 'queued', p_actor, 'Staff acknowledged a possible duplicate reference after checking the transfer');
  end if;
  return v_result;
end
$$;
revoke all on function public.decide_shop_upi_payment_checked(uuid,uuid,text,uuid,text,boolean) from public, anon, authenticated;
grant execute on function public.decide_shop_upi_payment_checked(uuid,uuid,text,uuid,text,boolean) to service_role;
