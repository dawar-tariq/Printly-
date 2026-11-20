-- Structured shop application details used by the onboarding wizard and admin review.
create table shop_onboarding (
  shop_id uuid primary key references shops(id) on delete cascade,
  business_type text not null default 'other'
    check (business_type in ('digital_printing','photocopy','stationery','internet_cafe','other')),
  legal_business_name text,
  year_established smallint check (year_established between 1900 and 2100),
  staff_count int not null default 1 check (staff_count between 1 and 100),
  printer_count int not null default 1 check (printer_count between 0 and 100),
  avg_daily_jobs int not null default 0 check (avg_daily_jobs between 0 and 10000),
  printer_details text not null default '',
  pincode text not null default '',
  alternate_phone text,
  registration_type text not null default 'unregistered'
    check (registration_type in ('unregistered','gstin','udyam','shop_license','other')),
  registration_number text,
  business_hours jsonb not null default '{}'::jsonb,
  referral_source text,
  review_note text not null default '',
  reviewed_at timestamptz,
  reviewed_by uuid references profiles(id) on delete set null,
  submitted_at timestamptz not null default now()
);

alter table shop_onboarding enable row level security;
create policy shop_onboarding_select on shop_onboarding for select
  using (exists(select 1 from shops s where s.id = shop_id and s.owner_id = auth.uid()) or public.is_admin());

create index shop_onboarding_submitted on shop_onboarding (submitted_at desc);
