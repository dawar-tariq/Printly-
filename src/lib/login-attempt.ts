import type { Portal } from '@/lib/portal-auth';

/** An additional UI gate; the browser still authenticates directly with Supabase. */
export async function checkLoginAttempt(portal: Portal): Promise<void> {
  let response: Response;
  try {
    response = await fetch(portal === 'admin' ? '/api/admin/login-attempt' : '/api/auth/login-attempt', {
      method: 'POST', cache: 'no-store',
    });
  } catch { throw new Error('Could not reach sign-in protection. Please check your connection and try again.'); }
  if (response.ok) return;
  if (response.status === 429) {
    const seconds = Number(response.headers.get('retry-after'));
    const wait = Number.isFinite(seconds) && seconds > 0 ? ` Try again in about ${Math.ceil(seconds / 60)} minute${seconds > 60 ? 's' : ''}.` : ' Please wait before trying again.';
    throw new Error(`Too many sign-in attempts.${wait}`);
  }
  throw new Error('Sign-in protection is temporarily unavailable. Please try again shortly.');
}

export function authAttemptError(error: { status?: number } | null | undefined, isCurrentPassword = false): string {
  if (error?.status === 429) return 'Too many sign-in attempts. Please wait before trying again.';
  if (error?.status === 400 || error?.status === 401) return isCurrentPassword ? 'Current password is incorrect.' : 'Incorrect email or password.';
  return isCurrentPassword ? 'Could not verify your password. Please try again.' : 'Could not sign in. Please try again.';
}
