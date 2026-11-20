-- Shop public identity, duplicate-name review, and tenant isolation.
-- Existing slugs are retained as aliases; the application shares short_code URLs.

alter table public.shop_onboarding
  add column if not exists duplicate_name boolean not null default false,
  add column if not exists name_proof_type text check (name_proof_type in ('gstin', 'photo')),
  add column if not exists name_proof_gstin text,
  add column if not exists name_proof_photo_path text,
  add column if not exists name_proof_submitted_at timestamptz;

-- The bucket is private: only the server's service role can upload/read evidence.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('shop-name-proofs', 'shop-name-proofs', false, 3145728,
        array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

-- A shop user must not be able to promote themselves to admin, create/approve
-- their own shop, change its code, or bypass name review through PostgREST.
-- The application writes these records through authorized server routes.
revoke insert, update, delete on public.profiles from public, anon, authenticated;
grant update (full_name, phone) on public.profiles to authenticated;
revoke insert, update, delete on public.shops from public, anon, authenticated;

create or replace function public.normalized_shop_name(p_name text) returns text
language sql immutable parallel safe set search_path = public, pg_temp as $$
  select lower(regexp_replace(btrim(coalesce(p_name, '')), '[[:space:]]+', ' ', 'g'))
$$;
create index if not exists shops_normalized_name_idx on public.shops (public.normalized_shop_name(name));

create or replace function public.shop_name_exists(p_name text, p_exclude uuid default null) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.shops
    where public.normalized_shop_name(name) = public.normalized_shop_name(p_name)
      and id is distinct from p_exclude
  )
$$;
revoke all on function public.shop_name_exists(text, uuid) from public, anon, authenticated;
grant execute on function public.shop_name_exists(text, uuid) to service_role;

