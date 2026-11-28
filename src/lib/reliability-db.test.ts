import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

// Execute the real migrations against an isolated PostgreSQL-compatible fixture.
// PGlite tests correctness/ACLs; separate multi-backend tests cover row locks.
const source = readFileSync('src/lib/order-draft-safeguards.test.ts', 'utf8');
const schema = source.match(/const schema = `([\s\S]*?)`;\n\nconst shop/);
if (!schema) throw new Error('Could not find the existing order fixture');
const shop = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const otherShop = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const order = '11111111-1111-4111-8111-111111111111';
const order2 = '22222222-2222-4222-8222-222222222222';
const order3 = '33333333-3333-4333-8333-333333333333';
const ticket = '44444444-4444-4444-8444-444444444444';
const msg = '55555555-5555-4555-8555-555555555555';
const reply = '66666666-6666-4666-8666-666666666666';
const actor = '77777777-7777-4777-8777-777777777777';
let db: PGlite;
const query = (sql: string, values: unknown[] = []) => db.query<Record<string, unknown>>(sql, values);

beforeAll(async () => {
  db = new PGlite();
  await db.exec(schema[1]);
  await db.exec('alter table public.orders add column created_at timestamptz not null default now()');
  for (const name of ['0010_order_draft_safeguards.sql', '0013_public_abuse_limits.sql', '0014_more_abuse_limits.sql', '0018_board_tracking.sql', '0019_private_support.sql', '0020_upi_duplicate_warning.sql']) {
    await db.exec(readFileSync(`supabase/migrations/${name}`, 'utf8'));
  }
}, 30000);
afterAll(async () => { await db?.close(); });
beforeEach(async () => {
  await db.exec('truncate public.support_messages, public.support_tickets, public.security_rate_limits, public.order_status_events, public.payments, public.order_items, public.order_files, public.orders, public.shop_counters, public.shops cascade');
});

const create = (subject = 'Help', text = 'Hello') => query('select public.create_support_ticket($1,$2,$3,$4,$5) as result', [ticket, 'a'.repeat(64), subject, msg, text]);
const append = (id = reply, sender = 'customer', body = 'A reply', who: string | null = null) => query('select public.append_support_message($1,$2,$3,$4,$5) as result', [ticket, id, sender, who, body]);

