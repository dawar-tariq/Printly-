import { beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ createAdminSupabase: () => ({ rpc: state.rpc }) }));
vi.mock('@/lib/rate-limit', () => ({ enforceTrackingRateLimit: async () => null }));
import { GET } from './route';

beforeEach(() => state.rpc.mockReset());
it('treats a malformed tracking ID as not found without querying the database', async () => {
  const response = await GET(new Request('https://printly.test/api/orders/not-an-id/track'), { params: Promise.resolve({ id: 'not-an-id' }) });
  expect(response.status).toBe(404);
  expect(state.rpc).not.toHaveBeenCalled();
});
it('does not return database diagnostics to a tracking-link holder', async () => {
  state.rpc.mockResolvedValue({ data: null, error: { code: 'XX000', message: 'sensitive internal database diagnostic' } });
  const id = '11111111-1111-4111-8111-111111111111';
  const response = await GET(new Request(`https://printly.test/api/orders/${id}/track`), { params: Promise.resolve({ id }) });
  expect(response.status).toBe(503);
  expect(JSON.stringify(await response.json())).not.toContain('sensitive internal');
});
