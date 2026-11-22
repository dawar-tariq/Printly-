import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ staff: vi.fn(), readShop: vi.fn(), rpc: vi.fn(), upload: vi.fn(), remove: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/api', () => ({
  getStaffContext: mocks.staff,
  jsonOk: (data: unknown) => Response.json(data),
  jsonError: (status: number, code: string, message: string) => Response.json({ error: { code, message } }, { status }),
}));
vi.mock('@/lib/supabase', () => ({ createAdminSupabase: () => ({
  from: () => ({ select: () => ({ eq: () => ({ maybeSingle: mocks.readShop }) }) }),
  rpc: mocks.rpc,
  storage: { from: () => ({ upload: mocks.upload, remove: mocks.remove }) },
}) }));
import { POST } from './route';
const req = (body: unknown) => new Request('http://localhost/proof', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.staff.mockResolvedValue({ user: { id: 'owner-id' }, shopIds: ['shop-id'], isAdmin: false });
  mocks.readShop.mockResolvedValue({ data: { owner_id: 'owner-id' } });
  mocks.rpc.mockResolvedValue({ data: { old_photo_path: 'shop-id/old.jpg' }, error: null });
  mocks.upload.mockResolvedValue({ error: null });
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
  it('keeps the newly uploaded evidence if the database response is lost', async () => {
    mocks.rpc.mockRejectedValueOnce(new Error('connection lost'));
    const form = new FormData();
    form.append('payload', '{}');
    form.append('proof', new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])], 'shop.png', { type: 'image/png' }));
    const response = await POST(new Request('http://localhost/proof', { method: 'POST', body: form }));
    expect(response.status).toBe(503);
    expect((await response.json()).error.code).toBe('proof_unconfirmed');
    expect(mocks.upload).toHaveBeenCalledOnce();
    expect(mocks.remove).not.toHaveBeenCalled();
  });
  it('cleans up the unused evidence after a definite database rejection', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: 'P0001', message: 'PROOF_ALREADY_APPROVED' } });
    const form = new FormData();
    form.append('payload', '{}');
    form.append('proof', new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])], 'shop.png', { type: 'image/png' }));
    const response = await POST(new Request('http://localhost/proof', { method: 'POST', body: form }));
    expect(response.status).toBe(409);
    expect(mocks.remove).toHaveBeenCalledOnce();
    expect(mocks.remove.mock.calls[0][0][0]).toMatch(/^shop-id\/.+\.png$/);
  });
});
