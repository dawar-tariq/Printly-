import { PGlite } from '@electric-sql/pglite';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';

it('prepares the complete candidate atomically with all worker claims paused', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'printly-install-candidate-'));
  const db = new PGlite();
  try {
    const file = join(dir, 'candidate.sql');
    execFileSync('node', ['scripts/prepare-native-production-sql.mjs', file]);
    const sql = readFileSync(file, 'utf8');
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create table public.profiles (id uuid primary key, role text not null);
      create table public.shops (id uuid primary key, name text not null);
      create table public.shop_staff (user_id uuid references public.profiles(id), shop_id uuid references public.shops(id), role text, primary key (user_id,shop_id));
      create table public.orders (id uuid primary key, shop_id uuid references public.shops(id), status text, payment_method text, payment_status text, token text);
      create table public.platform_settings (key text primary key, value jsonb not null);
      create table public.subscription_promos (id uuid primary key, enabled boolean not null, starts_at timestamptz, ends_at timestamptz, max_uses integer);
      create table public.subscription_purchases (promo_id uuid references public.subscription_promos(id), status text not null);
      create table public.subscription_announcements (id uuid primary key, title text, message text, enabled boolean, starts_at timestamptz, ends_at timestamptz, updated_by uuid references public.profiles(id), promo_id uuid references public.subscription_promos(id));
      create publication supabase_realtime for table public.orders with (publish='insert, update, truncate');
      create function public.synthetic_tracking_trigger() returns trigger language plpgsql as $$ begin return null; end $$;
      create trigger broadcast_order_tracking_change after update on public.orders for each row execute function public.synthetic_tracking_trigger();`);
    await db.exec(sql);
    const result = await db.query(`select to_regclass('public.native_push_devices') is not null as devices,
      to_regclass('public.native_notification_campaigns') is not null as campaigns,
      to_regclass('public.native_app_releases') is not null as releases,
      not has_function_privilege('service_role','public.claim_native_push_deliveries(integer)','execute') as paused,
      not has_function_privilege('service_role','public.claim_native_push_deliveries_budgeted(integer)','execute') as budget_paused,
      not has_function_privilege('service_role','public.claim_native_push_deliveries_unbudgeted(integer)','execute') as internal_paused`);
    expect(result.rows).toEqual([{ devices: true, campaigns: true, releases: true, paused: true, budget_paused: true, internal_paused: true }]);
    await expect(db.exec(sql)).rejects.toThrow('Native notification schema already exists');
  } finally { await db.close(); rmSync(dir, { recursive: true, force: true }); }
}, 30000);
