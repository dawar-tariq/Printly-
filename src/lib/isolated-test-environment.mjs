/**
 * Fail-closed configuration for the one dedicated native phone-test project.
 * These identifiers are public, not credentials. This is a mistake-prevention
 * check, not authentication: the operator must still review the staging data,
 * verify the server/client targets and use strong test accounts.
 */
export const ISOLATED_TEST_SITE = 'https://printly-native-test.vercel.app';
export const ISOLATED_TEST_SUPABASE = 'https://rahfmpsdbwbktlobntkm.supabase.co';
export const ISOLATED_TEST_PROJECT = 'prj_wP9dOsgFjQjhHGYcAiC5qGA7bQD1';
const ISOLATED_TEST_HOST = 'printly-native-test.vercel.app';
const ISOLATED_TEST_SUPABASE_REF = 'rahfmpsdbwbktlobntkm';

/**
 * Check unverified legacy JWT claims only to detect an obvious wrong-project
 * or wrong-role key. New opaque keys have no project claim: their prefix only
 * distinguishes public from secret. Supabase must still verify actual access;
 * the operator must copy only staging keys. Never log or return key material.
 *
 * @param {string | undefined} key
 * @param {'anon' | 'service_role'} role
 */
function matchesLegacyKeyClaims(key, role) {
  if (!key || key.length > 8192 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(key)) return false;
  try {
    const encoded = key.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const claims = JSON.parse(atob(encoded.padEnd(Math.ceil(encoded.length / 4) * 4, '=')));
    return claims && typeof claims === 'object' && !Array.isArray(claims) &&
      claims.iss === 'supabase' && claims.ref === ISOLATED_TEST_SUPABASE_REF && claims.role === role;
  } catch { return false; }
}

/** @param {string | undefined} key @param {'anon' | 'service_role'} role */
function matchesKeyType(key, role) {
  if (!key || key.length > 8192) return false;
  // Opaque keys do not identify their project in a locally verifiable way.
  if (role === 'anon' && /^sb_publishable_[A-Za-z0-9_-]{16,512}$/.test(key)) return true;
  if (role === 'service_role' && /^sb_secret_[A-Za-z0-9_-]{16,512}$/.test(key)) return true;
  return matchesLegacyKeyClaims(key, role);
}

/** @typedef {Record<string, string | undefined>} Environment */

/** Validate before Next's build-time prerendering can contact any backend. */
/** @param {Environment} env */
export function isolatedTestDeploymentAllowed(env) {
  const testMode = env.PRINTLY_ISOLATED_TEST === '1';
  const publicTestMode = env.NEXT_PUBLIC_PRINTLY_ISOLATED_TEST === '1';
  const testProject = env.VERCEL_PROJECT_ID === ISOLATED_TEST_PROJECT;
  const testDomain = env.VERCEL_PROJECT_PRODUCTION_URL === ISOLATED_TEST_HOST || env.NEXT_PUBLIC_SITE_URL === ISOLATED_TEST_SITE;
  if (!testMode && !publicTestMode && !testProject && !testDomain) return true;
  return testMode && publicTestMode && testProject && env.VERCEL_ENV === 'production' &&
    env.NEXT_PUBLIC_SITE_URL === ISOLATED_TEST_SITE &&
    env.NEXT_PUBLIC_SUPABASE_URL === ISOLATED_TEST_SUPABASE &&
    matchesKeyType(env.NEXT_PUBLIC_SUPABASE_ANON_KEY, 'anon') &&
    matchesKeyType(env.SUPABASE_SERVICE_ROLE_KEY, 'service_role') &&
    !env.PRINTLY_REDIS_REST_URL && !env.PRINTLY_REDIS_REST_TOKEN && !env.NEXT_PUBLIC_DROPBOX_APP_KEY && !env.PRINTLY_ANDROID_APK_URL;
}

/** Validate every dynamic request before maintenance, auth or backend access. */
/** @param {Environment} env @param {string} requestHost */
export function isolatedTestRequestAllowed(env, requestHost) {
  const host = requestHost.toLowerCase().replace(/:443$/, '').replace(/\.$/, '');
  // The reserved host must not serve an unlabelled or wrong-project deploy.
  if (host === ISOLATED_TEST_HOST && env.VERCEL_PROJECT_ID !== ISOLATED_TEST_PROJECT) return false;
  if (!isolatedTestDeploymentAllowed(env)) return false;
  return env.VERCEL_PROJECT_ID !== ISOLATED_TEST_PROJECT || host === ISOLATED_TEST_HOST;
}
