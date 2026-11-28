import type { createBrowserSupabase } from '@/lib/supabase-client';

type BrowserSupabase = ReturnType<typeof createBrowserSupabase>;

/**
 * Revoke the current refresh session, then clear this browser's local session.
 *
 * auth.signOut({ scope: 'local' }) clears local storage before its request, and
 * the current Supabase SDK suppresses some 401/403/404 provider errors. Calling
 * it again after a failure can therefore return success without a token and
 * without having revoked the original session. Capture the current token and
 * inspect the unsuppressed logout result first. auth.admin.signOut uses the
 * supplied user's JWT here; no service-role key is present in the browser.
 *
 * Always attempt local cleanup, even if the provider call fails. A false
 * result means revocation or local cleanup was not confirmed, not necessarily
 * that either failed. Access tokens already issued may remain valid until
 * they expire even after the refresh session is revoked.
 */
export async function signOutCurrentSession(supabase: BrowserSupabase): Promise<boolean> {
  let revoked = false;
  try {
    const { data, error } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!error && token) {
      const result = await supabase.auth.admin.signOut(token, 'local');
      revoked = !result.error;
    }
  } catch {
    // Continue to local cleanup; do not claim the provider revoked the session.
  }

  try {
    const { error } = await supabase.auth.signOut({ scope: 'local' });
    return revoked && !error;
  } catch {
    return false;
  }
}
