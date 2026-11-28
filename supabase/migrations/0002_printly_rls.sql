-- Printly RLS + storage policies
alter table profiles enable row level security;
alter table shops enable row level security;
alter table shop_staff enable row level security;
alter table shop_services enable row level security;
alter table rate_card enable row level security;
alter table orders enable row level security;
alter table order_items enable row level security;
alter table order_files enable row level security;
alter table order_status_events enable row level security;
alter table payments enable row level security;
alter table payouts enable row level security;
alter table inventory_items enable row level security;
alter table reviews enable row level security;
alter table disputes enable row level security;
alter table platform_settings enable row level security;
alter table shop_counters enable row level security;

-- profiles
create policy profiles_select on profiles for select using (auth.uid() = id or public.is_admin());
create policy profiles_insert on profiles for insert with check (auth.uid() = id);
create policy profiles_update on profiles for update using (auth.uid() = id or public.is_admin());

-- shops
create policy shops_select on shops for select
  using (status = 'active' or owner_id = auth.uid() or id in (select public.my_shop_ids()) or public.is_admin());
create policy shops_insert on shops for insert with check (owner_id = auth.uid());
create policy shops_update on shops for update
  using (owner_id = auth.uid() or public.is_admin())
  with check (owner_id = auth.uid() or public.is_admin());

-- shop_staff
create policy shop_staff_select on shop_staff for select
  using (user_id = auth.uid() or shop_id in (select public.my_shop_ids()) or public.is_admin());
create policy shop_staff_insert on shop_staff for insert
  with check (exists(select 1 from shops s where s.id = shop_id and s.owner_id = auth.uid()) or public.is_admin());
create policy shop_staff_update on shop_staff for update
  using (exists(select 1 from shops s where s.id = shop_id and s.owner_id = auth.uid()) or public.is_admin());
create policy shop_staff_delete on shop_staff for delete
  using (exists(select 1 from shops s where s.id = shop_id and s.owner_id = auth.uid()) or public.is_admin());

-- shop_services & rate_card: public read for active shops, staff write
create policy shop_services_select on shop_services for select
  using (exists(select 1 from shops s where s.id = shop_id and s.status = 'active')
         or shop_id in (select public.my_shop_ids()) or public.is_admin());
create policy shop_services_write on shop_services for all
  using (shop_id in (select public.my_shop_ids()) or public.is_admin())
  with check (shop_id in (select public.my_shop_ids()) or public.is_admin());

create policy rate_card_select on rate_card for select
  using (exists(select 1 from shops s where s.id = shop_id and s.status = 'active')
         or shop_id in (select public.my_shop_ids()) or public.is_admin());
create policy rate_card_write on rate_card for all
  using (shop_id in (select public.my_shop_ids()) or public.is_admin())
  with check (shop_id in (select public.my_shop_ids()) or public.is_admin());

-- orders: anon may only create drafts; staff/customer read; staff update
create policy orders_insert on orders for insert
  with check (status = 'draft' and payment_status = 'pending');
create policy orders_select on orders for select
  using (shop_id in (select public.my_shop_ids()) or customer_id = auth.uid() or public.is_admin());
create policy orders_update on orders for update
  using (shop_id in (select public.my_shop_ids()) or public.is_admin())
  with check (shop_id in (select public.my_shop_ids()) or public.is_admin());

-- order_items / order_files: readable by interested parties; insertable while draft
create policy order_items_select on order_items for select
  using (exists(select 1 from orders o where o.id = order_id and
    (o.shop_id in (select public.my_shop_ids()) or o.customer_id = auth.uid() or public.is_admin())));
create policy order_items_insert on order_items for insert
  with check (exists(select 1 from orders o where o.id = order_id and o.status = 'draft'));
create policy order_items_update on order_items for update
  using (exists(select 1 from orders o where o.id = order_id and
    (o.shop_id in (select public.my_shop_ids()) or public.is_admin())));
create policy order_items_delete on order_items for delete
  using (exists(select 1 from orders o where o.id = order_id and o.status = 'draft'));

create policy order_files_select on order_files for select
  using (exists(select 1 from orders o where o.id = order_id and
    (o.shop_id in (select public.my_shop_ids()) or o.customer_id = auth.uid() or public.is_admin())));
create policy order_files_insert on order_files for insert
  with check (exists(select 1 from orders o where o.id = order_id and o.status = 'draft'));
create policy order_files_delete on order_files for delete
  using (exists(select 1 from orders o where o.id = order_id and o.status = 'draft'));

-- order_status_events
create policy order_status_events_select on order_status_events for select
  using (exists(select 1 from orders o where o.id = order_id and
    (o.shop_id in (select public.my_shop_ids()) or o.customer_id = auth.uid() or public.is_admin())));
create policy order_status_events_insert on order_status_events for insert
  with check (exists(select 1 from orders o where o.id = order_id and
    (o.shop_id in (select public.my_shop_ids()) or public.is_admin())) or by is null);

-- payments: shop staff + admin only (customer goes through server routes)
create policy payments_select on payments for select
  using (exists(select 1 from orders o where o.id = order_id and o.shop_id in (select public.my_shop_ids())) or public.is_admin());

-- payouts
create policy payouts_select on payouts for select
  using (shop_id in (select public.my_shop_ids()) or public.is_admin());
create policy payouts_admin_write on payouts for all
  using (public.is_admin()) with check (public.is_admin());

-- inventory_items
create policy inventory_all on inventory_items for all
  using (shop_id in (select public.my_shop_ids()) or public.is_admin())
  with check (shop_id in (select public.my_shop_ids()) or public.is_admin());

-- reviews: public read, anyone may rate an order (order ids are unguessable)
create policy reviews_select on reviews for select using (true);
create policy reviews_insert on reviews for insert with check (true);

-- disputes
create policy disputes_insert on disputes for insert with check (true);
create policy disputes_select on disputes for select
  using (exists(select 1 from orders o where o.id = order_id and o.shop_id in (select public.my_shop_ids()))
         or raised_by = auth.uid() or public.is_admin());
create policy disputes_update on disputes for update
  using (exists(select 1 from orders o where o.id = order_id and o.shop_id in (select public.my_shop_ids()))
         or public.is_admin());

-- platform_settings: read for staff/admin, write admin
create policy settings_select on platform_settings for select
  using (public.is_admin() or exists(select 1 from shop_staff where user_id = auth.uid()));
create policy settings_admin_write on platform_settings for all
  using (public.is_admin()) with check (public.is_admin());

-- shop_counters: no direct access (service role / security definer only)

-- storage bucket for order files (private)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('order-files', 'order-files', false, 26214400,
        array['application/pdf','image/jpeg','image/png','application/msword',
              'application/vnd.openxmlformats-officedocument.wordprocessingml.document'])
on conflict (id) do nothing;

create policy order_files_storage_read on storage.objects for select
  using (bucket_id = 'order-files' and (
    (storage.foldername(name))[1] in (select shop_id::text from shop_staff where user_id = auth.uid())
    or public.is_admin()
  ));