describe('reliability migration database safeguards', () => {
  it('keeps both tracking windows and existing upload limits, rejecting bad keys and buckets', async () => {
    const hash = '1'.repeat(64), other = '2'.repeat(64);
    await query("insert into public.security_rate_limits(bucket,client_hash,hits,window_ends_at) values ('tracking',$1,5999,now()+interval '10 minutes'),('tracking_order',$1,299,now()+interval '10 minutes'),('draft_upload_issue',$1,29,now()+interval '1 day')", [hash]);
    const consume = async (bucket: string, key = hash) => (await query('select public.consume_public_rate_limit($1,$2) as value', [bucket, key])).rows[0].value as { allowed: boolean };
    expect((await consume('tracking')).allowed).toBe(true);
    expect((await consume('tracking')).allowed).toBe(false);
    expect((await consume('tracking_order')).allowed).toBe(true);
    expect((await consume('tracking_order')).allowed).toBe(false);
    expect((await consume('tracking_order', other)).allowed).toBe(true);
    expect((await consume('draft_upload_issue')).allowed).toBe(true);
    expect((await consume('draft_upload_issue')).allowed).toBe(false);
    expect((await consume('support_create', other)).allowed).toBe(true);
    await expect(consume('unknown')).rejects.toThrow('INVALID_RATE_LIMIT_BUCKET');
    await expect(consume('tracking', 'raw-ip')).rejects.toThrow('INVALID_RATE_LIMIT_KEY');
  });

  it('creates and retries a private ticket atomically without storing the secret or duplicating messages', async () => {
    expect((await create()).rows[0].result).toBe('created');
    expect((await create()).rows[0].result).toBe('exists');
    await expect(create('Different')).rejects.toThrow('SUPPORT_CONFLICT');
    await expect(query('select public.create_support_ticket($1,$2,$3,$4,$5)', [ticket, 'b'.repeat(64), 'Help', msg, 'Hello'])).rejects.toThrow('SUPPORT_CONFLICT');
    expect((await query('select subject, message_count, secret_hash from public.support_tickets')).rows).toEqual([{ subject: 'Help', message_count: 1, secret_hash: 'a'.repeat(64) }]);
    expect((await query('select sender, position, body from public.support_messages')).rows).toEqual([{ sender: 'customer', position: 1, body: 'Hello' }]);
  });

  it('deduplicates replies, reopens on customer follow-up and enforces the 100-message cap', async () => {
    await create();
    expect((await append(reply, 'admin', 'Hello from support', actor)).rows[0].result).toBe('created');
    expect((await append(reply, 'admin', 'Hello from support', actor)).rows[0].result).toBe('exists');
    await expect(append(reply, 'admin', 'Different text', actor)).rejects.toThrow('SUPPORT_MESSAGE_CONFLICT');
    expect((await query('select status, message_count from public.support_tickets where id=$1', [ticket])).rows[0]).toEqual({ status: 'answered', message_count: 2 });
    await query("update public.support_tickets set status='closed' where id=$1", [ticket]);
    await append('88888888-8888-4888-8888-888888888888');
    expect((await query('select status, message_count from public.support_tickets where id=$1', [ticket])).rows[0]).toEqual({ status: 'open', message_count: 3 });
    await query("insert into public.support_messages(id,ticket_id,sender,position,body) select gen_random_uuid(),$1,'customer',n,'filler' from generate_series(4,100) n", [ticket]);
    await query('update public.support_tickets set message_count=100 where id=$1', [ticket]);
    await expect(append('99999999-9999-4999-8999-999999999999')).rejects.toThrow('SUPPORT_FULL');
    // Retrying an already-accepted reply is still safe when full.
    expect((await append(reply, 'admin', 'Hello from support', actor)).rows[0].result).toBe('exists');
    expect((await query('select count(*)::int as n from public.support_messages where ticket_id=$1', [ticket])).rows[0].n).toBe(100);
  });

  it('denies anonymous/authenticated direct table access and privileged RPCs', async () => {
    for (const role of ['anon', 'authenticated']) {
      await db.exec(`set role ${role}`);
      try {
        await expect(query('select * from public.support_tickets')).rejects.toThrow(/permission denied/i);
        await expect(query('select * from public.support_messages')).rejects.toThrow(/permission denied/i);
        await expect(create()).rejects.toThrow(/permission denied/i);
        await expect(append()).rejects.toThrow(/permission denied/i);
        await expect(query('select public.consume_public_rate_limit($1,$2)', ['support_access', 'a'.repeat(64)])).rejects.toThrow(/permission denied/i);
        await expect(query('select public.decide_shop_upi_payment_checked($1,$2,$3,$4,$5,$6)', [order, shop, 'confirm', actor, null, false])).rejects.toThrow(/permission denied/i);
      } finally { await db.exec('reset role'); }
    }
    const flags = await query("select has_table_privilege('service_role','public.support_tickets','select') as t, has_function_privilege('service_role','public.append_support_message(uuid,uuid,text,uuid,text)','execute') as f");
    expect(flags.rows[0]).toEqual({ t: true, f: true });
  });

  it('warns on a matching reference only within the shop; no mutation occurs until explicitly acknowledged', async () => {
    await query('insert into public.shops(id,name,upi_id) values ($1,$2,$3),($4,$5,$6)', [shop, 'One', 'one@upi', otherShop, 'Two', 'two@upi']);
    await query("insert into public.orders(id,shop_id,status,payment_method,payment_status,utr,total_paise) values ($1,$2,'draft','upi','submitted','REF-123',500),($3,$2,'draft','upi','submitted',' ref 123 ',500),($4,$5,'draft','upi','submitted','REF-123',500)", [order, shop, order2, order3, otherShop]);
    await query("insert into public.payments(order_id,provider,amount_paise,status) values ($1,'upi',500,'submitted'),($2,'upi',500,'submitted'),($3,'upi',500,'submitted')", [order, order2, order3]);
    const decide = async (shopId: string, id: string, ack: boolean) => (await query('select public.decide_shop_upi_payment_checked($1,$2,$3,$4,$5,$6) as result', [id, shopId, 'confirm', actor, null, ack])).rows[0].result as Record<string, unknown>;
    const warning = await decide(shop, order, false);
    expect(warning.outcome).toBe('possible_duplicate');
    expect(Number(warning.duplicate_count)).toBe(1);
    expect((warning.duplicates as Array<{ id: string }>).map((entry) => entry.id)).toEqual([order2]);
    expect((await query('select status, payment_status, token from public.orders where id=$1', [order])).rows[0]).toEqual({ status: 'draft', payment_status: 'submitted', token: null });
    await expect(decide(otherShop, order, true)).rejects.toThrow('WRONG_SHOP');
    expect((await decide(shop, order, true)).outcome).toBe('confirmed');
    expect((await query('select status, payment_status from public.orders where id=$1', [order])).rows[0]).toEqual({ status: 'queued', payment_status: 'confirmed' });
    expect((await query("select count(*)::int as n from public.order_status_events where order_id=$1 and note like '%duplicate%'", [order])).rows[0].n).toBe(1);
    // A reference in another shop is not a duplicate in this shop.
    expect((await decide(otherShop, order3, false)).outcome).toBe('confirmed');
  });
});
