import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ result: { data: null as null | Record<string, unknown>, error: null as null | object }, columns: '' }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase', () => ({ createAdminSupabase: () => ({ from: () => ({ select: (columns: string) => {
  state.columns = columns;
  return { eq: () => ({ maybeSingle: async () => state.result }) };
} }) }) }));
import { getPublicPricing } from './public-pricing';

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://project.supabase.co');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'secret');
  state.columns = '';
  state.result = { data: { monthly_paise: 1500, six_months_paise: 8000, yearly_paise: 15000, upi_id: 'private@example' }, error: null };
});
afterEach(() => vi.unstubAllEnvs());
describe('public subscription pricing', () => {
  it('selects and returns only the three price fields', async () => {
    expect(await getPublicPricing()).toEqual({ monthly_paise: 1500, six_months_paise: 8000, yearly_paise: 15000 });
    expect(state.columns).toBe('monthly_paise, six_months_paise, yearly_paise');
  });
  it('does not publish malformed or missing amounts', async () => {
    state.result.data = { monthly_paise: -1, six_months_paise: null, yearly_paise: 3.5 };
    expect(await getPublicPricing()).toEqual({ monthly_paise: null, six_months_paise: null, yearly_paise: null });
  });
  it('returns unavailable when configuration or the database cannot be read', async () => {
    state.result.error = { message: 'unavailable' };
    expect(await getPublicPricing()).toBeNull();
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', '');
    expect(await getPublicPricing()).toBeNull();
  });
});
