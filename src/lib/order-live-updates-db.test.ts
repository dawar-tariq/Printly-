import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const db = new PGlite();
const id = '11111111-1111-4111-8111-111111111111';

beforeAll(async () => {
  await db.exec(`
    create role anon; create role authenticated;
    create schema realtime;
    create table public.orders (
      id uuid primary key, status text, payment_status text, payment_method text, token text,
      eta_minutes int, ready_at timestamptz, collected_at timestamptz, notes text
    );
    create table public.captured_signals (payload jsonb, event text, topic text, private boolean);
    create function realtime.send(payload jsonb, event text, topic text, private boolean) returns void
      language sql as $$ insert into public.captured_signals values (payload, event, topic, private) $$;
  `);
  await db.exec(readFileSync('supabase/migrations/0025_order_live_updates.sql', 'utf8'));
  await db.query("insert into public.orders(id,status,payment_status,payment_method,eta_minutes,notes) values ($1,'queued','cod_pending','cod',20,'private')", [id]);
});
afterAll(async () => { await db.close(); });

describe('order tracking invalidations', () => {
  it('sends an empty event on a hashed topic only when tracking fields actually change', async () => {
    await db.query("update public.orders set notes='not tracking data' where id=$1", [id]);
    await db.query("update public.orders set status='queued' where id=$1", [id]);
    expect((await db.query('select * from public.captured_signals')).rows).toHaveLength(0);
    await db.query("update public.orders set status='printing' where id=$1", [id]);
    const rows = (await db.query<{ payload: unknown; event: string; topic: string; private: boolean }>('select * from public.captured_signals')).rows;
    expect(rows).toEqual([{ payload: {}, event: 'changed', topic: `printly-track:${createHash('sha256').update(id).digest('hex')}`, private: false }]);
    expect(JSON.stringify(rows)).not.toContain(id);
    expect(JSON.stringify(rows)).not.toContain('not tracking data');
  });
  it('does not fail an order write if the Realtime service is unavailable', async () => {
    await db.exec(`create or replace function realtime.send(payload jsonb, event text, topic text, private boolean) returns void
      language plpgsql as $$ begin raise exception 'disconnected'; end $$;`);
    await db.query("update public.orders set status='ready' where id=$1", [id]);
    expect((await db.query<{ status: string }>('select status from public.orders where id=$1', [id])).rows[0].status).toBe('ready');
  });
});
