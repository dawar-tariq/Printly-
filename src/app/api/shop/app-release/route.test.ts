import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const getStaffContext = vi.hoisted(() => vi.fn());
const currentNativeAppRelease = vi.hoisted(() => vi.fn());
vi.mock('@/lib/native-app-update-server', () => ({ currentNativeAppRelease }));
vi.mock('@/lib/api', () => ({
  getStaffContext,
  jsonError: (status: number, code: string, message: string) => Response.json({ error: { code, message } }, { status }),
  jsonOk: (data: unknown) => Response.json(data),
}));
import { GET } from './route';

const configured = {
  NEXT_PUBLIC_SITE_URL: 'https://printly-steel-three.vercel.app',
  PRINTLY_ANDROID_VERSION_CODE: '4',
  PRINTLY_ANDROID_VERSION_NAME: '2.0.1',
  PRINTLY_ANDROID_APK_URL: 'https://github.com/dawar-tariq/Printly-/releases/download/v2.0.1/printly-owner.apk',
  PRINTLY_ANDROID_APK_SHA256: 'a'.repeat(64),
  PRINTLY_ANDROID_RELEASE_NOTES: 'Maintenance and reliability improvements.',
};

beforeEach(() => {
  getStaffContext.mockReset(); currentNativeAppRelease.mockReset();
  vi.stubEnv('PRINTLY_NATIVE_RELEASE_MANAGER_ENABLED', '0');
  for (const [key, value] of Object.entries(configured)) vi.stubEnv(key, value);
});
afterEach(() => vi.unstubAllEnvs());

async function checkPrivate(response: Response) {
  expect(response.headers.get('cache-control')).toContain('no-store');
  expect(response.headers.get('vary')).toContain('Cookie');
  expect(response.headers.get('x-content-type-options')).toBe('nosniff');
}

describe('shop Android release metadata', () => {
  it('requires a verified shop session and does not cache failures', async () => {
    getStaffContext.mockResolvedValue(null);
    const anonymous = await GET();
    expect(anonymous.status).toBe(401); await checkPrivate(anonymous);
    expect(getStaffContext).toHaveBeenCalledWith({ allowExpired: true });
    for (const context of [
      { isAdmin: true, membershipError: false, shopIds: [] },
      { isAdmin: false, membershipError: false, shopIds: [] },
    ]) {
      getStaffContext.mockResolvedValue(context);
      const response = await GET();
      expect(response.status).toBe(403); await checkPrivate(response);
      expect(JSON.stringify(await response.json())).not.toContain('printly-owner.apk');
    }
  });
  it('fails closed when membership cannot be checked', async () => {
    getStaffContext.mockResolvedValue({ isAdmin: false, membershipError: true, shopIds: [] });
    const response = await GET();
    expect(response.status).toBe(503); await checkPrivate(response);
    expect((await response.json()).error.code).toBe('unavailable');
  });
  it('allows a shop member to see only complete configured metadata', async () => {
    getStaffContext.mockResolvedValue({ isAdmin: false, membershipError: false, shopIds: ['shop'] });
    const response = await GET();
    expect(response.status).toBe(200); await checkPrivate(response);
    expect(await response.json()).toMatchObject({ available: true, versionCode: 4, sha256: 'a'.repeat(64), downloadUrl: configured.PRINTLY_ANDROID_APK_URL });
    expect(currentNativeAppRelease).not.toHaveBeenCalled();
    vi.stubEnv('PRINTLY_ANDROID_APK_SHA256', '');
    const unavailable = await GET();
    expect(await unavailable.json()).toEqual({ available: false });
    await checkPrivate(unavailable);
  });
  it('never resurrects the legacy release after managed unpublish or a database failure', async () => {
    vi.stubEnv('PRINTLY_NATIVE_RELEASE_MANAGER_ENABLED', '1');
    getStaffContext.mockResolvedValue({ isAdmin: false, membershipError: false, shopIds: ['shop'] });
    currentNativeAppRelease.mockResolvedValueOnce({ available: false }).mockResolvedValueOnce(null);
    const unpublished = await GET();
    expect(await unpublished.json()).toEqual({ available: false });
    await checkPrivate(unpublished);
    const error = await GET();
    expect(error.status).toBe(503);
    expect((await error.json()).error.code).toBe('unavailable');
    await checkPrivate(error);
  });
});
