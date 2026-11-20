import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ staff: vi.fn(), readShop: vi.fn(), rpc: vi.fn(), remove: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/api', () => ({
  getStaffContext: mocks.staff,
  jsonOk: (data: unknown) => Response.json(data),
  jsonError: (status: number, code: string, message: string) => Response.json({ error: { code, message } }, { status }),
}));
vi.mock('@/lib/supabase', () => ({ createAdminSupabase: () => ({
  from: () => ({ select: () => ({ eq: () => ({ maybeSingle: mocks.readShop }) }) }),
  rpc: mocks.rpc,
  storage: { from: () => ({ remove: mocks.remove }) },
}) }));
import { POST } from './route';
const req = (body: unknown) => new Request('http://localhost/proof', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.staff.mockResolvedValue({ user: { id: 'owner-id' }, shopIds: ['shop-id'], isAdmin: false });
  mocks.readShop.mockResolvedValue({ data: { owner_id: 'owner-id' } });
  mocks.rpc.mockResolvedValue({ data: { old_photo_path: 'shop-id/old.jpg' }, error: null });
  mocks.remove.mockResolvedValue({ error: null });
});

describe('resubmitting name proof', () => {
  it('does not let a different staff member submit as owner', async () => {
    mocks.readShop.mockResolvedValue({ data: { owner_id: 'someone-else' } });
    expect((await POST(req({ gstin: '01ABCDE1234F1Z5' }))).status).toBe(403);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('requires a photo or a GSTIN', async () => {
    expect((await POST(req({ gstin: 'fake' }))).status).toBe(422);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('submits evidence for review and removes the superseded private photo', async () => {
    expect((await POST(req({ gstin: '01ABCDE1234F1Z5' }))).status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith('resubmit_shop_name_proof', { p_shop_id: 'shop-id', p_gstin: '01ABCDE1234F1Z5', p_photo_path: null });
    expect(mocks.remove).toHaveBeenCalledWith(['shop-id/old.jpg']);
  });
});
