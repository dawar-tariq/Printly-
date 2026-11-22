import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ error: null as null | { code: string }, limit: vi.fn() }));
vi.mock('@/lib/rate-limit', () => ({ enforcePublicRateLimit: state.limit }));
vi.mock('@/lib/supabase', () => ({
  createServerSupabase: async () => ({ auth: { getUser: async () => ({ data: { user: null } }) } }),
  createAdminSupabase: () => ({ from: (table: string) => table === 'orders'
    ? { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: '11111111-1111-4111-8111-111111111111' } }) }) }) }
    : { insert: () => ({ select: () => ({ single: async () => ({ data: state.error ? null : { id: 'report' }, error: state.error }) }) }) },
  }),
}));
import { POST } from './route';

const request = () => new Request('https://printly.test/api/disputes', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ order_id: '11111111-1111-4111-8111-111111111111', type: 'other', description: 'Pages are missing' }) });
beforeEach(() => { state.error = null; state.limit.mockReset().mockResolvedValue(null); });
describe('order reports', () => {
  it('returns a clear conflict instead of claiming a duplicate report was received', async () => {
    state.error = { code: '23505' };
    const res = await POST(request());
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe('report_already_open');
  });
  it('accepts a new report when no active report exists', async () => {
    expect(await (await POST(request())).json()).toEqual({ ok: true, dispute_id: 'report' });
  });
});
