-- Public shop pages only need directory information. RLS controls which rows
-- are visible, but it does not hide private columns on otherwise public rows.
-- Owners continue to receive their own full shop details through authorized
-- server routes; anon/authenticated direct queries only get this allowlist.
revoke select on public.shops from public, anon, authenticated;
revoke select (id, owner_id, slug, short_code, name, address, city, phone, gstin, upi_id,
               kyc_status, status, commission_bps, rush_surcharge_bps, eta_minutes,
               rating_avg, rating_count, created_at, updated_at)
  on public.shops from public, anon, authenticated;
grant select (id, slug, short_code, name, address, city, phone, upi_id, status,
              eta_minutes, rating_avg, rating_count)
  on public.shops to anon, authenticated;

-- These policies previously queried the now-private owner_id column as the
-- caller. Expose only an ownership boolean, not the owner's identifier.
create or replace function public.is_shop_owner(p_shop_id uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.shops where id = p_shop_id and owner_id = auth.uid())
$$;
revoke all on function public.is_shop_owner(uuid) from public;
grant execute on function public.is_shop_owner(uuid) to anon, authenticated, service_role;

drop policy if exists shop_onboarding_select on public.shop_onboarding;
create policy shop_onboarding_select on public.shop_onboarding for select
  using (public.is_shop_owner(shop_id) or public.is_admin());

drop policy if exists shop_staff_insert on public.shop_staff;
create policy shop_staff_insert on public.shop_staff for insert
  with check (public.is_shop_owner(shop_id) or public.is_admin());
drop policy if exists shop_staff_update on public.shop_staff;
create policy shop_staff_update on public.shop_staff for update
  using (public.is_shop_owner(shop_id) or public.is_admin())
  with check (public.is_shop_owner(shop_id) or public.is_admin());
drop policy if exists shop_staff_delete on public.shop_staff;
create policy shop_staff_delete on public.shop_staff for delete
  using (public.is_shop_owner(shop_id) or public.is_admin());

-- TRUNCATE bypasses row-level security. These DDL privileges are not needed by
-- the browser roles on any of the application's tables.
revoke truncate, references, trigger on all tables in schema public from public, anon, authenticated;
