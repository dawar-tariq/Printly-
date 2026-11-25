import { describe, expect, it } from 'vitest';
import { ownerAppRelease, parseOwnerAppRelease, validNativeVersion } from './owner-app-release';

const env = {
  NEXT_PUBLIC_SITE_URL: 'https://printly-steel-three.vercel.app',
  PRINTLY_ANDROID_VERSION_CODE: '3', PRINTLY_ANDROID_VERSION_NAME: '1.2.0',
  PRINTLY_ANDROID_APK_SHA256: 'a'.repeat(64),
  PRINTLY_ANDROID_APK_URL: 'https://github.com/dawar-tariq/Printly-/releases/download/v1.2.0/printly-owner.apk',
};

describe('Android release configuration', () => {
  it('does not advertise an incomplete or unsafe release', () => {
    expect(ownerAppRelease({})).toEqual({ available: false });
    expect(ownerAppRelease({ ...env, PRINTLY_ANDROID_APK_SHA256: '' })).toEqual({ available: false });
    expect(ownerAppRelease({ ...env, PRINTLY_ANDROID_APK_URL: 'http://evil.example/app.apk' })).toEqual({ available: false });
    expect(ownerAppRelease({ ...env, PRINTLY_ANDROID_APK_URL: 'https://github.com/other/repo/releases/download/v1/app.apk' })).toEqual({ available: false });
    expect(ownerAppRelease({ ...env, PRINTLY_ANDROID_APK_URL: 'https://printly-steel-three.vercel.app/downloads/app.apk?token=secret' })).toEqual({ available: false });
    expect(ownerAppRelease({ ...env, PRINTLY_ANDROID_APK_URL: 'https://github.com/dawar-tariq/Printly-/releases/download/v1/app.apk/extra.apk' })).toEqual({ available: false });
    expect(ownerAppRelease({ ...env, PRINTLY_ANDROID_APK_URL: 'https://github.com/dawar-tariq/Printly-/releases/download/v1%2fother/app.apk' })).toEqual({ available: false });
    expect(ownerAppRelease({ ...env, PRINTLY_ANDROID_APK_URL: '/downloads/%2e%2e/other/app.apk' })).toEqual({ available: false });
    expect(ownerAppRelease({ ...env, NEXT_PUBLIC_SITE_URL: 'https://printly-steel-three.vercel.app/other' })).toEqual({ available: false });
  });
  it('allows the configured repository release or same-origin download', () => {
    expect(ownerAppRelease(env)).toMatchObject({ available: true, versionCode: 3, versionName: '1.2.0', sha256: 'a'.repeat(64) });
    expect(ownerAppRelease({ ...env, PRINTLY_ANDROID_APK_URL: '/downloads/owner.apk' })).toMatchObject({ available: true, downloadUrl: 'https://printly-steel-three.vercel.app/downloads/owner.apk' });
  });
  it('does not render malformed metadata or untrusted URLs from an API response', () => {
    const valid = ownerAppRelease(env);
    expect(valid.available).toBe(true);
    expect(parseOwnerAppRelease(valid, env.NEXT_PUBLIC_SITE_URL)).toEqual(valid);
    expect(parseOwnerAppRelease({ available: false }, '')).toEqual({ available: false });
    for (const invalid of [null, {}, [], { ...valid, sha256: 'bad' }, { ...valid, versionCode: -1 },
      { ...valid, versionName: 'bad name' }, { ...valid, notes: 'x'.repeat(401) },
      { ...valid, downloadUrl: 'javascript:alert(1)' }, { ...valid, downloadUrl: 'https://github.com/other/repo/releases/download/v1/app.apk' }]) {
      expect(parseOwnerAppRelease(invalid, env.NEXT_PUBLIC_SITE_URL)).toBeNull();
    }
  });
  it('accepts only positive bounded integer installed versions', () => {
    expect(validNativeVersion('1')).toBe(1);
    for (const invalid of [null, '', '0', '-1', '1.2', 'abc', '1234567890']) expect(validNativeVersion(invalid)).toBeNull();
  });
});
