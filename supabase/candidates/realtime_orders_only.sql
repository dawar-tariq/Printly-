-- Explicit production-target candidate: fail if the publication changed since
-- inventory; preserve orders and its existing filter/columns. This removes
-- notifications, not rows, from the other 16 tables. Unknown external Realtime
-- consumers can be affected; restoring tables does not restore missed events.
do $$
declare actual text[];
expected text[] := array['public.order_file_tombstones','public.order_files','public.order_items','public.order_status_events','public.orders','public.payments','public.platform_settings','public.profiles','public.security_rate_limits','public.shop_counters','public.shop_onboarding','public.shop_staff','public.shops','public.subscription_announcements','public.subscription_purchases','public.support_messages','public.support_tickets'];
begin
  if not exists (select 1 from pg_catalog.pg_publication where pubname='supabase_realtime' and not puballtables and pubinsert and pubupdate and not pubdelete and pubtruncate) then
    raise exception 'PUBLICATION_FLAGS_MISMATCH';
  end if;
  select array_agg(schemaname || '.' || tablename order by schemaname, tablename) into actual
    from pg_catalog.pg_publication_tables where pubname='supabase_realtime';
  if actual is distinct from expected then raise exception 'PUBLICATION_TABLES_MISMATCH'; end if;
  if exists (select 1 from pg_catalog.pg_publication_tables where pubname='supabase_realtime' and rowfilter is not null) then
    raise exception 'PUBLICATION_ROW_FILTERS_MISMATCH';
  end if;
  alter publication supabase_realtime drop table public.order_file_tombstones, public.order_files,
    public.order_items, public.order_status_events, public.payments, public.platform_settings,
    public.profiles, public.security_rate_limits, public.shop_counters, public.shop_onboarding,
    public.shop_staff, public.shops, public.subscription_announcements, public.subscription_purchases,
    public.support_messages, public.support_tickets;
end $$;
