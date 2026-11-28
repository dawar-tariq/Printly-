import { createClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { signOutCurrentSession } from './sign-out';

function testClient(logoutResponses: Array<Response | Error>) {
  const storage = new Map<string, string>();
  const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url.includes('/token?grant_type=password')) return Response.json({
      access_token: 'the-current-access-token', refresh_token: 'refresh-token',
      token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600,
      user: { id: 'test-user', email: 'user@example.test' },
    });
    if (url.includes('/logout?scope=local')) {
      const headers = new Headers(init?.headers);
      expect(headers.get('authorization')).toBe('Bearer the-current-access-token');
      const response = logoutResponses.shift();
      if (response instanceof Error) throw response;
      if (response) return response;
    }
    throw new Error(`Unexpected request: ${url}`);
  });
  const client = createClient('https://example.supabase.co', 'anon-public-key', {
    auth: {
      autoRefreshToken: false, detectSessionInUrl: false,
      storage: {
        getItem: (key) => storage.get(key) ?? null,
        setItem: (key, value) => { storage.set(key, value); },
        removeItem: (key) => { storage.delete(key); },
      },
    },
    global: { fetch: fetcher },
  });
  return { client, fetcher };
}

async function signIn(client: ReturnType<typeof testClient>['client']) {
  const { error } = await client.auth.signInWithPassword({ email: 'user@example.test', password: 'not-a-real-password' });
  expect(error).toBeNull();
}

function rejected() { return Response.json({ code: 'bad_jwt', message: 'not revoked' }, { status: 403 }); }

describe('current-session sign-out', () => {
  it('checks the unsuppressed provider result before clearing local storage', async () => {
    const { client, fetcher } = testClient([new Response(null, { status: 204 }), rejected()]);
    await signIn(client);
    expect(await signOutCurrentSession(client)).toBe(true);
    expect((await client.auth.getSession()).data.session).toBeNull();
    expect(fetcher.mock.calls.filter(([url]) => String(url).includes('/logout'))).toHaveLength(2);
  });

  it('does not treat the SDK-suppressed 403 as confirmation', async () => {
    const { client, fetcher } = testClient([rejected(), rejected()]);
    await signIn(client);
    expect(await signOutCurrentSession(client)).toBe(false);
    expect((await client.auth.getSession()).data.session).toBeNull();
    expect(fetcher.mock.calls.filter(([url]) => String(url).includes('/logout'))).toHaveLength(2);
    // A second ordinary SDK sign-out now has no token and reports success;
    // it cannot establish whether the earlier session was revoked.
    expect((await client.auth.signOut({ scope: 'local' })).error).toBeNull();
    expect(fetcher.mock.calls.filter(([url]) => String(url).includes('/logout'))).toHaveLength(2);
  });

  it('still attempts local cleanup if the provider request fails', async () => {
    const { client } = testClient([new Error('offline'), new Error('offline')]);
    await signIn(client);
    expect(await signOutCurrentSession(client)).toBe(false);
    expect((await client.auth.getSession()).data.session).toBeNull();
  });

  it('cannot confirm revocation when there is no session token', async () => {
    const { client, fetcher } = testClient([]);
    expect(await signOutCurrentSession(client)).toBe(false);
    expect(fetcher).not.toHaveBeenCalled();
  });
});
