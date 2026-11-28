import { expect, it, vi } from 'vitest';
vi.mock('@/lib/supabase', () => ({ createServerSupabase: async () => ({}), createAdminSupabase: () => ({}) }));
vi.mock('@/lib/public-shop', () => ({ findPublicShop: async () => ({ shop: null, error: { code: 'XX000', message: 'sensitive internal database diagnostic' } }) }));
vi.mock('@/lib/subscription-server', () => ({ shopHasSubscription: vi.fn() }));
import { GET } from './route';

it('does not return database diagnostics from a public shop lookup', async () => {
  const response = await GET(new Request('https://printly.test/api/shops/example/public'), { params: Promise.resolve({ slug: 'example' }) });
  expect(response.status).toBe(503);
  expect(JSON.stringify(await response.json())).not.toContain('sensitive internal');
});
