import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase', () => ({ createAdminSupabase: () => ({ rpc: state.rpc }) }));
import { enforceDraftRateLimit, enforcePublicRateLimit, enforceUploadIssueLimit } from './rate-limit';

beforeEach(() => {
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-private-key');
  vi.stubEnv('VERCEL', '1');
  state.rpc.mockReset().mockResolvedValue({ data: { allowed: true, retry_after: 60 }, error: null });
});
afterEach(() => vi.unstubAllEnvs());
const request = (ip = '192.0.2.18') => new Request('https://printly.test/api/orders', { headers: { 'x-vercel-forwarded-for': ip } });

describe('public abuse limiter', () => {
  it('uses a keyed hash rather than storing a raw IP address', async () => {
    expect(await enforcePublicRateLimit(request(), 'order_start')).toBeNull();
    const [fn, args] = state.rpc.mock.calls[0];
    expect(fn).toBe('consume_public_rate_limit');
    expect(args.p_bucket).toBe('order_start');
    expect(args.p_client_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(args)).not.toContain('192.0.2.18');
    await enforcePublicRateLimit(request('192.0.2.19'), 'order_start');
    expect(state.rpc.mock.calls[1][1].p_client_hash).not.toBe(args.p_client_hash);
  });
  it('bounds upload links by both IP and draft, without storing the draft ID', async () => {
    const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    expect(await enforceUploadIssueLimit(request(), id)).toBeNull();
    expect(state.rpc.mock.calls.map((call) => call[1].p_bucket)).toEqual(['upload_issue', 'draft_upload_issue']);
    const draftHash = state.rpc.mock.calls[1][1].p_client_hash;
    expect(draftHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(state.rpc.mock.calls)).not.toContain(id);
    expect(draftHash).not.toBe(state.rpc.mock.calls[0][1].p_client_hash);
    await enforceDraftRateLimit(id.toUpperCase(), 'draft_upload_issue');
    expect(state.rpc.mock.calls[2][1].p_client_hash).toBe(draftHash);
    expect((await enforceDraftRateLimit('invalid', 'draft_upload_issue'))?.status).toBe(503);
  });
  it('returns the full retry window and a clear recovery action for exhausted drafts', async () => {
    state.rpc.mockResolvedValue({ data: { allowed: false, retry_after: 80000 }, error: null });
    const response = await enforceDraftRateLimit('11111111-1111-4111-8111-111111111111', 'draft_upload_issue');
    expect(response?.status).toBe(429);
    expect(response?.headers.get('retry-after')).toBe('80000');
    expect((await response?.json()).error.message).toMatch(/start a new order/i);
  });
  it('returns a retryable 429 when the shared limit is reached', async () => {
    state.rpc.mockResolvedValue({ data: { allowed: false, retry_after: 45 }, error: null });
    const response = await enforcePublicRateLimit(request(), 'signup');
    expect(response?.status).toBe(429);
    expect(response?.headers.get('retry-after')).toBe('45');
    expect((await response?.json()).error.code).toBe('rate_limited');
  });
  it('fails closed on missing trusted IP, missing secret or database errors', async () => {
    expect((await enforcePublicRateLimit(new Request('https://printly.test/api/orders'), 'signup'))?.status).toBe(503);
    expect((await enforcePublicRateLimit(request('spoofed, 192.0.2.18'), 'signup'))?.status).toBe(503);
    expect(state.rpc).not.toHaveBeenCalled();
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', '');
    expect((await enforcePublicRateLimit(request(), 'signup'))?.status).toBe(503);
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-private-key');
    state.rpc.mockResolvedValue({ data: null, error: { message: 'unavailable' } });
    expect((await enforcePublicRateLimit(request(), 'signup'))?.status).toBe(503);
  });
  it('normalises IPv6 spellings and IPv4-mapped addresses before hashing', async () => {
    await enforcePublicRateLimit(request('2001:0DB8:0:0:0:0:0:1'), 'signup');
    await enforcePublicRateLimit(request('2001:db8::1'), 'signup');
    expect(state.rpc.mock.calls[0][1].p_client_hash).toBe(state.rpc.mock.calls[1][1].p_client_hash);
    await enforcePublicRateLimit(request('::ffff:192.0.2.18'), 'signup');
    await enforcePublicRateLimit(request('192.0.2.18'), 'signup');
    expect(state.rpc.mock.calls[2][1].p_client_hash).toBe(state.rpc.mock.calls[3][1].p_client_hash);
  });
  it('requires the Vercel-specific header even if Next populated x-forwarded-for', async () => {
    const req = new Request('https://printly.test/api/orders', { headers: { 'x-forwarded-for': '192.0.2.18' } });
    expect((await enforcePublicRateLimit(req, 'signup'))?.status).toBe(503);
    expect(state.rpc).not.toHaveBeenCalled();
  });
  it('uses only the dedicated proxy header on non-Vercel hosts', async () => {
    vi.stubEnv('VERCEL', '');
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('PRINTLY_TRUST_PROXY_IP', '1');
    const spoofed = new Request('https://printly.test/api/orders', { headers: {
      'x-vercel-forwarded-for': '192.0.2.19', 'x-forwarded-for': '192.0.2.20', 'x-printly-client-ip': '192.0.2.18',
    } });
    expect(await enforcePublicRateLimit(spoofed, 'signup')).toBeNull();
    const realHash = state.rpc.mock.calls[0][1].p_client_hash;
    await enforcePublicRateLimit(new Request('https://printly.test/api/orders', { headers: { 'x-printly-client-ip': '192.0.2.18' } }), 'signup');
    expect(state.rpc.mock.calls[1][1].p_client_hash).toBe(realHash);
    expect((await enforcePublicRateLimit(new Request('https://printly.test/api/orders', { headers: { 'x-forwarded-for': '192.0.2.18' } }), 'signup'))?.status).toBe(503);
    expect(state.rpc).toHaveBeenCalledTimes(2);
  });
  it('does not trust forwarding headers on unconfigured production hosts', async () => {
    vi.stubEnv('VERCEL', '');
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('PRINTLY_TRUST_PROXY_IP', '');
    expect((await enforcePublicRateLimit(request(), 'signup'))?.status).toBe(503);
    expect(state.rpc).not.toHaveBeenCalled();
  });
});
