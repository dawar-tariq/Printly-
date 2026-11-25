-- Enable the existing authenticated owner subscriptions without weakening
-- orders RLS. Publication events contain order rows, so only authorized shop
-- members may receive them; clients subscribe to INSERT/UPDATE, not DELETE.
-- Existing polling remains the fallback if Realtime is unavailable.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
    and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime'
      and schemaname = 'public' and tablename = 'orders') then
    alter publication supabase_realtime add table public.orders;
  end if;
end $$;

-- Customers don't have accounts. A public topic derived from their unguessable
-- tracking ID carries only an empty invalidation, never an order, customer,
-- payment, file or tracking ID. The page ignores event data and re-fetches the
-- existing rate-limited tracking API. Anyone who knows the topic can forge a
-- hint, so the client also throttles them. No broad anonymous orders policy is
-- added. Realtime failures must never prevent an order/payment write.
create or replace function public.broadcast_order_tracking_change() returns trigger
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
begin
  if row(new.status, new.payment_status, new.payment_method, new.token, new.eta_minutes, new.ready_at, new.collected_at)
    is not distinct from row(old.status, old.payment_status, old.payment_method, old.token, old.eta_minutes, old.ready_at, old.collected_at) then
    return null;
  end if;
  perform realtime.send('{}'::jsonb, 'changed',
    'printly-track:' || encode(sha256(convert_to(lower(new.id::text), 'UTF8')), 'hex'), false);
  return null;
exception when others then
  raise warning 'Could not send an order tracking invalidation';
  return null;
end $$;
revoke all on function public.broadcast_order_tracking_change() from public, anon, authenticated;
drop trigger if exists broadcast_order_tracking_change on public.orders;
create trigger broadcast_order_tracking_change
after update of status, payment_status, payment_method, token, eta_minutes, ready_at, collected_at on public.orders
for each row execute function public.broadcast_order_tracking_change();
