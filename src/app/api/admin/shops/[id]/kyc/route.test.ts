import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ session: vi.fn(), readShop: vi.fn(), readProof: vi.fn(), updateShop: vi.fn(), upsertStaff: vi.fn(), upsertOnboarding: vi.fn() }));
vi.mock('@/lib/api', () => ({
  getSessionProfile: mocks.session,
  jsonOk: (data: unknown) => Response.json(data),
  jsonError: (status: number, code: string, message: string) => Response.json({ error: { code, message } }, { status }),
}));
vi.mock('@/lib/supabase', () => ({ createAdminSupabase: () => ({
  from: (table: string) => {
    if (table === 'shops') return {
      select: () => ({ eq: () => ({ maybeSingle: mocks.readShop }) }),
      update: mocks.updateShop,
    };
    if (table === 'shop_onboarding') return { select: () => ({ eq: () => ({ maybeSingle: mocks.readProof }) }), upsert: mocks.upsertOnboarding };
    if (table === 'shop_staff') return { upsert: mocks.upsertStaff };
    throw new Error('Unexpected table');
  },
}) }));
import { POST } from './route';

const params = { params: Promise.resolve({ id: 'shop-id' }) };
const request = (payload: unknown) => new Request('http://localhost/kyc', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.session.mockResolvedValue({ user: { id: 'admin-id' }, profile: { role: 'admin' } });
  mocks.readShop.mockResolvedValue({ data: { id: 'shop-id', owner_id: 'owner-id', kyc_status: 'pending', updated_at: '2026-01-01T00:00:00Z' } });
  mocks.readProof.mockResolvedValue({ data: { duplicate_name: true, name_proof_gstin: '01ABCDE1234F1Z5', name_proof_photo_path: null }, error: null });
  mocks.updateShop.mockReturnValue({ eq: () => ({ eq: () => ({ select: () => ({ maybeSingle: async () => ({ data: { id: 'shop-id' }, error: null }) }) }) }) });
  mocks.upsertStaff.mockResolvedValue({ error: null });
  mocks.upsertOnboarding.mockResolvedValue({ error: null });
});

describe('duplicate-name approval', () => {
  it('requires an administrator', async () => {
    mocks.session.mockResolvedValue({ profile: { role: 'shop_staff' } });
    expect((await POST(request({ action: 'approve' }), params)).status).toBe(403);
  });
  it('requires an explicit review of duplicate-name evidence', async () => {
    const response = await POST(request({ action: 'approve' }), params);
    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe('proof_review_required');
    expect(mocks.updateShop).not.toHaveBeenCalled();
  });
  it('rejects approval if the proof is missing even with confirmation', async () => {
    mocks.readProof.mockResolvedValue({ data: { duplicate_name: true, name_proof_gstin: null, name_proof_photo_path: null }, error: null });
    const response = await POST(request({ action: 'approve', proof_reviewed: true }), params);
    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe('proof_missing');
  });
  it('allows approval after evidence was reviewed', async () => {
    const response = await POST(request({ action: 'approve', proof_reviewed: true }), params);
    expect(response.status).toBe(200);
    expect(mocks.updateShop).toHaveBeenCalledWith(expect.objectContaining({ kyc_status: 'approved', status: 'active' }));
  });
  it('detects a shop changed during the review', async () => {
    mocks.updateShop.mockReturnValue({ eq: () => ({ eq: () => ({ select: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }) });
    const response = await POST(request({ action: 'approve', proof_reviewed: true }), params);
    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe('shop_changed');
  });
});
