import { createBrowserClient } from '@supabase/ssr';

export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
export const SUPABASE_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

/** Browser client — RLS as the signed-in user (or anon). Safe for client components. */
export function createBrowserSupabase() {
  // Cookie-backed refresh tokens survive closing the tab/browser. Private browsing,
  // cleared cookies, sign-out and server-side session expiry can still end a session.
  return createBrowserClient(SUPABASE_URL, SUPABASE_ANON, {
    auth: { persistSession: true, autoRefreshToken: true },
    cookieOptions: { path: '/', sameSite: 'lax', secure: process.env.NODE_ENV === 'production' },
  });
}
