import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseNativeUpdateRelease, verifyGithubReleaseAsset } from './native-app-update-server';
import { approvedGithubApkUrl, approvedNotificationImageUrl, campaignSchema, releaseSchema } from './native-notification-management';

const url = 'https://github.com/dawar-tariq/Printly-/releases/download/v2.1.0/owner.apk';
const sha = 'a'.repeat(64); const cert = 'b'.repeat(64);
const release = { available: true, versionCode: 5, versionName: '2.1.0', minimumVersionCode: 4, packageName: 'io.github.dawartariq.printly.owner',
  downloadUrl: url, sha256: sha, notes: 'Updates', mandatory: true, releasedAt: '2026-01-01T00:00:00Z' };
const entry = { apk_url: url, apk_sha256: sha, certificate_sha256: cert };
const github = { draft: false, prerelease: false, tag_name: 'v2.1.0', assets: [{ name: 'owner.apk', state: 'uploaded', browser_download_url: url, digest: `sha256:${sha}` }] };
afterEach(() => vi.unstubAllEnvs());

describe('managed native release and notification contracts', () => {
  it('rejects untrusted URLs and malformed update policies', () => {
    expect(parseNativeUpdateRelease(release)).toEqual(release);
    for (const bad of ['https://evil.test/app.apk', `${url}?token=secret`, url.replace('dawar-tariq', 'other'), url.replace('https:', 'http:'), url.replace('/v2.1.0/', '/v1%2Fother/')]) expect(approvedGithubApkUrl(bad)).toBeNull();
    for (const invalid of [{ ...release, minimumVersionCode: 6 }, { ...release, packageName: 'other' }, { ...release, sha256: 'bad' },
      { ...release, downloadUrl: `${url}?x=1` }, { ...release, notes: 'invalid\u0007bell' }, { ...release, notes: 'invalid\u007fdelete' },
      { ...release, surprise: true }]) expect(parseNativeUpdateRelease(invalid)).toBeNull();
    expect(parseNativeUpdateRelease({ ...release, notes: 'First line\nSecond line\twith a tab' })).not.toBeNull();
    for (const releasedAt of ['2026-01-01T00:00:00.123456789Z', '2026-01-01T00:00:00+18:00', '2026-01-01T00:00:00-05:30']) {
      expect(parseNativeUpdateRelease({ ...release, releasedAt })).not.toBeNull();
    }
    for (const releasedAt of ['2026-01-01T00:00:00.1234567890Z', '2026-01-01T00:00:00+18:01', '2026-01-01T00:00:00-23:59']) {
      expect(parseNativeUpdateRelease({ ...release, releasedAt })).toBeNull();
    }
    const draft = { version_code: 5, version_name: '2.1.0', minimum_version_code: 4, apk_url: 'https://github.com/dawar-tariq/Printly-/releases/download/native-v2.1.0/Printly-for-Shops-2.1.0.apk', apk_sha256: sha, certificate_sha256: cert, notes: '', mandatory: false, released_at: '2026-01-01T00:00:00Z' };
    expect(releaseSchema.safeParse(draft).success).toBe(true);
    expect(releaseSchema.safeParse({ ...draft, version_name: '2.1.0.3', version_code: 9 }).success).toBe(false);
    expect(releaseSchema.safeParse({ ...draft, minimum_version_code: 6 }).success).toBe(false);
    expect(releaseSchema.safeParse({ ...draft, released_at: '2026-01-01T00:00:00+18:01' }).success).toBe(false);
    expect(releaseSchema.safeParse({ ...draft, released_at: '2026-01-01T00:00:00.1234567890Z' }).success).toBe(false);
  });
  it('limits notification images and recipients', () => {
    const image = 'https://raw.githubusercontent.com/dawar-tariq/Printly-/main/public/notice.png';
    expect(approvedNotificationImageUrl(image)).toBe(image);
    for (const bad of [`${image}?secret=1`, image.replace('dawar-tariq', 'other'), 'https://127.0.0.1/test.png', 'https://raw.githubusercontent.com/dawar-tariq/Printly-/main/../x.png']) expect(approvedNotificationImageUrl(bad)).toBeNull();
    const base = { title: 'Notice', message: 'Hello', notification_type: 'general', tap_action: 'home', image_url: null, audience_kind: 'shops', shop_ids: ['11111111-1111-4111-8111-111111111111'], device_ids: [], target_version: null };
    expect(campaignSchema.safeParse(base).success).toBe(true);
    expect(campaignSchema.safeParse({ ...base, shop_ids: [...base.shop_ids, ...base.shop_ids] }).success).toBe(false);
    expect(campaignSchema.safeParse({ ...base, tap_action: 'https://example.test' }).success).toBe(false);
  });
  it('checks the GitHub asset digest and configured fingerprint, not merely the URL', async () => {
    const fetcher = vi.fn(async (address: string | URL | Request, init?: RequestInit) => {
      expect(address).toBe('https://api.github.com/repos/dawar-tariq/Printly-/releases/tags/v2.1.0');
      expect(init?.redirect).toBe('error'); return Response.json(github);
    }) as unknown as typeof fetch;
    expect(await verifyGithubReleaseAsset(entry, cert.toUpperCase().match(/../g)!.join(':'), fetcher)).toBe('ok');
    expect(await verifyGithubReleaseAsset(entry, 'c'.repeat(64), fetcher)).toBe('fingerprint');
    expect(await verifyGithubReleaseAsset(entry, cert, vi.fn(async () => Response.json({ ...github, draft: true })) as unknown as typeof fetch)).toBe('asset');
    expect(await verifyGithubReleaseAsset(entry, cert, vi.fn(async () => Response.json({ ...github, assets: [{ ...github.assets[0], digest: 'sha256:wrong' }] })) as unknown as typeof fetch)).toBe('asset');
    expect(await verifyGithubReleaseAsset(entry, cert, vi.fn(async () => new Response(null, { status: 503 })) as unknown as typeof fetch)).toBe('unavailable');
  });
});
