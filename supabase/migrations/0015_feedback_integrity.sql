-- One active report per order prevents a leaked link or accidental retries
-- from filling the support queue. Do not delete pre-existing reports: if a
-- deployment already has duplicates, resolve them before applying this index.
create unique index if not exists disputes_one_active_per_order on public.disputes (order_id)
  where status in ('open', 'investigating');

-- Calculate from all rows in the database, not PostgREST's capped result set.
-- The shop row is locked before this BEFORE UPDATE trigger executes, so
-- concurrent review changes for a shop serialize their aggregate updates.
create index if not exists reviews_shop_id_idx on public.reviews (shop_id);

create or replace function public.recalculate_shop_rating() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  select count(*)::integer, coalesce(round(avg(rating)::numeric, 1), 0)
    into new.rating_count, new.rating_avg from public.reviews where shop_id = new.id;
  return new;
end
$$;
revoke all on function public.recalculate_shop_rating() from public, anon, authenticated;
drop trigger if exists calculate_shop_rating on public.shops;
create trigger calculate_shop_rating before update of rating_count, rating_avg on public.shops
  for each row execute function public.recalculate_shop_rating();

create or replace function public.refresh_review_shop_rating() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_shop uuid;
  v_old_shop uuid;
  v_new_shop uuid;
begin
  if tg_op <> 'INSERT' then v_old_shop := old.shop_id; end if;
  if tg_op <> 'DELETE' then v_new_shop := new.shop_id; end if;
  -- Consistent lock order also covers moving a review between shops.
  for v_shop in
    select id from public.shops where id = v_old_shop or id = v_new_shop order by id
  loop
    update public.shops set rating_count = rating_count, rating_avg = rating_avg where id = v_shop;
  end loop;
  return null;
end
$$;
revoke all on function public.refresh_review_shop_rating() from public, anon, authenticated;
drop trigger if exists refresh_review_shop_rating on public.reviews;
create trigger refresh_review_shop_rating after insert or update of rating, shop_id or delete on public.reviews
  for each row execute function public.refresh_review_shop_rating();

-- Preserve the prior display totals before recomputing; a historic aggregate
-- may refer to reviews that were removed or imported outside this database.
-- This small snapshot is not a substitute for an independent backup.
create table if not exists public.pre_0015_shop_ratings (
  shop_id uuid primary key,
  rating_avg numeric(2,1) not null,
  rating_count integer not null,
  captured_at timestamptz not null default now()
);
alter table public.pre_0015_shop_ratings enable row level security;
revoke all on public.pre_0015_shop_ratings from public, anon, authenticated;
grant select on public.pre_0015_shop_ratings to service_role;
insert into public.pre_0015_shop_ratings (shop_id, rating_avg, rating_count)
  select id, rating_avg, rating_count from public.shops on conflict (shop_id) do nothing;

-- Correct previously stale aggregates without altering individual reviews.
update public.shops set rating_count = rating_count, rating_avg = rating_avg;
