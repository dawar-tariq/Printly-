import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  row: null as null | Record<string, unknown>, rows: [] as Record<string, unknown>[], dbError: false,
  session: null as null | { user: { id: string }; profile: { role: string } },
  limits: [] as string[], blocked: '', calls: [] as Array<{ name: string; args: Record<string, unknown> }>, queries: [] as string[],
}));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/rate-limit', () => ({
  enforcePublicRateLimit: async (_req: Request, bucket: string) => { state.limits.push(bucket); return state.blocked === bucket ? new Response('limited', { status: 429 }) : null; },
  enforceSupportTicketLimit: async () => { state.limits.push('ticket'); return state.blocked === 'ticket' ? new Response('limited', { status: 429 }) : null; },
}));
vi.mock('@/lib/api', async (original) => ({
  ...(await original<typeof import('@/lib/api')>()),
  getSessionProfile: async () => state.session,
}));
vi.mock('@/lib/supabase', () => ({ createAdminSupabase: () => ({
  from: (table: string) => {
    state.queries.push(table);
    const chain = {
      select: () => chain, eq: () => chain, order: () => chain, update: () => chain,
      maybeSingle: async () => ({ data: state.row, error: state.dbError ? { code: 'XX' } : null }),
      limit: async () => ({ data: state.rows, error: state.dbError ? { code: 'XX' } : null }),
      range: async () => ({ data: state.rows, error: state.dbError ? { code: 'XX' } : null, count: state.rows.length }),
    };
    return chain;
  },
  rpc: async (name: string, args: Record<string, unknown>) => { state.calls.push({ name, args }); return { data: 'created', error: state.dbError ? { message: 'private SQL diagnostic' } : null }; },
}) }));
import { POST as create } from './route';
import { POST as conversation } from './conversation/route';
import { GET as inbox } from '../admin/support/route';
import { GET as adminRead, POST as adminAct } from '../admin/support/[id]/route';

const id = '11111111-1111-4111-8111-111111111111';
const messageId = '22222222-2222-4222-8222-222222222222';
const secret = Buffer.alloc(32, 7).toString('base64url');
const wrong = Buffer.alloc(32, 8).toString('base64url');
const params = { params: Promise.resolve({ id }) };
const req = (path: string, body: unknown) => new Request(`https://printly.test${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

beforeEach(() => {
  state.row = { id, secret_hash: createHash('sha256').update(secret).digest('hex'), subject: 'Help', status: 'open', message_count: 1, created_at: '2026-01-01', updated_at: '2026-01-01' };
  state.rows = [{ id: messageId, sender: 'customer', body: 'hello', created_at: '2026-01-01' }];
  state.dbError = false; state.session = null; state.limits = []; state.blocked = ''; state.calls = []; state.queries = [];
});

describe('private support API', () => {
  it('creates using only a digest, accepts a fixed id for retries, and bounds bad input', async () => {
    const body = { id, secret, subject: '  Help  ', message_id: messageId, message: '  hello  ' };
    const response = await create(req('/api/support', body));
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toMatch(/no-store/);
    expect(state.calls[0]).toMatchObject({ name: 'create_support_ticket', args: { p_id: id, p_subject: 'Help', p_body: 'hello', p_message_id: messageId, p_secret_hash: createHash('sha256').update(secret).digest('hex') } });
    expect(JSON.stringify(state.calls)).not.toContain(secret);
    expect((await create(req('/api/support', { ...body, secret: 'weak' }))).status).toBe(422);
    state.blocked = 'support_create';
    expect((await create(req('/api/support', body))).status).toBe(429);
  });
  it('requires the private code before exposing or modifying any message', async () => {
    const read = (credential: string) => conversation(req('/api/support/conversation', { action: 'read', id, secret: credential }));
    const denied = await read(wrong);
    expect(denied.status).toBe(404);
    expect(state.queries).toEqual(['support_tickets']);
    expect(state.calls).toHaveLength(0);
    state.queries = [];
    const ok = await read(secret);
    const result = await ok.json();
    expect(ok.status).toBe(200);
    expect(result.messages).toEqual(state.rows);
    expect(JSON.stringify(result)).not.toContain(secret);
    expect(JSON.stringify(result)).not.toContain('secret_hash');
    expect(ok.headers.get('cache-control')).toMatch(/no-store/);
    state.row = null;
    expect((await read(secret)).status).toBe(404);
    state.dbError = true;
    expect((await read(secret)).status).toBe(503);
  });
  it('bounds replies by network and ticket after authorization, preserving the retry ID', async () => {
    const body = { action: 'reply', id, secret, message_id: messageId, message: ' More details ' };
    state.blocked = 'ticket';
    expect((await conversation(req('/api/support/conversation', body))).status).toBe(429);
    expect(state.calls).toHaveLength(0);
    state.blocked = ''; state.limits = [];
    expect((await conversation(req('/api/support/conversation', body))).status).toBe(200);
    expect(state.limits).toEqual(['support_access', 'support_message', 'ticket']);
    expect(state.calls[0]).toMatchObject({ name: 'append_support_message', args: { p_ticket_id: id, p_message_id: messageId, p_sender: 'customer', p_actor_id: null, p_body: 'More details' } });
  });
  it('restricts inbox, message reads and replies to authenticated platform admins', async () => {
    const get = new Request('https://printly.test/api/admin/support');
    expect((await inbox(get)).status).toBe(403);
    expect((await adminRead(get, params)).status).toBe(403);
    expect((await adminAct(req('/api/admin/support/x', { action: 'reply', message_id: messageId, message: 'hello' }), params)).status).toBe(403);
    expect(state.queries).toHaveLength(0);
    state.session = { user: { id: '33333333-3333-4333-8333-333333333333' }, profile: { role: 'shop_staff' } };
    expect((await inbox(get)).status).toBe(403);
    state.session.profile.role = 'admin';
    expect((await inbox(get)).status).toBe(200);
    expect((await adminRead(get, params)).status).toBe(200);
    const posted = await adminAct(req('/api/admin/support/x', { action: 'reply', message_id: messageId, message: 'hello' }), params);
    expect(posted.status).toBe(200);
    expect(state.calls.at(-1)?.args).toMatchObject({ p_sender: 'admin', p_actor_id: state.session.user.id, p_ticket_id: id });
    expect((await adminAct(req('/api/admin/support/x', { action: 'close' }), params)).status).toBe(422);
  });
});
