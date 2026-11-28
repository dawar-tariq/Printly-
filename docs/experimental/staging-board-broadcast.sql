-- STAGING REHEARSAL ARTIFACT ONLY. NOT A PRODUCTION MIGRATION.
-- This prototype was installed in the isolated synthetic staging project; the
-- production application does not subscribe to it. Review authorization,
-- revocation, availability, load and a coordinated rollout before any use.
-- Do not add the orders table to the Realtime publication: DELETE events cannot
-- be RLS filtered and an order ID is also the customer's tracking identifier.
--
-- Supabase Realtime injects a random message ID into the otherwise empty payload.
-- The signal is advisory; it is not an order event stream or a replacement for
-- a privacy-checked board fetch and the polling fallback.

create policy printly_shop_board_broadcast_read on realtime.messages
  for select to authenticated
  using (
    extension = 'broadcast'
    and topic = (select realtime.topic())
    and exists (
      select 1 from public.my_shop_ids() as member(shop_id)
      where (select realtime.topic()) = 'printly-shop-board:' || member.shop_id::text
        and public.shop_subscription_active(member.shop_id)
    )
  );

create function public.notify_shop_board_change()
returns trigger language plpgsql security definer
set search_path = pg_catalog, public as $$
begin
  -- Do not include an order ID or customer data. A failure must not reject an
  -- order or status change; clients must continue to poll.
  begin
    if tg_op = 'DELETE' then
      perform realtime.send('{}'::jsonb, 'changed', 'printly-shop-board:' || old.shop_id::text, true);
    else
      perform realtime.send('{}'::jsonb, 'changed', 'printly-shop-board:' || new.shop_id::text, true);
      if tg_op = 'UPDATE' and old.shop_id is distinct from new.shop_id then
        perform realtime.send('{}'::jsonb, 'changed', 'printly-shop-board:' || old.shop_id::text, true);
      end if;
    end if;
  exception when others then
    raise warning 'Printly order-board broadcast unavailable; polling remains enabled';
  end;
  return null;
end
$$;
revoke all on function public.notify_shop_board_change() from public, anon, authenticated;

create trigger printly_notify_shop_board_change
  after insert or update or delete on public.orders
  for each row execute function public.notify_shop_board_change();

-- If the experimental objects are no longer needed, an authorized operator can
-- remove only these objects from the staging project, in this order:
-- drop trigger if exists printly_notify_shop_board_change on public.orders;
-- drop function if exists public.notify_shop_board_change();
-- drop policy if exists printly_shop_board_broadcast_read on realtime.messages;
