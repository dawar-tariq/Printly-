import 'server-only';

import { AsyncLocalStorage } from 'node:async_hooks';
import type { SupabaseClient, User } from '@supabase/supabase-js';

/**
 * Request-local identity for the native shop gateway. Only server code can set
 * this value: it must be a user returned by Supabase Auth's getUser(token), not
 * a decoded or caller-supplied JWT payload. Browser routes never read headers
 * to populate this context and continue using their existing cookie session.
 */
export type VerifiedNativeSession = { user: User; supabase: SupabaseClient };
const sessions = new AsyncLocalStorage<VerifiedNativeSession>();

export function currentNativeSession(): VerifiedNativeSession | undefined {
  return sessions.getStore();
}

export function withVerifiedNativeSession<T>(session: VerifiedNativeSession, action: () => T): T {
  return sessions.run(session, action);
}
