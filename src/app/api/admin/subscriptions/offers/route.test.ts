import { beforeEach, describe, expect, it, vi } from 'vitest';

const adminId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const promoId = '11111111-1111-4111-8111-111111111111';
const state = vi.hoisted(() => ({ role: 'admin', signedIn: true, calls: [] as Array<{ name: string; args: Record<string, unknown> }>, error: null as null | { message: string; code?: string } }));
vi.mock('@/lib/api', async (original) => ({ ...await original<typeof import('@/lib/api')>(), getSessionProfile: async () => state.signedIn ? ({ user: { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }, profile: { role: state.role } }) : null }));
vi.mock('@/lib/supabase', () => ({ createAdminSupabase: () => ({ rpc: async (name: string, args: Record<string, unknown>) => {
  state.calls.push({ name, args });
  return { data: state.error ? null : name === 'admin_subscription_offers' ? { promos: [], announcements: [], promos_has_more: false, announcements_has_more: false } : { id: promoId }, error: state.error };
} }) }));
import { GET, POST } from './route';

const promo = { code: 'thanks25', discount_type: 'percent', discount_value: 25, terms: ['monthly', 'yearly'], starts_at: null, ends_at: null, max_uses: 50, max_uses_per_shop: 1, enabled: true };
const announcement = { title: ' A shop offer ', message: ' An update for you. ', promo_code: ' thanks25 ', starts_at: '2030-01-01T00:00:00Z', ends_at: '2031-01-01T00:00:00Z', enabled: true, public_visible: true };
const request = (body: unknown) => new Request('https://printly.test/api/admin/subscriptions/offers', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const getRequest = (query = '') => new Request(`https://printly.test/api/admin/subscriptions/offers${query}`);
const newPromo = (value: Record<string, unknown> = {}) => ({ action: 'save_promo', id: null, expected_version: null, promo: { ...promo, ...value } });
beforeEach(() => { state.role = 'admin'; state.signedIn = true; state.calls = []; state.error = null; });

describe('admin subscription offers API', () => {
  it('requires an admin for listing and writes', async () => {
    state.signedIn = false;
    expect((await GET(getRequest())).status).toBe(403);
    state.signedIn = true; state.role = 'shop_staff';
    expect((await GET(getRequest())).status).toBe(403);
    expect((await POST(request(newPromo()))).status).toBe(403);
    expect(state.calls).toEqual([]);
  });
  it('lists with the authenticated actor and no-store', async () => {
    const result = await GET(getRequest());
    expect(result.status).toBe(200); expect(result.headers.get('cache-control')).toContain('no-store');
    expect(state.calls[0]).toEqual({ name: 'admin_subscription_offers', args: { p_actor: adminId, p_promo_page: 0, p_announcement_page: 0 } });
  });
  it('validates independent admin list pages before querying', async () => {
    expect((await GET(getRequest('?promo_page=2&announcement_page=1'))).status).toBe(200);
    expect(state.calls[0]).toEqual({ name: 'admin_subscription_offers', args: { p_actor: adminId, p_promo_page: 2, p_announcement_page: 1 } });
    for (const query of ['?promo_page=-1', '?announcement_page=1.5', '?promo_page=10001', '?promo_page=abc']) {
      expect((await GET(getRequest(query))).status).toBe(422);
    }
    expect(state.calls).toHaveLength(1);
  });
  it('validates a code and forwards only the server-authenticated admin', async () => {
    const response = await POST(request(newPromo()));
    expect(response.status).toBe(200);
    expect(state.calls[0]).toEqual({ name: 'save_subscription_promo', args: { p_actor: adminId, p_id: null, p_expected_version: null, p_input: { ...promo, code: 'THANKS25' } } });
    expect((await POST(request({ ...newPromo(), actor: 'forged' }))).status).toBe(422);
    const fixed = await POST(request(newPromo({ code: 'FIXED', discount_type: 'fixed', discount_value: 2500, max_uses: null, max_uses_per_shop: null })));
    expect(fixed.status).toBe(200);
    expect(state.calls[1].args.p_input).toMatchObject({ code: 'FIXED', discount_type: 'fixed', discount_value: 2500 });
  });
  it('rejects malformed discounts, terms, limits, dates, extra fields and incomplete edit versions', async () => {
    for (const value of [
      { code: 'bad code' }, { discount_value: 101 }, { discount_value: 0 }, { discount_value: 1.5 },
      { terms: [] }, { terms: ['monthly', 'monthly'] }, { max_uses: 0 }, { max_uses_per_shop: -1 },
      { starts_at: '2031-01-01T00:00:00Z', ends_at: '2030-01-01T00:00:00Z' }, { starts_at: 'not a date' }, { amount_paise: 1 },
    ]) expect((await POST(request(newPromo(value)))).status).toBe(422);
    expect((await POST(request({ ...newPromo(), id: promoId }))).status).toBe(422);
    expect((await POST(request({ ...newPromo(), expected_version: 1 }))).status).toBe(422);
    expect(state.calls).toEqual([]);
  });
  it('saves a scheduled public announcement and protects edits with a version', async () => {
    const response = await POST(request({ action: 'save_announcement', id: promoId, expected_version: 4, announcement }));
    expect(response.status).toBe(200);
    expect(state.calls[0]).toEqual({ name: 'save_subscription_announcement', args: { p_actor: adminId, p_id: promoId, p_expected_version: 4,
      p_input: { ...announcement, title: 'A shop offer', message: 'An update for you.', promo_code: 'THANKS25' } } });
    state.error = { message: 'OFFER_CHANGED' };
    const stale = await POST(request({ action: 'save_announcement', id: promoId, expected_version: 4, announcement }));
    expect(stale.status).toBe(409); expect((await stale.json()).error.code).toBe('offer_changed');
    expect((await POST(request({ action: 'save_announcement', id: null, expected_version: null, announcement: { ...announcement, title: ' ' } }))).status).toBe(422);
    expect((await POST(request({ action: 'save_announcement', id: null, expected_version: null, announcement: { ...announcement, promo_code: 'bad code' } }))).status).toBe(422);
    expect((await POST(request({ action: 'save_announcement', id: null, expected_version: null, announcement: { ...announcement, promo_code: undefined, promo_id: promoId } }))).status).toBe(422);
  });
  it('reports duplicate codes without exposing the database', async () => {
    state.error = { code: '23505', message: 'duplicate key value violates unique constraint "subscription_promos_code_key"' };
    const response = await POST(request(newPromo()));
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code: 'promo_exists' } });
  });
});
