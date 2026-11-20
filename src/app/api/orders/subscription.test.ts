import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ status: 'active', subscribed: true as boolean | null, insertError: '', inserts: 0 }));
vi.mock('@/lib/public-shop', () => ({ findPublicShop: async () => ({ data: { id: 'shop', status: state.status }, error: null }) }));
vi.mock('@/lib/subscription-server', () => ({ shopHasSubscription: async () => state.subscribed }));
vi.mock('@/lib/draft-access', () => ({ setDraftCookie: vi.fn() }));
vi.mock('@/lib/rate-limit', () => ({ enforcePublicRateLimit: async () => null }));
vi.mock('@/lib/supabase', () => ({ createAdminSupabase: () => ({ from: () => ({
  insert: () => { state.inserts++; return { select: () => ({ single: async () => ({ data: state.insertError ? null : { id: 'order' }, error: state.insertError ? { message: state.insertError } : null }) }) }; },
}) }) }));
import { POST } from './route';
const request = () => new Request('https://printly.test/api/orders', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ shop_slug: 'demo' }) });
beforeEach(() => { state.status = 'active'; state.subscribed = true; state.insertError = ''; state.inserts = 0; });

describe('subscription gating for customer orders', () => {
  it('does not create a draft for an expired shop or when the entitlement cannot be checked', async () => {
    state.subscribed = false; expect((await POST(request())).status).toBe(403);
    state.subscribed = null; expect((await POST(request())).status).toBe(503);
    expect(state.inserts).toBe(0);
  });
  it('handles expiry between the application check and the database insert', async () => {
    state.insertError = 'SHOP_UNAVAILABLE';
    const res = await POST(request());
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe('shop_unavailable');
  });
  it('still creates a draft for an active subscribed shop', async () => {
    expect((await POST(request())).status).toBe(200);
    expect(state.inserts).toBe(1);
  });
});
