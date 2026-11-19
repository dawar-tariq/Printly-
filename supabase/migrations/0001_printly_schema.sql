-- Printly schema v1 (MVP)
create extension if not exists pgcrypto;

-- ===== Enums =====
create type user_role as enum ('customer','shop_staff','admin');
create type shop_kyc_status as enum ('pending','approved','rejected','changes_requested');
create type shop_status as enum ('active','paused','suspended');
create type order_status as enum ('draft','queued','printing','ready','collected','cancelled','failed');
create type payment_status as enum ('pending','submitted','confirmed','rejected','cod_pending','cod_collected');
create type payment_method as enum ('upi','cod');
create type paper_size as enum ('A4','A3','A5','Legal');
create type color_mode as enum ('bw','color');
create type sides_mode as enum ('single','duplex');
create type binding_type as enum ('none','staple','spiral','hard');
create type inv_category as enum ('paper','ink','binding','laminate','other');
create type dispute_status as enum ('open','investigating','resolved_refund','resolved_reject');

-- ===== Identity & tenancy =====
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text unique,
  full_name text not null default '',
  phone text,
  role user_role not null default 'customer',
  created_at timestamptz not null default now()
);

create table shops (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references profiles(id),
  slug text unique not null,
  short_code text unique not null,
  name text not null,
  address text not null default '',
  city text not null default '',
  phone text not null default '',
  gstin text,
  upi_id text,
  kyc_status shop_kyc_status not null default 'pending',
  status shop_status not null default 'paused',
  commission_bps int not null default 800 check (commission_bps between 0 and 5000),
  rush_surcharge_bps int not null default 1000,
  eta_minutes int not null default 20,
  rating_avg numeric(2,1) not null default 0,
  rating_count int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table shop_staff (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references shops(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  role text not null default 'staff' check (role in ('owner','manager','staff')),
  created_at timestamptz not null default now(),
  unique (shop_id, user_id)
);

-- ===== Catalog & pricing =====
create table shop_services (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references shops(id) on delete cascade,
  service text not null check (service in ('print','photocopy','scan','bind','laminate')),
  enabled boolean not null default true,
  display_order int not null default 100,
  unique (shop_id, service)
);

create table rate_card (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references shops(id) on delete cascade,
  service text not null check (service in ('print','photocopy','scan','bind','laminate')),
  paper_size paper_size,
  color color_mode,
  sides sides_mode,
  paper_gsm int,
  option text,
  unit text not null default 'page' check (unit in ('page','job','sheet')),
  price_paise int not null check (price_paise >= 0)
);
-- NOTE: NULLs are treated as the shop-default dims for uniqueness purposes.
create unique index rate_card_unique
  on rate_card (shop_id, service, coalesce(paper_size, 'A4'), coalesce(color, 'bw'),
                coalesce(sides, 'single'), coalesce(paper_gsm, -1), coalesce(option, '-'));

-- ===== Orders =====
create table orders (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references shops(id),
  customer_id uuid references profiles(id),
  customer_name text not null default '',
  customer_phone text not null default '',
  customer_email text not null default '',
  token text,
  token_date date not null default current_date,
  status order_status not null default 'draft',
  payment_status payment_status not null default 'pending',
  payment_method payment_method,
  subtotal_paise int not null default 0,
  discount_paise int not null default 0,
  tax_paise int not null default 0,
  total_paise int not null default 0,
  commission_paise int not null default 0,
  rush boolean not null default false,
  eta_minutes int,
  notes text not null default '',
  utr text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  ready_at timestamptz,
  collected_at timestamptz
);
create unique index orders_shop_token_day on orders (shop_id, token_date, token) where token is not null;
create index orders_shop_status_created on orders (shop_id, status, created_at desc);
create index orders_active on orders (shop_id, created_at) where status in ('queued','printing','ready');
create index orders_customer_created on orders (customer_id, created_at desc);

create table order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete cascade,
  service text not null,
  paper_size paper_size not null default 'A4',
  color color_mode not null default 'bw',
  sides sides_mode not null default 'single',
  paper_gsm int not null default 80,
  option text,
  copies int not null default 1 check (copies > 0),
  pages int not null default 1 check (pages > 0),
  binding binding_type not null default 'none',
  lamination boolean not null default false,
  unit_price_paise int not null default 0,
  line_total_paise int not null default 0
);
create index order_items_order on order_items (order_id);

create table order_files (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete cascade,
  shop_id uuid not null references shops(id),
  storage_path text not null unique,
  original_name text not null,
  mime text not null,
  size_bytes int not null default 0,
  page_count int,
  source text not null default 'upload' check (source in ('upload','dropbox')),
  created_at timestamptz not null default now()
);
create index order_files_order on order_files (order_id);

create table order_status_events (
  id bigint generated always as identity primary key,
  order_id uuid not null references orders(id) on delete cascade,
  from_status text,
  to_status text,
  by uuid references profiles(id),
  note text,
  created_at timestamptz not null default now()
);
create index order_status_events_order on order_status_events (order_id, created_at);

-- ===== Money =====
create table payments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references orders(id) on delete cascade,
  provider text not null default 'upi',
  amount_paise int not null default 0,
  status text not null default 'created' check (status in ('created','submitted','confirmed','rejected','cod_pending','cod_collected')),
  utr text,
  confirmed_by uuid references profiles(id),
  confirmed_at timestamptz,
  raw jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index payments_utr on payments (utr) where utr is not null;

create table payouts (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references shops(id),
  period_start date not null,
  period_end date not null,
  gross_paise bigint not null default 0,
  commission_paise bigint not null default 0,
  refunds_paise bigint not null default 0,
  net_paise bigint not null default 0,
  status text not null default 'pending' check (status in ('pending','processing','paid','failed')),
  utr text,
  paid_at timestamptz,
  created_at timestamptz not null default now()
);

-- ===== Ops =====
create table inventory_items (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references shops(id) on delete cascade,
  name text not null,
  category inv_category not null default 'other',
  qty numeric not null default 0,
  unit text not null default 'sheets',
  low_stock_threshold numeric not null default 100,
  created_at timestamptz not null default now()
);
create index inventory_shop on inventory_items (shop_id);

create table reviews (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references orders(id) on delete cascade,
  shop_id uuid not null references shops(id),
  rating int not null check (rating between 1 and 5),
  comment text not null default '',
  created_at timestamptz not null default now()
);

create table disputes (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete cascade,
  raised_by uuid references profiles(id),
  type text not null default 'other' check (type in ('quality','missing_pages','overcharge','other')),
  description text not null,
  status dispute_status not null default 'open',
  resolution_note text not null default '',
  resolved_by uuid references profiles(id),
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

create table platform_settings (
  key text primary key,
  value jsonb not null
);

create table shop_counters (
  shop_id uuid not null references shops(id) on delete cascade,
  day date not null default current_date,
  last_seq int not null default 0,
  primary key (shop_id, day)
);

-- ===== Functions =====
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as
$$ select exists(select 1 from profiles where id = auth.uid() and role = 'admin') $$;

create or replace function public.my_shop_ids() returns setof uuid
language sql stable security definer set search_path = public as
$$ select shop_id from shop_staff where user_id = auth.uid() $$;

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as
$$ begin
  insert into public.profiles (id, email, full_name, role)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name',''), 'customer')
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
for each row execute function public.handle_new_user();

create or replace function public.next_token(p_shop_id uuid) returns text
language plpgsql security definer set search_path = public as
$$ declare v_seq int;
begin
  insert into shop_counters(shop_id, day, last_seq) values (p_shop_id, current_date, 1)
  on conflict (shop_id, day) do update set last_seq = shop_counters.last_seq + 1
  returning last_seq into v_seq;
  return 'A-' || lpad(v_seq::text, 3, '0');
end $$;

create or replace function public.get_order_track(p_order_id uuid)
returns table (order_id uuid, token text, status text, payment_status text, payment_method text,
               shop_name text, shop_slug text, shop_city text, total_paise int, eta_minutes int,
               item_count int, rush boolean, created_at timestamptz, ready_at timestamptz, collected_at timestamptz)
language sql stable security definer set search_path = public as
$$ select o.id, o.token, o.status::text, o.payment_status::text, coalesce(o.payment_method::text,''),
          s.name, s.slug, s.city, o.total_paise, o.eta_minutes,
          (select count(*) from order_items oi where oi.order_id = o.id)::int,
          o.rush, o.created_at, o.ready_at, o.collected_at
   from orders o join shops s on s.id = o.shop_id
   where o.id = p_order_id $$;

grant execute on function public.get_order_track(uuid) to anon, authenticated;
