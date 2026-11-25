import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { ISOLATED_TEST_PROJECT, ISOLATED_TEST_SITE, ISOLATED_TEST_SUPABASE } from './src/lib/isolated-test-environment.mjs';

const jwt = (role: string) => `e30.${Buffer.from(JSON.stringify({ iss: 'supabase', ref: 'rahfmpsdbwbktlobntkm', role })).toString('base64url')}.test`;
const env = {
  PRINTLY_ISOLATED_TEST: '1', NEXT_PUBLIC_PRINTLY_ISOLATED_TEST: '1', VERCEL_PROJECT_ID: ISOLATED_TEST_PROJECT, VERCEL_ENV: 'production',
  VERCEL_PROJECT_PRODUCTION_URL: 'printly-native-test.vercel.app', NEXT_PUBLIC_SITE_URL: ISOLATED_TEST_SITE,
  NEXT_PUBLIC_SUPABASE_URL: ISOLATED_TEST_SUPABASE, NEXT_PUBLIC_SUPABASE_ANON_KEY: jwt('anon'),
  SUPABASE_SERVICE_ROLE_KEY: jwt('service_role'), PRINTLY_REDIS_REST_URL: '', PRINTLY_REDIS_REST_TOKEN: '', NEXT_PUBLIC_DROPBOX_APP_KEY: '', PRINTLY_ANDROID_APK_URL: '',
};
function loadConfig(overrides: Record<string, string> = {}) {
  return spawnSync(process.execPath, ['--input-type=module', '-e', "await import('./next.config.mjs')"], {
    cwd: process.cwd(), env: { ...process.env, ...env, ...overrides }, encoding: 'utf8',
  });
}

describe('build-time isolated environment assertion', () => {
  it('allows the dedicated project with matching test configuration', () => {
    const result = loadConfig();
    expect(result.status).toBe(0);
  });
  it('stops a wrong database before Next can prerender and never logs either key', () => {
    const result = loadConfig({ NEXT_PUBLIC_SUPABASE_URL: 'https://lgfqetnfazawglwllymb.supabase.co' });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('isolated native test deployment is not configured safely');
    expect(result.stderr).not.toContain(env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
    expect(result.stderr).not.toContain(env.SUPABASE_SERVICE_ROLE_KEY);
  });
});
