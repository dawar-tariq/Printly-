import { NextResponse } from 'next/server';
import { createAdminSupabase } from '@/lib/supabase';
import { SUPABASE_URL } from '@/lib/supabase-client';
import { ISOLATED_TEST_PROJECT, ISOLATED_TEST_SUPABASE, isolatedTestDeploymentAllowed } from '@/lib/isolated-test-environment.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'private, no-store, max-age=0', 'X-Content-Type-Options': 'nosniff', 'X-Robots-Tag': 'noindex, nofollow' };

/**
 * Test-project-only, non-sensitive isolation evidence. This read verifies the
 * Node server's actual Supabase client and server credential against the
 * expected staging database, and checks the public key against staging Auth.
 * Never return a credential, settings value, upstream error or user data.
 * It is not an authorization proof or a substitute for reviewing test data.
 */
export async function GET() {
  if (process.env.PRINTLY_ISOLATED_TEST !== '1' && process.env.VERCEL_PROJECT_ID !== ISOLATED_TEST_PROJECT) {
    return NextResponse.json({ error: { code: 'not_found', message: 'Not found.' } }, { status: 404, headers });
  }
  if (!isolatedTestDeploymentAllowed(process.env) || SUPABASE_URL !== ISOLATED_TEST_SUPABASE) {
    return NextResponse.json({ error: { code: 'test_environment_unavailable', message: 'The isolated test environment is not configured safely.' } }, { status: 503, headers });
  }
  try {
    // Do not follow redirects or send the server key to this public-key probe.
    const auth = await fetch(`${SUPABASE_URL}/auth/v1/settings`, {
      headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY! },
      cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(4_000),
    });
    if (!auth.ok) throw new Error('Auth probe failed');
    const { data, error } = await createAdminSupabase().from('platform_settings').select('key').eq('key', 'maintenance').maybeSingle();
    if (!error && data?.key === 'maintenance') {
      return NextResponse.json({ isolated_test: true, supabase_url: SUPABASE_URL, public_auth_check: 'ok', server_database_read: 'ok' }, { headers });
    }
  } catch { /* Keep upstream errors and credentials private. */ }
  return NextResponse.json({ error: { code: 'test_environment_unavailable', message: 'The isolated test database could not be verified.' } }, { status: 503, headers });
}
