import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ staff: vi.fn(), rpc: vi.fn(), upload: vi.fn(), remove: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/api', () => ({
  getStaffContext: mocks.staff,
  jsonOk: (data: unknown) => Response.json(data),
  jsonError: (status: number, code: string, message: string) => Response.json({ error: { code, message } }, { status }),
}));
vi.mock('@/lib/supabase', () => ({ createAdminSupabase: () => ({ rpc: mocks.rpc, storage: { from: () => ({ upload: mocks.upload, remove: mocks.remove }) } }) }));
import { PUT } from './route';

function request() {
  const form = new FormData();
  form.append('payload', JSON.stringify({ name: 'Print Shop' }));
  form.append('proof', new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])], 'shop.png', { type: 'image/png' }));
  return new Request('http://localhost/api/shop/settings', { method: 'PUT', body: form });
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.staff.mockResolvedValue({ user: { id: 'owner-id' }, shopIds: ['shop-id'], isAdmin: false });
  mocks.upload.mockResolvedValue({ error: null }); mocks.remove.mockResolvedValue({ error: null });
  mocks.rpc.mockResolvedValue({ data: { duplicate_name: true, name_changed: true, old_photo_path: 'shop-id/old.png' }, error: null });
});
describe('updating shop details with name evidence', () => {
  it('keeps submitted evidence if the response is lost after a possible commit', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: 'PGRST003', message: 'connection lost' } });
    const response = await PUT(request());
    expect(response.status).toBe(503);
    expect((await response.json()).error.code).toBe('update_unconfirmed');
    expect(mocks.upload).toHaveBeenCalledOnce();
    expect(mocks.remove).not.toHaveBeenCalled();
  });
  it('removes unused evidence only after a definite database rejection', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: 'P0001', message: 'DUPLICATE_NAME_PROOF_REQUIRED' } });
    const response = await PUT(request());
    expect(response.status).toBe(409);
    expect(mocks.remove).toHaveBeenCalledOnce();
    expect(mocks.remove.mock.calls[0][0][0]).toMatch(/^shop-id\/.+\.png$/);
  });
  it('removes only the superseded photo after a confirmed update', async () => {
    expect((await PUT(request())).status).toBe(200);
    expect(mocks.remove).toHaveBeenCalledWith(['shop-id/old.png']);
    expect(mocks.remove).toHaveBeenCalledOnce();
  });
});
