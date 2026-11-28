-- Inert foundation for development in the isolated QA project. This migration
-- does not create accounts, attribution, commissions, rewards or payouts, and
-- does not hook into signup or subscription review. Do not enable the UI until
-- authenticated APIs, transaction handling and adversarial tests are complete.

create table public.program_affiliates (
  user_id uuid primary key references auth.users(id) on delete restrict,
  referral_code text not null unique check (referral_code ~ '^[A-Z0-9]{12,32}$'),
  status text not null default 'active' check (status in ('active', 'suspended')),
  created_at timestamptz not null default now()
);

create table public.program_owner_codes (
  shop_id uuid primary key references public.shops(id) on delete restrict,
  referral_code text not null unique check (referral_code ~ '^[A-Z0-9]{12,32}$'),
  created_at timestamptz not null default now()
);

-- One attribution per shop per programme. Both programmes can apply to a
-- single shop. API/RPCs must validate ownership, eligibility and self-referral
-- and insert attribution atomically with shop signup; those checks are not yet
-- implemented. A shop's attribution must not be silently reassigned.
create table public.program_affiliate_attributions (
  shop_id uuid primary key references public.shops(id) on delete restrict,
  affiliate_user_id uuid not null references public.program_affiliates(user_id) on delete restrict,
  created_at timestamptz not null default now()
);
create index program_affiliate_attributions_affiliate on public.program_affiliate_attributions(affiliate_user_id);

create table public.program_owner_attributions (
  shop_id uuid primary key references public.shops(id) on delete restrict,
  referring_shop_id uuid not null references public.program_owner_codes(shop_id) on delete restrict,
  created_at timestamptz not null default now(),
  check (shop_id <> referring_shop_id)
);
create index program_owner_attributions_referrer on public.program_owner_attributions(referring_shop_id);

alter table public.program_affiliates enable row level security;
alter table public.program_owner_codes enable row level security;
alter table public.program_affiliate_attributions enable row level security;
alter table public.program_owner_attributions enable row level security;
revoke all on public.program_affiliates, public.program_owner_codes, public.program_affiliate_attributions, public.program_owner_attributions from public, anon, authenticated;
grant select, insert, update, delete on public.program_affiliates, public.program_owner_codes, public.program_affiliate_attributions, public.program_owner_attributions to service_role;
