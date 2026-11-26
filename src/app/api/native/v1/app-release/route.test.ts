import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ target: 'production' as 'production' | 'isolated' | null,
  data: null as unknown, error: null as null | { message: string }, calls: 0 }));
vi.mock('@/lib/native-push-server', () => ({ nativePushTarget: () => state.target }));
vi.mock('@/lib/supabase', () => ({ createAdminSupabase: () => ({ rpc: async (name: string) => {
  expect(name).toBe('current_native_app_release'); state.calls++; return { data: state.data, error: state.error };
} }) }));
import { GET } from './route';

const release = { available: true, versionCode: 5, versionName: '2.1.0', minimumVersionCode: 4,
  packageName: 'io.github.dawartariq.printly.owner',
  downloadUrl: 'https://github.com/dawar-tariq/Printly-/releases/download/v2.1.0/owner.apk',
  sha256: 'a'.repeat(64), notes: 'Updates', mandatory: true, releasedAt: '2026-01-01T00:00:00Z' };
beforeEach(() => { state.target = 'production'; state.data = release; state.error = null; state.calls = 0; vi.stubEnv('PRINTLY_NATIVE_RELEASE_MANAGER_ENABLED', '1'); });
afterEach(() => vi.unstubAllEnvs());

describe('public native app update policy', () => {
  it('returns validated non-secret metadata without caching', async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(await response.json()).toEqual(release);
  });
  it('does not advertise production metadata to an isolated installation or when disabled', async () => {
    state.target = 'isolated';
    expect(await (await GET()).json()).toEqual({ available: false });
    vi.stubEnv('PRINTLY_NATIVE_RELEASE_MANAGER_ENABLED', '0'); state.target = 'production';
    expect(await (await GET()).json()).toEqual({ available: false });
    expect(state.calls).toBe(0);
  });
  it('distinguishes explicit unpublish from unavailable or malformed data', async () => {
    state.data = null;
    expect(await (await GET()).json()).toEqual({ available: false });
    state.error = { message: 'unavailable' };
    const failed = await GET(); expect(failed.status).toBe(503); expect((await failed.json()).error.code).toBe('unavailable');
    state.error = null; state.data = { ...release, downloadUrl: 'https://untrusted.example/app.apk' };
    expect((await GET()).status).toBe(503);
    // A database value that Android would reject must be an error, not a
    // successful update or an explicit unpublish of a cached requirement.
    state.data = { ...release, notes: 'invalid\u0007bell' };
    const invalidNotes = await GET();
    expect(invalidNotes.status).toBe(503);
    expect(invalidNotes.headers.get('cache-control')).toContain('no-store');
    expect((await invalidNotes.json()).error.code).toBe('unavailable');
    state.data = { ...release, releasedAt: '2026-01-01T00:00:00.1234567890Z' };
    expect((await GET()).status).toBe(503);
    state.target = null; expect((await GET()).status).toBe(503);
  });
});
