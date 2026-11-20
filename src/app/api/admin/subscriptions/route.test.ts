import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  role: 'admin', rpcs: [] as Array<{ name: string; args: Record<string, unknown> }>, error: null as null | { message: string },
}));
vi.mock('@/lib/api', async (original) => ({ ...await original<typeof import('@/lib/api')>(), getSessionProfile: async () => ({ user: { id: 'admin-user' }, profile: { role: state.role } }) }));
vi.mock('@/lib/supabase', () => ({ createAdminSupabase: () => ({
  rpc: async (name: string, args: Record<string, unknown>) => { state.rpcs.push({ name, args }); return { data: state.error ? null : { status: 'approved' }, error: state.error }; },
}) }));
import { PUT } from './route';
import { POST as review } from './review/route';
import { POST as permanent } from './permanent/route';

const id = '11111111-1111-4111-8111-111111111111';
const request = (body: unknown, method = 'POST') => new Request('https://printly.test/api', { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
beforeEach(() => { state.role = 'admin'; state.rpcs = []; state.error = null; });

describe('admin subscription APIs', () => {
  it('forbids non-admins from changing settings, granting access, or reviewing a claim', async () => {
    state.role = 'shop_staff';
    expect((await PUT(request({ expected_version: 0, monthly_paise: 100 }, 'PUT'))).status).toBe(403);
    expect((await review(request({ purchase_id: id, action: 'approve' }))).status).toBe(403);
    expect((await permanent(request({ shop_id: id, enabled: true }))).status).toBe(403);
    expect(state.rpcs).toEqual([]);
  });
  it('validates prices, UPI, reminders, version, and rejects legacy commission fields', async () => {
    for (const input of [{ monthly_paise: 0 }, { yearly_paise: 12.5 }, { upi_id: 'invalid' }, { warning_days: 31 }, { commission_bps: 800 }]) {
      expect((await PUT(request({ expected_version: 0, ...input }, 'PUT'))).status).toBe(422);
    }
    expect((await PUT(request({ monthly_paise: 100 }, 'PUT'))).status).toBe(422);
    expect((await PUT(request({ expected_version: 0 }, 'PUT'))).status).toBe(422);
    expect(state.rpcs).toEqual([]);
    const res = await PUT(request({ expected_version: 2, monthly_paise: 12500, six_months_paise: null, upi_id: ' printly@bank ', payee_name: ' Printly ', warning_days: 10 }, 'PUT'));
    expect(res.status).toBe(200);
    expect(state.rpcs[0]).toEqual({ name: 'update_subscription_plan', args: { p_expected_version: 2, p_changes: { monthly_paise: 12500, six_months_paise: null, upi_id: 'printly@bank', payee_name: 'Printly', warning_days: 10 }, p_actor: 'admin-user' } });
    state.error = { message: 'SETTINGS_CHANGED' };
    expect((await PUT(request({ expected_version: 2, monthly_paise: 100 }, 'PUT'))).status).toBe(409);
  });
  it('passes only a validated decision and the authenticated admin identity to the review RPC', async () => {
    expect((await review(request({ purchase_id: 'bad', action: 'approve' }))).status).toBe(422);
    const result = await review(request({ purchase_id: id, action: 'approve', note: ' verified ', actor: 'forged' }));
    expect(result.status).toBe(200);
    expect(state.rpcs[0]).toEqual({ name: 'review_subscription_purchase', args: { p_purchase_id: id, p_actor: 'admin-user', p_action: 'approve', p_note: 'verified' } });
    state.error = { message: 'REASON_REQUIRED' };
    expect((await review(request({ purchase_id: id, action: 'reject' }))).status).toBe(422);
  });
  it('grants or revokes permanent access without a purchase and reports database failures', async () => {
    expect((await permanent(request({ shop_id: id, enabled: true, note: ' family ' }))).status).toBe(200);
    expect(state.rpcs[0]).toEqual({ name: 'set_shop_permanent_subscription', args: { p_shop_id: id, p_actor: 'admin-user', p_enabled: true, p_note: 'family' } });
    state.error = { message: 'database unavailable' };
    expect((await permanent(request({ shop_id: id, enabled: false }))).status).toBe(503);
  });
});
