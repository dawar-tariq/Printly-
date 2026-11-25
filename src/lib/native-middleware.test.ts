import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const state = vi.hoisted(() => ({ maintenance: 'off' as 'off' | 'on' | 'unknown' }));
vi.mock('@/lib/maintenance-server', async (original) => ({
  ...(await original<typeof import('@/lib/maintenance-server')>()),
  readMaintenanceState: async () => state.maintenance,
}));
import { middleware } from '@/middleware';

describe('native middleware protections', () => {
  it('passes normal headerless native requests without redirecting to a web login', async () => {
    state.maintenance = 'off';
    const response = await middleware(new NextRequest('https://printly.test/api/native/v1/shop/board', { method: 'POST', headers: { authorization: 'Bearer token' } }));
    expect(response.headers.get('x-middleware-next')).toBe('1');
    expect(response.headers.get('location')).toBeNull();
  });
  it('blocks native auth configuration and data while maintenance is on or unknown', async () => {
    for (const mode of ['on', 'unknown'] as const) {
      state.maintenance = mode;
      for (const path of ['/api/native/v1/config', '/api/native/v1/shop/me', '/api/native/v1/shop/orders/123/status']) {
        const response = await middleware(new NextRequest(`https://printly.test${path}`));
        expect(response.status).toBe(503);
        expect(response.headers.get('cache-control')).toContain('no-store');
        expect((await response.json()).error.code).toBe(mode === 'on' ? 'maintenance' : 'maintenance_status_unavailable');
      }
    }
  });
  it('still blocks cross-origin browser writes to the native gateway', async () => {
    state.maintenance = 'off';
    const response = await middleware(new NextRequest('https://printly.test/api/native/v1/shop/board', { method: 'POST', headers: { origin: 'https://other.test' } }));
    expect(response.status).toBe(403); expect((await response.json()).error.code).toBe('cross_origin');
  });
});
