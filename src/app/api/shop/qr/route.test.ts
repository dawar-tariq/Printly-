import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PNG } from 'pngjs';
import jsQR from 'jsqr';
import sharp from 'sharp';

const mocks = vi.hoisted(() => ({ staff: vi.fn(), shop: vi.fn() }));
vi.mock('@/lib/api', () => ({
  getStaffContext: mocks.staff,
  jsonError: (status: number, code: string, message: string) => Response.json({ error: { code, message } }, { status }),
}));
vi.mock('@/lib/supabase', () => ({
  createAdminSupabase: () => ({ from: () => ({ select: () => ({ eq: () => ({ single: mocks.shop }) }) }) }),
}));
import { GET } from './route';

function decode(bytes: Buffer) {
  const png = PNG.sync.read(bytes);
  return jsQR(new Uint8ClampedArray(png.data), png.width, png.height)?.data;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.staff.mockResolvedValue({ shopIds: ['shop-1'] });
  mocks.shop.mockResolvedValue({ data: { slug: 'old-name-link', short_code: 'AB234567', name: 'Bright Prints' } });
  vi.stubEnv('PRINTLY_REDIS_REST_URL', '');
  vi.stubEnv('PRINTLY_REDIS_REST_TOKEN', '');
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe('branded shop QR code', () => {
  it('encodes the unique shop link, includes the brand, and stays decodable at preview size', async () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://printly.example/');
    const response = await GET(new Request('https://printly.example/api/shop/qr?download=1'));
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('image/png');
    expect(response.headers.get('Cache-Control')).toContain('no-store');
    expect(response.headers.get('Content-Disposition')).toContain('printly-qr-AB234567.png');
    const bytes = Buffer.from(await response.arrayBuffer());
    const png = PNG.sync.read(bytes);
    expect([png.width, png.height]).toEqual([640, 640]);
    expect(decode(bytes)).toBe('https://printly.example/s/p-ab234567');
    expect(decode(await sharp(bytes).resize(160, 160).png().toBuffer())).toBe('https://printly.example/s/p-ab234567');
    expect(decode(await sharp(bytes).greyscale().png().toBuffer())).toBe('https://printly.example/s/p-ab234567');
    // The badge is not merely adjacent to the code: the selected orange mark is in its centre.
    let orange = 0;
    for (let y = 280; y < 360; y++) for (let x = 280; x < 360; x++) {
      const index = (y * png.width + x) * 4;
      if (png.data[index] > 180 && png.data[index + 1] < 120 && png.data[index + 2] < 80) orange++;
    }
    expect(orange).toBeGreaterThan(300);
    // The four-module quiet zone starts pure white even on the download.
    expect(Array.from(png.data.slice(0, 4))).toEqual([255, 255, 255, 255]);
  });

  it('never uses a caller-controlled host when the canonical site URL is missing or invalid', async () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', '');
    expect((await GET(new Request('https://attacker.example/api/shop/qr'))).status).toBe(503);
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://trusted.example/path');
    expect((await GET(new Request('https://attacker.example/api/shop/qr'))).status).toBe(503);
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://trusted.example');
    const response = await GET(new Request('https://attacker.example/api/shop/qr'));
    expect(decode(Buffer.from(await response.arrayBuffer()))).toBe('https://trusted.example/s/p-ab234567');
  });

  it('reuses only the authenticated shop’s public QR and still checks membership on each hit', async () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://printly.example');
    vi.stubEnv('PRINTLY_REDIS_REST_URL', 'https://sample.upstash.io');
    vi.stubEnv('PRINTLY_REDIS_REST_TOKEN', 'test-token');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-signing-key');
    const values = new Map<string, string>();
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      const args = JSON.parse(String(init?.body)) as string[];
      if (args[0] === 'SET') { values.set(args[1], args[2]); return Response.json({ result: 'OK' }); }
      return Response.json({ result: values.get(args[1]) ?? null });
    }));
    const request = new Request('https://printly.example/api/shop/qr');
    const first = await GET(request);
    const second = await GET(request);
    expect(decode(Buffer.from(await first.arrayBuffer()))).toBe('https://printly.example/s/p-ab234567');
    expect(decode(Buffer.from(await second.arrayBuffer()))).toBe('https://printly.example/s/p-ab234567');
    expect(fetch).toHaveBeenCalledTimes(3); // miss, write, hit
    expect(mocks.staff).toHaveBeenCalledTimes(2);
    expect(mocks.shop).toHaveBeenCalledTimes(2);
    mocks.staff.mockResolvedValue({ shopIds: [] });
    expect((await GET(request)).status).toBe(403);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('denies a user with no linked shop', async () => {
    mocks.staff.mockResolvedValue({ shopIds: [] });
    const response = await GET(new Request('https://printly.example/api/shop/qr'));
    expect(response.status).toBe(403);
    expect(mocks.shop).not.toHaveBeenCalled();
  });
});
