import { beforeEach, describe, expect, it, vi } from 'vitest';

const limit = vi.hoisted(() => vi.fn());
vi.mock('@/lib/rate-limit', () => ({ enforcePublicRateLimit: limit }));
import { POST as shopGate } from './route';
import { POST as adminGate } from '@/app/api/admin/login-attempt/route';

beforeEach(() => limit.mockReset().mockResolvedValue(null));
describe('application login attempt gate', () => {
  it('shares one bucket for both portals without collecting credentials', async () => {
    const shop = new Request('https://printly.test/api/auth/login-attempt', { method: 'POST' });
    const admin = new Request('https://printly.test/api/admin/login-attempt', { method: 'POST' });
    expect((await shopGate(shop)).status).toBe(200);
    expect((await adminGate(admin)).headers.get('cache-control')).toContain('no-store');
    expect(limit.mock.calls.map((call) => call[1])).toEqual(['login_attempt', 'login_attempt']);
  });
  it('passes a limiter failure through rather than silently allowing login', async () => {
    limit.mockResolvedValueOnce(new Response('limited', { status: 429, headers: { 'Retry-After': '60' } }));
    const result = await adminGate(new Request('https://printly.test/api/admin/login-attempt', { method: 'POST' }));
    expect(result.status).toBe(429);
    expect(result.headers.get('retry-after')).toBe('60');
  });
});
