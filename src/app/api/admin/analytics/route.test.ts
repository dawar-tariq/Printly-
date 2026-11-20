import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ role: 'admin', subscriptionError: false }));
vi.mock('@/lib/api', async (original) => ({ ...await original<typeof import('@/lib/api')>(), getSessionProfile: async () => ({ profile: { role: state.role } }) }));
vi.mock('@/lib/supabase', () => ({ createAdminSupabase: () => ({
  from: (table: string) => ({ select: () => ({
    order: () => ({ limit: async () => ({ data: [{ total_paise: 1200, payment_status: 'confirmed', created_at: new Date().toISOString() }, { total_paise: 3000, payment_status: 'pending', created_at: new Date().toISOString() }], error: null }) }),
    eq: async (key: string) => ({ count: table === 'subscription_purchases' ? 2 : table === 'disputes' ? 1 : key === 'status' ? 3 : 4, error: table === 'subscription_purchases' && state.subscriptionError ? { message: 'offline' } : null }),
  }) }),
}) }));
import { GET } from './route';
beforeEach(() => { state.role = 'admin'; state.subscriptionError = false; });

describe('admin overview with subscriptions', () => {
  it('shows pending reviews and paid GMV without commission totals', async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toMatchObject({ pending_subscriptions: 2, gmv_paise: 1200, paid_orders_count: 1, active_shops: 3 });
    expect(data).not.toHaveProperty('commission_paise');
  });
  it('does not report zero pending requests when the subscription database fails', async () => {
    state.subscriptionError = true;
    expect((await GET()).status).toBe(503);
    state.role = 'shop_staff';
    expect((await GET()).status).toBe(403);
  });
});
