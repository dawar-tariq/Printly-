import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase', () => ({ createAdminSupabase: () => ({ rpc: state.rpc }) }));
import { getPublicSubscriptionAnnouncements } from './subscription-offers-server';

beforeEach(() => { vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://test.supabase.co'); vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'secret'); state.rpc.mockReset(); });
afterEach(() => vi.unstubAllEnvs());
describe('public subscription announcements', () => {
  it('asks for public-only data and strips unexpected administrative fields', async () => {
    state.rpc.mockResolvedValue({ data: [{ id: '11111111-1111-4111-8111-111111111111', title: 'Offer', message: 'Hello', ends_at: null, extra: 'secret',
      promo: { code: 'SAVE10', discount_type: 'percent', discount_value: 10, terms: ['monthly'], ends_at: null, created_by: 'private' } }], error: null });
    const result = await getPublicSubscriptionAnnouncements();
    expect(state.rpc).toHaveBeenCalledWith('visible_subscription_announcements', { p_public_only: true });
    expect(result?.[0].promo?.code).toBe('SAVE10');
    expect(JSON.stringify(result)).not.toMatch(/secret|private|created_by/);
  });
  it('returns unavailable rather than claiming no offers when data is malformed or the database fails', async () => {
    state.rpc.mockResolvedValue({ data: [{ title: 'bad' }], error: null });
    expect(await getPublicSubscriptionAnnouncements()).toBeNull();
    state.rpc.mockResolvedValue({ data: null, error: { message: 'unavailable' } });
    expect(await getPublicSubscriptionAnnouncements()).toBeNull();
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', '');
    expect(await getPublicSubscriptionAnnouncements()).toBeNull();
  });
});
