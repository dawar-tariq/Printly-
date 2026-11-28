-- Explicit, one-time 30-day pilot chosen by an administrator. No shop receives
-- access merely by installing this migration. Existing entitlements are never
-- shortened or overwritten while active.
create table public.shop_pilot_grants (
  shop_id uuid primary key references public.shops(id),
  granted_by uuid not null references public.profiles(id),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  check (ends_at = starts_at + interval '30 days')
);
alter table public.shop_pilot_grants enable row level security;
revoke all on public.shop_pilot_grants from public, anon, authenticated, service_role;
grant select on public.shop_pilot_grants to service_role;

create function public.grant_shop_pilot(p_shop_id uuid,p_actor uuid) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare existing public.shop_pilot_grants%rowtype; sub public.shop_subscriptions%rowtype; started timestamptz;
begin
  if not exists(select 1 from public.profiles where id=p_actor and role='admin') then
    raise exception 'ADMIN_REQUIRED' using errcode='P0001';
  end if;
  perform 1 from public.shops where id=p_shop_id for update;
  if not found then raise exception 'SHOP_NOT_FOUND' using errcode='P0001'; end if;
  select * into existing from public.shop_pilot_grants where shop_id=p_shop_id;
  if found then return jsonb_build_object('already_granted',true,'starts_at',existing.starts_at,'ends_at',existing.ends_at); end if;
  insert into public.shop_subscriptions(shop_id) values(p_shop_id) on conflict(shop_id) do nothing;
  select * into sub from public.shop_subscriptions where shop_id=p_shop_id for update;
  started := clock_timestamp();
  if sub.is_permanent or sub.expires_at > started then raise exception 'PILOT_ACTIVE_ACCESS' using errcode='P0001'; end if;
  update public.shop_subscriptions set term='grace',started_at=started,expires_at=started+interval '30 days',updated_at=started where shop_id=p_shop_id;
  insert into public.shop_pilot_grants(shop_id,granted_by,starts_at,ends_at) values(p_shop_id,p_actor,started,started+interval '30 days');
  insert into public.subscription_events(shop_id,actor_id,event,note) values(p_shop_id,p_actor,'pilot_30_day_granted','Free 30-day pilot activated by admin');
  return jsonb_build_object('already_granted',false,'starts_at',started,'ends_at',started+interval '30 days');
end $$;
revoke all on function public.grant_shop_pilot(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.grant_shop_pilot(uuid,uuid) to service_role;
notify pgrst,'reload schema';
