import { beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ failed: '', authorized: true }));
vi.mock('@/lib/api', () => ({
  getStaffContext: async () => state.authorized ? { user: { id: 'owner' }, isAdmin: false, shopIds: ['shop'] } : null,
  jsonOk: (value: unknown, init: ResponseInit = {}) => Response.json(value, init),
  jsonError: (status: number, code: string, message: string) => Response.json({ error: { code, message } }, { status }),
}));
vi.mock('@/lib/supabase', () => ({ createAdminSupabase: () => ({ from: (table: string) => {
  const result = () => ({ data: table === 'shops' ? { id: 'shop', owner_id: 'owner' } : table === 'shop_services' ? [] : null, error: state.failed === table ? { code: 'DB' } : null });
  const query = { select: () => query, eq: () => query, order: () => query, single: async () => result(), maybeSingle: async () => result(), then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => Promise.resolve(result()).then(resolve, reject) };
  return query;
} }) }));
import { GET } from './native-me';
beforeEach(() => { state.failed = ''; state.authorized = true; });
describe('native shop context', () => {
  it('returns complete data for an active member', async () => {
    const response = await GET(); expect(response.status).toBe(200); expect((await response.json()).is_owner).toBe(true);
  });
  it('fails closed if a shop, services or onboarding read fails', async () => {
    for (const table of ['shops', 'shop_services', 'shop_onboarding']) { state.failed = table; expect((await GET()).status, table).toBe(503); }
  });
  it('rejects missing membership', async () => { state.authorized = false; expect((await GET()).status).toBe(403); });
});
