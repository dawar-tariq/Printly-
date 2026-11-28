import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

let db: PGlite;
const owner='11111111-1111-4111-8111-111111111111', shop='22222222-2222-4222-8222-222222222222';
beforeAll(async () => {
  db=new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role; create schema auth;
    create table auth.users(id uuid primary key,email text);
    create table public.profiles(id uuid primary key,full_name text);
    create table public.shops(id uuid primary key,owner_id uuid references public.profiles(id),kyc_status text default 'pending',status text default 'paused');
    create table public.shop_subscriptions(shop_id uuid primary key references public.shops(id),is_permanent boolean default false,expires_at timestamptz);
    create table public.subscription_purchases(id uuid primary key,shop_id uuid references public.shops(id),status text);
  `);
  await db.exec(readFileSync('supabase/migrations/0030_owner_email_outbox.sql','utf8'));
  await db.query("insert into auth.users values($1,'owner@example.test'); insert into public.profiles values($1,'Owner')",[owner]).catch(async () => {
    await db.query("insert into auth.users values($1,'owner@example.test')",[owner]);
    await db.query("insert into public.profiles values($1,'Owner')",[owner]);
  });
},30000);
afterAll(async()=>{await db?.close();});
describe('transactional owner email outbox',()=>{
  it('queues signup and review events in the same transaction, without fabricated under-review',async()=>{
    await db.query('insert into public.shops(id,owner_id) values($1,$2)',[shop,owner]);
    expect((await db.query('select kind from public.owner_email_outbox order by kind')).rows).toEqual([{kind:'application_received'},{kind:'welcome'}]);
    await db.query("update public.shops set kyc_status='approved',status='active' where id=$1",[shop]);
    expect((await db.query("select kind from public.owner_email_outbox where kind='verified'")).rows).toHaveLength(1);
  });
  it('deduplicates expiry reminders and discards reminders after renewal',async()=>{
    await db.query("insert into public.shop_subscriptions(shop_id,expires_at) values($1,now()+interval '3 days')",[shop]);
    await db.exec('select public.queue_owner_subscription_reminders(); select public.queue_owner_subscription_reminders()');
    expect((await db.query("select id from public.owner_email_outbox where kind='subscription_expiring'")).rows).toHaveLength(1);
    await db.query("update public.shop_subscriptions set expires_at=now()+interval '40 days' where shop_id=$1",[shop]);
    await db.exec("update public.owner_email_outbox set state='sent' where kind <> 'subscription_expiring'");
    expect((await db.query('select public.claim_owner_email() as item')).rows).toEqual([{item:null}]);
    expect((await db.query("select state from public.owner_email_outbox where kind='subscription_expiring'")).rows).toEqual([{state:'skipped'}]);
  });
  it('never auto-retries a claim with unknown delivery outcome',async()=>{
    await db.query("insert into public.owner_email_outbox(shop_id,owner_id,kind,event_key) values($1,$2,'welcome','test-claim')",[shop,owner]);
    const result=await db.query<{item:{id:string;claim_token:string}}>('select public.claim_owner_email() as item');
    const {id,claim_token}=result.rows[0].item;
    await db.query("update public.owner_email_outbox set claimed_at=now()-interval '6 minutes' where id=$1",[id]);
    expect((await db.query('select public.claim_owner_email() as item')).rows).toEqual([{item:null}]);
    expect((await db.query('select state from public.owner_email_outbox where id=$1',[id])).rows).toEqual([{state:'unknown'}]);
    expect((await db.query("select public.finish_owner_email($1,$2,'sent',null) as ok",[id,claim_token])).rows).toEqual([{ok:false}]);
  });
  it('rolls back queued events with the triggering transaction',async()=>{
    await db.exec('begin');
    await db.query("update public.shops set kyc_status='rejected' where id=$1",[shop]);
    await db.exec('rollback');
    expect((await db.query("select kind from public.owner_email_outbox where kind='not_approved'")).rows).toEqual([]);
  });
  it('retries explicit rate limits with backoff and fresh claim tokens',async()=>{
    await db.query("insert into public.owner_email_outbox(shop_id,owner_id,kind,event_key) values($1,$2,'welcome','test-rate-limit')",[shop,owner]);
    const first=(await db.query<{item:{id:string;claim_token:string}}>('select public.claim_owner_email() as item')).rows[0].item;
    expect((await db.query("select public.finish_owner_email($1,$2,'retry','http_429') as ok",[first.id,first.claim_token])).rows).toEqual([{ok:true}]);
    expect((await db.query('select public.claim_owner_email() as item')).rows).toEqual([{item:null}]);
    await db.query("update public.owner_email_outbox set next_attempt_at=now()-interval '1 second' where id=$1",[first.id]);
    const second=(await db.query<{item:{id:string;claim_token:string}}>('select public.claim_owner_email() as item')).rows[0].item;
    expect(second.claim_token).not.toBe(first.claim_token);
    expect((await db.query("select public.finish_owner_email($1,$2,'sent',null) as ok",[first.id,first.claim_token])).rows).toEqual([{ok:false}]);
    await db.query("select public.finish_owner_email($1,$2,'sent',null)",[second.id,second.claim_token]);
  });
  it('denies untrusted roles queue and dispatcher access',async()=>{
    await db.exec('set role authenticated');
    try { await expect(db.query('select * from public.owner_email_outbox')).rejects.toThrow(/permission denied/i); await expect(db.query('select public.claim_owner_email()')).rejects.toThrow(/permission denied/i); }
    finally { await db.exec('reset role'); }
  });
});
