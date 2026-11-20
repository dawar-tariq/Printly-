import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  staff: vi.fn(), shop: vi.fn(), toBuffer: vi.fn(),
}));
vi.mock('@/lib/api', () => ({
  getStaffContext: mocks.staff,
  jsonError: (status: number, code: string, message: string) => Response.json({ error: { code, message } }, { status }),
}));
vi.mock('@/lib/supabase', () => ({
  createAdminSupabase: () => ({ from: () => ({ select: () => ({ eq: () => ({ single: mocks.shop }) }) }) }),
}));
vi.mock('qrcode', () => ({ default: { toBuffer: mocks.toBuffer } }));
import { GET } from './route';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.staff.mockResolvedValue({ shopIds: ['shop-1'] });
  mocks.shop.mockResolvedValue({ data: { slug: 'old-name-link', short_code: 'AB234567', name: 'Bright Prints' } });
  mocks.toBuffer.mockResolvedValue(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
});
afterEach(() => vi.unstubAllEnvs());

describe('shop QR code', () => {
  it('encodes the unique code link instead of the name-based slug', async () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://printly.example/');
    const response = await GET(new Request('https://printly.example/api/shop/qr?download=1'));
    expect(response.status).toBe(200);
    expect(mocks.toBuffer).toHaveBeenCalledWith('https://printly.example/s/p-ab234567', expect.any(Object));
    expect(response.headers.get('Content-Type')).toBe('image/png');
    expect(response.headers.get('Content-Disposition')).toContain('printly-qr-AB234567.png');
  });
  it('denies a user with no linked shop', async () => {
    mocks.staff.mockResolvedValue({ shopIds: [] });
    const response = await GET(new Request('https://printly.example/api/shop/qr'));
    expect(response.status).toBe(403);
    expect(mocks.toBuffer).not.toHaveBeenCalled();
  });
});
