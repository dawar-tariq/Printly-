import { describe, expect, it } from 'vitest';
import { ISOLATED_TEST_PROJECT, ISOLATED_TEST_SITE, ISOLATED_TEST_SUPABASE, isolatedTestDeploymentAllowed, isolatedTestRequestAllowed } from './isolated-test-environment.mjs';

// Deliberately unsigned fixtures; the guard checks claims, never authenticity.
const jwt = (role: string, ref = 'rahfmpsdbwbktlobntkm', iss = 'supabase') => `e30.${Buffer.from(JSON.stringify({ iss, ref, role })).toString('base64url')}.test`;
const valid = {
  PRINTLY_ISOLATED_TEST: '1', NEXT_PUBLIC_PRINTLY_ISOLATED_TEST: '1', VERCEL_PROJECT_ID: ISOLATED_TEST_PROJECT, VERCEL_ENV: 'production',
  VERCEL_PROJECT_PRODUCTION_URL: 'printly-native-test.vercel.app',
  NEXT_PUBLIC_SITE_URL: ISOLATED_TEST_SITE, NEXT_PUBLIC_SUPABASE_URL: ISOLATED_TEST_SUPABASE,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: jwt('anon'), SUPABASE_SERVICE_ROLE_KEY: jwt('service_role'),
};

describe('isolated test environment guard', () => {
  it('leaves ordinary production and local deployments alone', () => {
    expect(isolatedTestDeploymentAllowed({})).toBe(true);
    expect(isolatedTestRequestAllowed({}, 'printly-steel-three.vercel.app')).toBe(true);
    expect(isolatedTestRequestAllowed({ VERCEL_PROJECT_ID: 'other-project' }, 'example.test')).toBe(true);
  });

  it('fails closed for the reserved project, hostname, or site URL without the explicit marker', () => {
    expect(isolatedTestDeploymentAllowed({ VERCEL_PROJECT_ID: ISOLATED_TEST_PROJECT })).toBe(false);
    expect(isolatedTestDeploymentAllowed({ VERCEL_PROJECT_PRODUCTION_URL: 'printly-native-test.vercel.app' })).toBe(false);
    expect(isolatedTestDeploymentAllowed({ NEXT_PUBLIC_SITE_URL: ISOLATED_TEST_SITE })).toBe(false);
    expect(isolatedTestRequestAllowed({}, 'printly-native-test.vercel.app')).toBe(false);
    expect(isolatedTestRequestAllowed({}, 'PRINTLY-NATIVE-TEST.VERCEL.APP.:443')).toBe(false);
    expect(isolatedTestRequestAllowed({ VERCEL_PROJECT_ID: ISOLATED_TEST_PROJECT }, 'deployment-url.vercel.app')).toBe(false);
  });

  it('requires the exact dedicated project, target, origins, and test host', () => {
    expect(isolatedTestDeploymentAllowed(valid)).toBe(true);
    expect(isolatedTestRequestAllowed(valid, 'printly-native-test.vercel.app')).toBe(true);
    expect(isolatedTestRequestAllowed(valid, 'PRINTLY-NATIVE-TEST.VERCEL.APP:443')).toBe(true);
    for (const bad of [
      { ...valid, PRINTLY_ISOLATED_TEST: '' }, { ...valid, NEXT_PUBLIC_PRINTLY_ISOLATED_TEST: '' }, { ...valid, VERCEL_PROJECT_ID: undefined },
      { ...valid, VERCEL_PROJECT_ID: 'other-project' }, { ...valid, VERCEL_ENV: 'preview' },
      { ...valid, NEXT_PUBLIC_SITE_URL: 'https://printly-steel-three.vercel.app' },
      { ...valid, NEXT_PUBLIC_SUPABASE_URL: 'https://lgfqetnfazawglwllymb.supabase.co' },
      { ...valid, NEXT_PUBLIC_SUPABASE_URL: undefined },
      { ...valid, PRINTLY_REDIS_REST_URL: 'https://redis.example.test' },
      { ...valid, PRINTLY_REDIS_REST_TOKEN: 'not-a-real-token' },
      { ...valid, NEXT_PUBLIC_DROPBOX_APP_KEY: 'not-a-real-key' },
      { ...valid, PRINTLY_ANDROID_APK_URL: 'https://printly-native-test.vercel.app/downloads/a.apk' },
    ]) {
      expect(isolatedTestDeploymentAllowed(bad)).toBe(false);
      expect(isolatedTestRequestAllowed(bad, 'printly-native-test.vercel.app')).toBe(false);
    }
    expect(isolatedTestRequestAllowed(valid, 'printly-steel-three.vercel.app')).toBe(false);
    expect(isolatedTestRequestAllowed(valid, 'deployment-url.vercel.app')).toBe(false);
  });

  it('accepts modern key types without claiming to know their project', () => {
    const modern = { ...valid, NEXT_PUBLIC_SUPABASE_ANON_KEY: `sb_publishable_${'a'.repeat(30)}`, SUPABASE_SERVICE_ROLE_KEY: `sb_secret_${'b'.repeat(30)}` };
    expect(isolatedTestDeploymentAllowed(modern)).toBe(true);
    expect(isolatedTestDeploymentAllowed({ ...modern, NEXT_PUBLIC_SUPABASE_ANON_KEY: modern.SUPABASE_SERVICE_ROLE_KEY })).toBe(false);
    expect(isolatedTestDeploymentAllowed({ ...modern, SUPABASE_SERVICE_ROLE_KEY: modern.NEXT_PUBLIC_SUPABASE_ANON_KEY })).toBe(false);
  });

  it('rejects missing, malformed, wrong-role and wrong-project legacy credentials', () => {
    for (const bad of [
      { ...valid, NEXT_PUBLIC_SUPABASE_ANON_KEY: undefined },
      { ...valid, SUPABASE_SERVICE_ROLE_KEY: undefined },
      { ...valid, NEXT_PUBLIC_SUPABASE_ANON_KEY: jwt('service_role') },
      { ...valid, SUPABASE_SERVICE_ROLE_KEY: jwt('anon') },
      { ...valid, NEXT_PUBLIC_SUPABASE_ANON_KEY: jwt('anon', 'lgfqetnfazawglwllymb') },
      { ...valid, SUPABASE_SERVICE_ROLE_KEY: jwt('service_role', 'lgfqetnfazawglwllymb') },
      { ...valid, SUPABASE_SERVICE_ROLE_KEY: jwt('service_role', 'rahfmpsdbwbktlobntkm', 'wrong-issuer') },
      { ...valid, SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_opaque-key' },
      { ...valid, SUPABASE_SERVICE_ROLE_KEY: 'bad.key.value' },
      { ...valid, SUPABASE_SERVICE_ROLE_KEY: 'a'.repeat(8193) },
    ]) expect(isolatedTestDeploymentAllowed(bad)).toBe(false);
  });
});