-- A transaction-scoped lock serializes both signups and renames for the same
-- normalized name. The server validates the photo and stores it in the private
-- bucket first; checking its existence here prevents a made-up proof path.
create or replace function public.create_shop_application(
  p_shop jsonb, p_onboarding jsonb, p_services jsonb, p_rates jsonb,
  p_inventory jsonb, p_photo_path text default null
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_id uuid := (p_shop->>'id')::uuid;
  v_owner uuid := (p_shop->>'owner_id')::uuid;
  v_name text := btrim(p_shop->>'name');
  v_gstin text := upper(regexp_replace(coalesce(p_shop->>'gstin', ''), '[[:space:]]+', '', 'g'));
  v_duplicate boolean;
  v_valid_gstin boolean;
begin
  if length(public.normalized_shop_name(v_name)) < 2 then
    raise exception 'INVALID_SHOP_NAME' using errcode = 'P0001';
  end if;
  if p_photo_path is not null and (
    p_photo_path not like v_id::text || '/%'
    or not exists (select 1 from storage.objects where bucket_id = 'shop-name-proofs' and name = p_photo_path)
  ) then
    raise exception 'INVALID_PROOF_PHOTO' using errcode = 'P0001';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(public.normalized_shop_name(v_name), 0));
  v_duplicate := public.shop_name_exists(v_name, null);
  v_valid_gstin := v_gstin ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$';
  if v_duplicate and not v_valid_gstin and p_photo_path is null then
    raise exception 'DUPLICATE_NAME_PROOF_REQUIRED' using errcode = 'P0001';
  end if;
  perform set_config('printly.checked_shop_name', v_id::text, true);

  insert into public.shops (id, owner_id, slug, short_code, name, address, city, phone, gstin, upi_id, kyc_status, status)
  values (v_id, v_owner, p_shop->>'slug', p_shop->>'short_code', v_name,
          p_shop->>'address', p_shop->>'city', p_shop->>'phone', nullif(v_gstin, ''),
          nullif(p_shop->>'upi_id', ''), 'pending', 'paused');
  update public.profiles set role = 'shop_staff', full_name = p_shop->>'owner_name', phone = p_shop->>'phone'
    where id = v_owner;
  insert into public.shop_staff (shop_id, user_id, role) values (v_id, v_owner, 'owner');

  insert into public.shop_onboarding (
    shop_id, business_type, legal_business_name, year_established, staff_count, printer_count, avg_daily_jobs,
    printer_details, pincode, alternate_phone, registration_type, registration_number, business_hours,
    referral_source, duplicate_name, name_proof_type, name_proof_gstin, name_proof_photo_path, name_proof_submitted_at
  ) values (
    v_id, coalesce(p_onboarding->>'business_type', 'other'), nullif(p_onboarding->>'legal_business_name', ''),
    nullif(p_onboarding->>'year_established', '')::smallint, coalesce((p_onboarding->>'staff_count')::int, 1),
    coalesce((p_onboarding->>'printer_count')::int, 1), coalesce((p_onboarding->>'avg_daily_jobs')::int, 0),
    coalesce(p_onboarding->>'printer_details', ''), coalesce(p_onboarding->>'pincode', ''),
    nullif(p_onboarding->>'alternate_phone', ''), coalesce(p_onboarding->>'registration_type', 'unregistered'),
    nullif(p_onboarding->>'registration_number', ''), coalesce(p_onboarding->'business_hours', '{}'::jsonb),
    nullif(p_onboarding->>'referral_source', ''), v_duplicate,
    case when v_duplicate and p_photo_path is not null then 'photo' when v_duplicate then 'gstin' else null end,
    case when v_duplicate and v_valid_gstin then v_gstin else null end,
    case when v_duplicate then p_photo_path else null end,
    case when v_duplicate then now() else null end
  );

  insert into public.shop_services (shop_id, service, enabled, display_order)
    select v_id, s.name, s.name in (select jsonb_array_elements_text(p_services)), s.sort
    from (values ('print',1),('photocopy',2),('scan',3),('bind',4),('laminate',5)) as s(name, sort);
  insert into public.rate_card (shop_id, service, paper_size, color, sides, paper_gsm, option, unit, price_paise)
    select v_id, r.service, r.paper_size::public.paper_size, r.color::public.color_mode,
           r.sides::public.sides_mode, r.paper_gsm, r.option, r.unit, r.price_paise
    from jsonb_to_recordset(p_rates) as r(service text, paper_size text, color text, sides text,
                                          paper_gsm int, option text, unit text, price_paise int);
  insert into public.inventory_items (shop_id, name, category, qty, unit, low_stock_threshold)
    select v_id, i.name, i.category::public.inv_category, i.qty, i.unit, i.low_stock_threshold
    from jsonb_to_recordset(coalesce(p_inventory, '[]'::jsonb))
      as i(name text, category text, qty numeric, unit text, low_stock_threshold numeric);

  return jsonb_build_object('id', v_id, 'slug', p_shop->>'slug', 'short_code', p_shop->>'short_code', 'duplicate_name', v_duplicate);
end
$$;
revoke all on function public.create_shop_application(jsonb,jsonb,jsonb,jsonb,jsonb,text) from public, anon, authenticated;
grant execute on function public.create_shop_application(jsonb,jsonb,jsonb,jsonb,jsonb,text) to service_role;

