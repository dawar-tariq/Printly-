import { afterEach, describe, expect, it, vi } from 'vitest';
import { GET } from './route';

afterEach(() => vi.unstubAllEnvs());
describe('Android Digital Asset Links', () => {
  it('returns no association until a valid signing fingerprint is configured', async () => {
    vi.stubEnv('PRINTLY_ANDROID_SIGNING_SHA256', '');
    expect((await GET()).status).toBe(404);
    vi.stubEnv('PRINTLY_ANDROID_SIGNING_SHA256', 'not-a-fingerprint');
    expect((await GET()).status).toBe(404);
  });
  it('publishes only the expected package and normalized SHA-256 fingerprints', async () => {
    const fingerprint = Array(32).fill('ab').join(':');
    vi.stubEnv('PRINTLY_ANDROID_SIGNING_SHA256', fingerprint);
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([{ relation: ['delegate_permission/common.handle_all_urls'], target: { namespace: 'android_app', package_name: 'io.github.dawartariq.printly.owner', sha256_cert_fingerprints: [fingerprint.toUpperCase()] } }]);
  });
});
