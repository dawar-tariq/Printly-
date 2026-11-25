import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const state = vi.hoisted(() => ({ user: null as { id: string } | null, role: 'shop_staff', member: true, refresh: false, maintenance: 'off' as 'on' | 'off' | 'unknown' }));
vi.mock('@/lib/maintenance-server', async (original) => ({
  ...(await original<typeof import('@/lib/maintenance-server')>()),
  readMaintenanceState: async () => state.maintenance,
}));
vi.mock('@supabase/ssr', () => ({ createServerClient: (_url: string, _key: string, opts: { cookies: { setAll: (items: unknown[]) => void } }) => ({
  auth: { getUser: async () => {
    if (state.refresh) opts.cookies.setAll([{ name: 'refreshed', value: 'yes', options: { path: '/' } }]);
    return { data: { user: state.user } };
  } },
  from: (table: string) => ({ select: () => ({ eq: () => ({
    maybeSingle: async () => ({ data: { role: state.role }, error: null }),
    limit: async () => ({ data: table === 'shop_staff' && state.member ? [{ shop_id: 'shop' }] : [], error: null }),
  }) }) }),
}) }));
import { middleware } from './middleware';

beforeEach(() => { state.user = null; state.role = 'shop_staff'; state.member = true; state.refresh = false; state.maintenance = 'off'; });
const visit = (path: string) => middleware(new NextRequest(`https://printly.test${path}`));

describe('session-aware portal entry', () => {
  it('keeps public entry pages available but protects shop pages', async () => {
    expect((await visit('/')).headers.get('location')).toBeNull();
    expect((await visit('/shop/signup')).headers.get('location')).toBeNull();
    expect((await visit('/login')).headers.get('location')).toBeNull();
    expect((await visit('/shop/orders/abc?x=1')).headers.get('location')).toBe('https://printly.test/login?next=%2Fshop%2Forders%2Fabc%3Fx%3D1');
  });
  it('returns linked owners to their shop without redirecting customer order paths', async () => {
    state.user = { id: 'owner' };
    expect((await visit('/')).headers.get('location')).toBe('https://printly.test/shop');
    expect((await visit('/shop/signup')).headers.get('location')).toBe('https://printly.test/shop');
    expect((await visit('/login?next=%2Fshop%2Fsettings')).headers.get('location')).toBe('https://printly.test/shop/settings');
    expect((await visit('/login?next=https%3A%2F%2Fevil.test')).headers.get('location')).toBe('https://printly.test/shop');
    expect((await visit('/shop')).headers.get('location')).toBeNull();
    expect((await visit('/admin/login')).headers.get('location')).toBeNull();
  });
  it('does not trap unlinked users in a signup redirect loop', async () => {
    state.user = { id: 'unlinked' }; state.member = false;
    expect((await visit('/shop/signup')).headers.get('location')).toBeNull();
    expect((await visit('/')).headers.get('location')).toBeNull();
    expect((await visit('/login')).headers.get('location')).toBe('https://printly.test/shop');
  });
  it('routes admins separately and preserves refreshed cookies on redirects', async () => {
    state.user = { id: 'admin' }; state.role = 'admin'; state.refresh = true;
    const res = await visit('/login');
    expect(res.headers.get('location')).toBe('https://printly.test/admin');
    expect(res.headers.get('set-cookie')).toContain('refreshed=yes');
    expect((await visit('/admin/login')).headers.get('location')).toBe('https://printly.test/admin');
    expect((await visit('/')).headers.get('location')).toBeNull();
  });
});

describe('cross-origin mutation protection', () => {
  it('blocks cross-origin and same-site sibling-origin API writes, including admin routes', async () => {
    for (const [path, headers] of [
      ['/api/shop/signup', { origin: 'https://evil.test' }],
      ['/api/orders', { origin: 'null' }],
      ['/api/admin/settings', { origin: 'https://sibling.printly.test', 'sec-fetch-site': 'same-site' }],
      ['/api/shop/settings', { 'sec-fetch-site': 'cross-site' }],
    ] as Array<[string, Record<string, string>]>) {
      const response = await middleware(new NextRequest(`https://printly.test${path}`, { method: 'POST', headers }));
      expect(response.status, path).toBe(403);
      expect((await response.json()).error.code).toBe('cross_origin');
    }
  });
  it('permits same-origin browser writes, headerless API clients and public GETs', async () => {
    for (const headers of [{ origin: 'https://printly.test', 'sec-fetch-site': 'same-origin' }, {}] as Record<string, string>[]) {
      const response = await middleware(new NextRequest('https://printly.test/api/orders', { method: 'POST', headers }));
      expect(response.headers.get('x-middleware-next')).toBe('1');
    }
    expect((await middleware(new NextRequest('https://printly.test/api/shops/demo/public', { headers: { origin: 'https://other.test' } }))).headers.get('x-middleware-next')).toBe('1');
  });
  it('compares with the public host and forwarded scheme rather than an internal bind address', async () => {
    const proxied = (origin: string, host = 'printly.test') => new NextRequest('http://0.0.0.0:3000/api/orders', {
      method: 'POST', headers: { origin, host, 'x-forwarded-proto': 'https', 'sec-fetch-site': 'same-origin' },
    });
    expect((await middleware(proxied('https://printly.test'))).headers.get('x-middleware-next')).toBe('1');
    expect((await middleware(proxied('https://other.test'))).status).toBe(403);
    expect((await middleware(proxied('http://printly.test'))).status).toBe(403);
    expect((await middleware(proxied('https://printly.test', 'evil.test,printly.test'))).status).toBe(403);
  });
});