-- Profile name changes use the same lock/rule as signup. A duplicate rename is
-- taken offline for a human review; unrelated edits do not reset approval.
create or replace function public.update_shop_identity(p_shop_id uuid, p_fields jsonb, p_photo_path text default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_old public.shops%rowtype;
  v_name text;
  v_gstin text;
  v_name_changed boolean;
  v_duplicate boolean := false;
  v_valid_gstin boolean;
  v_old_photo text;
begin
  select * into v_old from public.shops where id = p_shop_id for update;
  if not found then raise exception 'SHOP_NOT_FOUND' using errcode = 'P0001'; end if;
  v_name := btrim(coalesce(p_fields->>'name', v_old.name));
  if length(public.normalized_shop_name(v_name)) < 2 then raise exception 'INVALID_SHOP_NAME' using errcode = 'P0001'; end if;
  if p_photo_path is not null and (
    p_photo_path not like p_shop_id::text || '/%'
    or not exists (select 1 from storage.objects where bucket_id = 'shop-name-proofs' and name = p_photo_path)
  ) then raise exception 'INVALID_PROOF_PHOTO' using errcode = 'P0001'; end if;
  v_gstin := upper(regexp_replace(coalesce(case when p_fields ? 'gstin' then p_fields->>'gstin' else v_old.gstin end, ''), '[[:space:]]+', '', 'g'));
  v_valid_gstin := v_gstin ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$';
  v_name_changed := public.normalized_shop_name(v_name) <> public.normalized_shop_name(v_old.name);
  if v_name_changed then
    perform pg_advisory_xact_lock(hashtextextended(public.normalized_shop_name(v_name), 0));
    v_duplicate := public.shop_name_exists(v_name, p_shop_id);
    if v_duplicate and not v_valid_gstin and p_photo_path is null then
      raise exception 'DUPLICATE_NAME_PROOF_REQUIRED' using errcode = 'P0001';
    end if;
    select name_proof_photo_path into v_old_photo from public.shop_onboarding where shop_id = p_shop_id;
    insert into public.shop_onboarding (shop_id, duplicate_name, name_proof_type, name_proof_gstin, name_proof_photo_path, name_proof_submitted_at)
    values (p_shop_id, v_duplicate,
      case when v_duplicate and p_photo_path is not null then 'photo' when v_duplicate then 'gstin' else null end,
      case when v_duplicate and v_valid_gstin then v_gstin else null end,
      case when v_duplicate then p_photo_path else null end,
      case when v_duplicate then now() else null end)
    on conflict (shop_id) do update set duplicate_name = excluded.duplicate_name,
      name_proof_type = excluded.name_proof_type, name_proof_gstin = excluded.name_proof_gstin,
      name_proof_photo_path = excluded.name_proof_photo_path, name_proof_submitted_at = excluded.name_proof_submitted_at;
    perform set_config('printly.checked_shop_name', p_shop_id::text, true);
  end if;

  update public.shops set name = v_name,
    address = case when p_fields ? 'address' then p_fields->>'address' else address end,
    city = case when p_fields ? 'city' then p_fields->>'city' else city end,
    phone = case when p_fields ? 'phone' then p_fields->>'phone' else phone end,
    gstin = case when p_fields ? 'gstin' then nullif(v_gstin, '') else gstin end,
    upi_id = case when p_fields ? 'upi_id' then nullif(p_fields->>'upi_id', '') else upi_id end,
    eta_minutes = case when p_fields ? 'eta_minutes' then (p_fields->>'eta_minutes')::int else eta_minutes end,
    rush_surcharge_bps = case when p_fields ? 'rush_surcharge_bps' then (p_fields->>'rush_surcharge_bps')::int else rush_surcharge_bps end,
    kyc_status = case when v_name_changed and v_duplicate then 'pending'::public.shop_kyc_status else kyc_status end,
    status = case when v_name_changed and v_duplicate then 'paused'::public.shop_status else status end,
    updated_at = now()
  where id = p_shop_id;
  return jsonb_build_object('duplicate_name', v_duplicate, 'name_changed', v_name_changed, 'old_photo_path', v_old_photo);
end
$$;
revoke all on function public.update_shop_identity(uuid,jsonb,text) from public, anon, authenticated;
grant execute on function public.update_shop_identity(uuid,jsonb,text) to service_role;

-- Make the invariant hard to bypass accidentally in another server route.
-- Codes never change; name changes must use one of the locked functions above.
create or replace function public.guard_shop_identity() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if tg_op = 'UPDATE' and new.short_code is distinct from old.short_code then
    raise exception 'SHOP_CODE_IMMUTABLE' using errcode = 'P0001';
  end if;
  if tg_op = 'INSERT' or public.normalized_shop_name(new.name) <> public.normalized_shop_name(old.name) then
    if coalesce(current_setting('printly.checked_shop_name', true), '') <> new.id::text then
      raise exception 'SHOP_NAME_MUST_BE_CHECKED' using errcode = 'P0001';
    end if;
  end if;
  return new;
end
$$;
drop trigger if exists guard_shop_identity on public.shops;
create trigger guard_shop_identity before insert or update on public.shops
  for each row execute function public.guard_shop_identity();
