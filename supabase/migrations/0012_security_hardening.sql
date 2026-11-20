-- Keep privileged application data behind the server routes. In particular,
-- review rows contain order IDs: those IDs are bearer links for order tracking.
-- The public shop page only needs the aggregate rating stored on the shop.
revoke all on public.reviews from public, anon, authenticated;
drop policy if exists reviews_select on public.reviews;
drop policy if exists reviews_insert on public.reviews;

-- Disputes must be created and resolved by validated server routes. The old
-- INSERT policy allowed callers to choose arbitrary fields including status.
revoke insert, update, delete on public.disputes from public, anon, authenticated;
drop policy if exists disputes_insert on public.disputes;

-- These writes already go through service-role routes; remove latent grants
-- even where the current row policies happen to deny a client operation.
revoke insert, update, delete on public.platform_settings, public.shop_onboarding
  from public, anon, authenticated;
revoke all on public.shop_counters from public, anon, authenticated;

-- The application tracking endpoint invokes this function with the service
-- role. Prevent direct RPC access from bypassing its HTTP protections.
revoke all on function public.get_order_track(uuid) from public, anon, authenticated;
grant execute on function public.get_order_track(uuid) to service_role;
grant select, insert, update, delete on public.reviews, public.disputes,
  public.platform_settings, public.shop_onboarding, public.shop_counters to service_role;