describe('platform maintenance', () => {
  it('keeps the public Android association reachable even if maintenance is on or its state is unknown', async () => {
    for (const maintenance of ['on', 'unknown'] as const) {
      state.maintenance = maintenance;
      const response = await visit('/.well-known/assetlinks.json');
      expect(response.status).toBe(200);
      expect(response.headers.get('x-middleware-next')).toBe('1');
      expect((await visit('/owner-app')).status).toBe(503);
    }
  });

  it('replaces customer and shop pages with a self-contained, non-cacheable 503 notice', async () => {
    state.maintenance = 'on';
    for (const path of ['/', '/login', '/shop', '/shop/signup', '/s/p-demo1', '/s/p-demo1/order', '/track/123', '/other']) {
      const response = await visit(path);
      expect(response.status, path).toBe(503);
      expect(response.headers.get('content-type')).toContain('text/html');
      expect(response.headers.get('cache-control')).toContain('no-store');
      expect(response.headers.get('retry-after')).toBe('60');
      expect(response.headers.get('location')).toBeNull();
      const html = await response.text();
      expect(html).toContain('Maintenance in progress');
      expect(html).toContain('We’re making things better');
      expect(html).toContain('don’t pay again');
      expect(html).toContain('href="/admin/login"');
      expect(html).not.toContain('<script');
    }
  });

  it('blocks non-admin APIs for reads and writes without running portal auth', async () => {
    state.maintenance = 'on';
    for (const path of ['/api/orders', '/api/orders/123/pay', '/api/shop/orders', '/api/shops/demo/public', '/api/administer']) {
      const response = await middleware(new NextRequest(`https://printly.test${path}`, { method: 'POST' }));
      expect(response.status, path).toBe(503);
      expect(response.headers.get('cache-control')).toContain('no-store');
      expect(await response.json()).toEqual({ error: { code: 'maintenance', message: expect.stringContaining('temporarily unavailable') } });
    }
  });

  it('keeps admin routes accessible, with their normal authentication checks', async () => {
    state.maintenance = 'on';
    expect((await visit('/admin/login')).headers.get('location')).toBeNull();
    expect((await visit('/admin/settings')).headers.get('location')).toBe('https://printly.test/admin/login?next=%2Fadmin%2Fsettings');
    expect((await visit('/api/admin/settings')).headers.get('x-middleware-next')).toBe('1');
    state.user = { id: 'admin' }; state.role = 'admin';
    expect((await visit('/admin/settings')).headers.get('x-middleware-next')).toBe('1');
    expect((await visit('/administration')).status).toBe(503);
    // An admin browsing the public site sees the same notice as other visitors.
    expect((await visit('/')).status).toBe(503);
  });

  it('reports changes immediately without caching and restores normal traffic when switched off', async () => {
    state.maintenance = 'on';
    const blocked = await visit('/api/maintenance-status');
    expect(blocked.status).toBe(503);
    expect((await blocked.json()).error.code).toBe('maintenance');
    state.maintenance = 'off';
    const open = await visit('/api/maintenance-status');
    expect(open.status).toBe(200);
    expect(open.headers.get('cache-control')).toContain('no-store');
    expect(await open.json()).toEqual({ maintenance: false });
    expect((await visit('/s/p-demo1/order')).headers.get('x-middleware-next')).toBe('1');
    expect((await visit('/api/orders')).headers.get('x-middleware-next')).toBe('1');
  });

  it('fails closed with a generic notice if the setting cannot be checked', async () => {
    state.maintenance = 'unknown';
    const page = await visit('/track/123');
    expect(page.status).toBe(503);
    expect(await page.text()).toContain('Temporarily unavailable');
    const api = await visit('/api/orders');
    expect(api.status).toBe(503);
    expect((await api.json()).error.code).toBe('maintenance_status_unavailable');
    expect((await visit('/admin/login')).status).toBe(200);
  });
});
