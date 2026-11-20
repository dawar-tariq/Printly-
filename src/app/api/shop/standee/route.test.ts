import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PNG } from 'pngjs';
import jsQR from 'jsqr';

const mocks = vi.hoisted(() => ({ staff: vi.fn() }));
vi.mock('@/lib/api', () => ({ getStaffContext: mocks.staff }));
import { GET } from './route';

const shops = {
  'shop-a': { id: 'shop-a', owner_id: 'owner-a', name: 'Bright Prints', short_code: 'AB1234', status: 'active', kyc_status: 'approved' },
  'shop-b': { id: 'shop-b', owner_id: 'owner-b', name: 'Bright Prints', short_code: 'CD5678', status: 'active', kyc_status: 'approved' },
};
const profiles = { 'owner-a': { full_name: 'Asha Khan' }, 'owner-b': { full_name: 'Rahul Singh' } };
let database: { shops: typeof shops; profiles: typeof profiles };
let queries: Array<[string, string, string]>;

function member(shopId: string) {
  const admin = { from: (table: 'shops' | 'profiles') => ({ select: () => ({ eq: (column: string, id: string) => ({
    maybeSingle: async () => {
      queries.push([table, column, id]);
      return { data: (database[table] as Record<string, unknown>)[id] ?? null, error: null };
    },
  }) }) }) };
  return { user: { id: 'staff-member-not-owner' }, isAdmin: false, shopIds: [shopId], admin };
}
function request(query = '') { return new Request(`https://attacker.example/api/shop/standee${query}`); }
function readQr(dataUrl: string) {
  const png = PNG.sync.read(Buffer.from(dataUrl.split(',')[1], 'base64'));
  return jsQR(new Uint8ClampedArray(png.data), png.width, png.height)?.data;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://printly.example');
  database = { shops: structuredClone(shops), profiles: structuredClone(profiles) };
  queries = [];
  mocks.staff.mockResolvedValue(member('shop-a'));
});
afterEach(() => vi.unstubAllEnvs());

describe('authenticated standee API', () => {
  it('rejects signed-out users, admins, and accounts without membership', async () => {
    for (const value of [null, { ...member('shop-a'), isAdmin: true }, { ...member('shop-a'), shopIds: [] }]) {
      mocks.staff.mockResolvedValue(value);
      const response = await GET(request('?format=preview&shop_id=shop-a'));
      expect(response.status).toBe(403);
      expect(response.headers.get('Cache-Control')).toContain('no-store');
    }
    expect(queries).toEqual([]);
  });

  it('derives each shop and its actual owner from membership, never the requested shop id or host', async () => {
    const a = await GET(request('?format=preview&shop_id=shop-b'));
    const aData = await a.json();
    expect(a.status).toBe(200);
    expect(a.headers.get('Cache-Control')).toContain('no-store');
    expect(aData.info).toMatchObject({ shop_name: 'Bright Prints', owner_name: 'Asha Khan', short_code: 'AB1234', order_url: 'https://printly.example/s/p-ab1234/order' });
    expect(readQr(aData.preview)).toBe(aData.info.order_url);
    expect(queries).toEqual([['shops', 'id', 'shop-a'], ['profiles', 'id', 'owner-a']]);
    expect(JSON.stringify(aData.info)).not.toContain('owner_id');

    mocks.staff.mockResolvedValue(member('shop-b'));
    const bData = await (await GET(request('?format=preview&shop_id=shop-a'))).json();
    expect(bData.info).toMatchObject({ owner_name: 'Rahul Singh', short_code: 'CD5678', order_url: 'https://printly.example/s/p-cd5678/order' });
    expect(readQr(bData.preview)).toBe(bData.info.order_url);
    expect(bData.revision).not.toBe(aData.revision);
    const denied = await GET(request(`?format=pdf&shop_id=shop-a&revision=${aData.revision}`));
    expect(denied.status).toBe(409);
    expect((await denied.json()).error.code).toBe('standee_changed');
    const ownPdf = await GET(request(`?format=pdf&revision=${bData.revision}`));
    expect(ownPdf.status).toBe(200);
    expect(ownPdf.headers.get('Content-Disposition')).toContain('CD5678.pdf');
    expect(ownPdf.headers.get('Content-Type')).toBe('application/pdf');
  }, 30_000);

  it('requires regeneration when saved shop or owner details change', async () => {
    const first = await (await GET(request('?format=preview'))).json();
    database.shops['shop-a'].name = 'Bright Prints Renamed';
    database.profiles['owner-a'].full_name = 'Asha Farooq';
    const stale = await GET(request(`?format=png&revision=${first.revision}`));
    expect(stale.status).toBe(409);
    expect(stale.headers.get('Cache-Control')).toContain('no-store');
    const next = await (await GET(request('?format=preview'))).json();
    expect(next.info.shop_name).toBe('Bright Prints Renamed');
    expect(next.info.owner_name).toBe('Asha Farooq');
    expect(next.revision).not.toBe(first.revision);
    expect(readQr(next.preview)).toBe(first.info.order_url);
    const pngResponse = await GET(request(`?format=png&revision=${next.revision}`));
    expect(pngResponse.status).toBe(200);
    expect(pngResponse.headers.get('Content-Type')).toBe('image/png');
    expect(pngResponse.headers.get('Content-Disposition')).toContain('AB1234.png');
    const png = PNG.sync.read(Buffer.from(await pngResponse.arrayBuffer()));
    expect([png.width, png.height]).toEqual([2480, 3508]);
    expect(jsQR(new Uint8ClampedArray(png.data), png.width, png.height)?.data).toBe(next.info.order_url);
  }, 30_000);

  it('produces a private print page containing the same high-resolution shop QR', async () => {
    const preview = await (await GET(request('?format=preview&theme=deep'))).json();
    const printed = await GET(request(`?format=print&theme=deep&revision=${preview.revision}`));
    expect(printed.status).toBe(200);
    expect(printed.headers.get('Content-Type')).toContain('text/html');
    expect(printed.headers.get('Cache-Control')).toContain('no-store');
    expect(printed.headers.get('Content-Security-Policy')).toContain("default-src 'none'");
    const html = await printed.text();
    expect(html).toContain('@page{size:A4 portrait;margin:0}');
    const dataUrl = html.match(/data:image\/png;base64,[A-Za-z0-9+/=]+/)?.[0];
    expect(dataUrl).toBeTruthy();
    expect(readQr(dataUrl!)).toBe(preview.info.order_url);
    const wrongTheme = await GET(request(`?format=print&theme=orange&revision=${preview.revision}`));
    expect(wrongTheme.status).toBe(409);
    expect(await wrongTheme.text()).toContain('Generate the standee again');
  }, 30_000);

  it('fails closed for unapproved colours, absent owner names and unsupported characters', async () => {
    expect((await GET(request('?theme=__proto__'))).status).toBe(400);
    expect((await GET(request('?format=svg'))).status).toBe(400);
    database.profiles['owner-a'].full_name = '';
    expect((await GET(request())).status).toBe(422);
    database.profiles['owner-a'].full_name = 'Asha';
    database.shops['shop-a'].name = 'Shop 📷';
    const badName = await GET(request());
    expect(badName.status).toBe(422);
    expect((await badName.json()).error.message).toMatch(/cannot render/i);
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://printly.example/path');
    const badSite = await GET(request());
    expect(badSite.status).toBe(503);
  });
});
