import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { describe, expect, it } from 'vitest';

describe('duplex-sheet migration', () => {
  it('keeps existing rates and placed totals unchanged and restricts the new unit', async () => {
    const db = new PGlite();
    try {
      await db.exec(`
        create role anon; create role authenticated; create role service_role;
        create function public.commit_draft_checkout(uuid, bigint, jsonb, integer, jsonb, jsonb, jsonb)
          returns jsonb language sql security definer as $$ select '{"delegated":true}'::jsonb $$;
        create type public.sides_mode as enum ('single', 'duplex');
        create table public.rate_card (
          id integer primary key, service text not null, sides public.sides_mode,
          unit text not null check (unit in ('page','job','sheet')), price_paise integer not null
        );
        create table public.orders (id integer primary key, total_paise integer not null);
        create table public.order_items (order_id integer, unit_price_paise integer, line_total_paise integer);
        insert into public.rate_card values
          (1, 'print', 'duplex', 'page', 150),
          (2, 'print', 'duplex', 'sheet', 300),
          (3, 'laminate', null, 'sheet', 500),
          (4, 'bind', null, 'job', 3000);
        insert into public.orders values (1, 3540);
        insert into public.order_items values (1, 300, 3000);
      `);
      const ratesBefore = (await db.query('select * from public.rate_card order by id')).rows;
      const ordersBefore = (await db.query('select * from public.orders')).rows;
      const linesBefore = (await db.query('select * from public.order_items')).rows;
      await db.exec(readFileSync('supabase/migrations/0016_duplex_sheet_rates.sql', 'utf8'));
      expect((await db.query('select * from public.rate_card order by id')).rows).toEqual(ratesBefore);
      expect((await db.query('select * from public.orders')).rows).toEqual(ordersBefore);
      expect((await db.query('select * from public.order_items')).rows).toEqual(linesBefore);

      await db.exec("insert into public.rate_card values (5, 'print', 'duplex', 'duplex_sheet', 300), (6, 'photocopy', 'duplex', 'duplex_sheet', 200)");
      await expect(db.exec("insert into public.rate_card values (7, 'print', 'single', 'duplex_sheet', 300)")).rejects.toThrow(/check constraint/i);
      await expect(db.exec("insert into public.rate_card values (7, 'print', null, 'duplex_sheet', 300)")).rejects.toThrow(/check constraint/i);
      await expect(db.exec("insert into public.rate_card values (7, 'scan', 'duplex', 'duplex_sheet', 300)")).rejects.toThrow(/check constraint/i);
      await expect(db.exec("insert into public.rate_card values (7, 'print', 'duplex', 'unknown', 300)")).rejects.toThrow(/check constraint/i);
      expect((await db.query('select count(*)::int as count from public.rate_card')).rows[0]).toEqual({ count: 6 });

      const checkout = (rates: unknown, payload: unknown) => db.query(
        'select public.commit_draft_checkout($1::uuid, $2::bigint, $3::jsonb, $4::integer, $5::jsonb, $6::jsonb, $7::jsonb) as result',
        ['00000000-0000-0000-0000-000000000001', 1, JSON.stringify(rates), 0, '{}', '[]', JSON.stringify(payload)],
      );
      const oldRates = [{ unit: 'page' }, { unit: 'sheet' }];
      const physicalSheetRates = [...oldRates, { unit: 'duplex_sheet' }];
      expect((await checkout(oldRates, {})).rows).toEqual([{ result: { delegated: true } }]);
      await expect(checkout(physicalSheetRates, {})).rejects.toThrow(/PRICING_CHANGED/);
      await expect(checkout(physicalSheetRates, { pricing_engine: 'other' })).rejects.toThrow(/PRICING_CHANGED/);
      expect((await checkout(physicalSheetRates, { pricing_engine: 'duplex-v1' })).rows)
        .toEqual([{ result: { delegated: true } }]);

      const permissions = await db.query<{ wrapper: boolean; legacy: boolean; anonymous: boolean }>(`
        select has_function_privilege('service_role',
          'public.commit_draft_checkout(uuid,bigint,jsonb,integer,jsonb,jsonb,jsonb)', 'EXECUTE') as wrapper,
          has_function_privilege('service_role',
          'public.commit_draft_checkout_v1(uuid,bigint,jsonb,integer,jsonb,jsonb,jsonb)', 'EXECUTE') as legacy,
          has_function_privilege('anon',
          'public.commit_draft_checkout(uuid,bigint,jsonb,integer,jsonb,jsonb,jsonb)', 'EXECUTE') as anonymous
      `);
      expect(permissions.rows).toEqual([{ wrapper: true, legacy: false, anonymous: false }]);
    } finally {
      await db.close();
    }
  }, 30000);
});
