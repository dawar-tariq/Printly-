import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const rpc = vi.fn();
  const createUser = vi.fn();
  const deleteUser = vi.fn();
  const upload = vi.fn();
  const remove = vi.fn();
  return { rpc, createUser, deleteUser, upload, remove, admin: {
    rpc, auth: { admin: { createUser, deleteUser } }, storage: { from: () => ({ upload, remove }) },
  } };
});
vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase', () => ({ createAdminSupabase: () => mocks.admin }));
vi.mock('@/lib/api', () => ({
  jsonOk: (data: unknown) => Response.json(data),
  jsonError: (status: number, code: string, message: string) => Response.json({ error: { code, message } }, { status }),
}));
import { POST } from './route';

const base = { shop_name: 'Bright Prints', owner_name: 'Asha Khan', email: 'asha@example.com', password: 'password123', phone: '9906000000', address: 'Shop 4', city: 'Srinagar' };
function request(body: unknown) {
  return new Request('http://localhost/api/shop/signup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.createUser.mockResolvedValue({ data: { user: { id: 'b2222222-2222-4222-8222-222222222221' } }, error: null });
  mocks.deleteUser.mockResolvedValue({ error: null });
  mocks.upload.mockResolvedValue({ error: null });
  mocks.remove.mockResolvedValue({ error: null });
  mocks.rpc.mockImplementation(async (name: string, args: { p_shop?: { short_code: string } }) => {
    if (name === 'shop_name_exists') return { data: false, error: null };
    return { data: { short_code: args.p_shop!.short_code, duplicate_name: false }, error: null };
  });
});

describe('shop signup', () => {
  it('creates a unique-name application without proof and assigns a code URL', async () => {
    const response = await POST(request(base));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.customer_path).toBe(`/s/p-${body.short_code.toLowerCase()}`);
    expect(body.short_code).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);
    const params = mocks.rpc.mock.calls.find(([name]) => name === 'create_shop_application')![1];
    expect(params.p_photo_path).toBeNull();
    expect(params.p_shop.slug).not.toContain('bright');
    expect(params.p_services).toHaveLength(5);
  });

  it('rejects a duplicate without proof before creating an account', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: true, error: null });
    const response = await POST(request(base));
    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe('duplicate_name_requires_proof');
    expect(mocks.createUser).not.toHaveBeenCalled();
  });

  it('accepts a GSTIN for a duplicate but leaves it for admin review', async () => {
    mocks.rpc.mockImplementation(async (name: string, args: { p_shop?: { short_code: string } }) => name === 'shop_name_exists'
      ? { data: true, error: null } : { data: { short_code: args.p_shop!.short_code, duplicate_name: true }, error: null });
    const response = await POST(request({ ...base, gstin: '01abcde1234f1z5' }));
    expect(response.status).toBe(200);
    expect((await response.json()).duplicate_name).toBe(true);
    expect(mocks.upload).not.toHaveBeenCalled();
  });

  it('uploads a duplicate-name shop photo privately and links it to the new shop', async () => {
    mocks.rpc.mockImplementation(async (name: string, args: { p_shop?: { short_code: string } }) => name === 'shop_name_exists'
      ? { data: true, error: null } : { data: { short_code: args.p_shop!.short_code, duplicate_name: true }, error: null });
    const form = new FormData();
    form.append('payload', JSON.stringify(base));
    form.append('proof', new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])], 'shop.png', { type: 'image/png' }));
    const response = await POST(new Request('http://localhost/api/shop/signup', { method: 'POST', body: form }));
    expect(response.status).toBe(200);
    const params = mocks.rpc.mock.calls.find(([name]) => name === 'create_shop_application')![1];
    expect(params.p_photo_path).toMatch(new RegExp(`^${params.p_shop.id}/.+\\.png$`));
    expect(mocks.upload).toHaveBeenCalledOnce();
    expect(mocks.remove).not.toHaveBeenCalled();
  });

  it('cleans up the auth account when a simultaneous duplicate is detected', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: false, error: null }).mockResolvedValueOnce({ data: null, error: { code: 'P0001', message: 'DUPLICATE_NAME_PROOF_REQUIRED' } });
    const response = await POST(request(base));
    expect(response.status).toBe(409);
    expect(mocks.deleteUser).toHaveBeenCalledOnce();
  });

  it('retries a random code collision instead of linking to another shop', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: false, error: null })
      .mockResolvedValueOnce({ data: null, error: { code: '23505', message: 'duplicate key violates shops_short_code_key' } })
      .mockImplementationOnce(async (_name: string, args: { p_shop: { short_code: string } }) => ({ data: { short_code: args.p_shop.short_code, duplicate_name: false }, error: null }));
    const response = await POST(request(base));
    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledTimes(3);
    expect(mocks.deleteUser).not.toHaveBeenCalled();
  });
});
