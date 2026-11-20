import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const state = vi.hoisted(() => ({ user: null as { id: string } | null, role: 'shop_staff', member: true, refresh: false }));
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

beforeEach(() => { state.user = null; state.role = 'shop_staff'; state.member = true; state.refresh = false; });
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
