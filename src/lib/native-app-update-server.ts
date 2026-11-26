import 'server-only';
import { z } from 'zod';
import { createAdminSupabase } from '@/lib/supabase';
import { approvedGithubApkUrl, hasSafeNativeTextControls, nativeReleaseInstantSchema } from '@/lib/native-notification-management';
import { nativePushTarget } from '@/lib/native-push-server';

export const OWNER_PACKAGE = 'io.github.dawartariq.printly.owner';
const release = z.object({
  available: z.literal(true), versionCode: z.number().int().min(1).max(999_999_999),
  versionName: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._+-]{0,39}$/),
  minimumVersionCode: z.number().int().min(1).max(999_999_999), packageName: z.literal(OWNER_PACKAGE),
  downloadUrl: z.string().refine((value) => !!approvedGithubApkUrl(value)),
  sha256: z.string().regex(/^[a-f0-9]{64}$/), notes: z.string().max(400).refine(hasSafeNativeTextControls), mandatory: z.boolean(),
  releasedAt: nativeReleaseInstantSchema,
}).strict().refine((value) => value.minimumVersionCode <= value.versionCode);
export type NativeUpdateRelease = z.infer<typeof release>;
export function parseNativeUpdateRelease(value: unknown): NativeUpdateRelease | null {
  const result = release.safeParse(value);
  return result.success ? result.data : null;
}

/** Public metadata, fetched through the service role and validated again.
 * Test builds use a different application ID/signing key, so never advertise a
 * production APK to the isolated test package. A database failure is not the
 * same as an intentional unpublish: callers can retain a cached policy. */
export async function currentNativeAppRelease(): Promise<{ available: false } | NativeUpdateRelease | null> {
  if (process.env.PRINTLY_NATIVE_RELEASE_MANAGER_ENABLED !== '1') return { available: false };
  const target = nativePushTarget();
  if (!target) return null;
  if (target === 'isolated') return { available: false };
  try {
    const { data, error } = await createAdminSupabase().rpc('current_native_app_release');
    if (error) return null;
    if (data === null) return { available: false };
    return parseNativeUpdateRelease(data);
  } catch { return null; }
}

/** Check the public GitHub release metadata before activation/publishing.
 * This verifies the hosted asset's recorded byte digest, not its Android
 * manifest or signer. The latter still needs independent apksigner review. */
export async function verifyGithubReleaseAsset(
  entry: { apk_url: string; apk_sha256: string; certificate_sha256: string },
  expectedFingerprint: string | undefined,
  fetcher: typeof fetch = fetch,
): Promise<'ok' | 'fingerprint' | 'asset' | 'unavailable'> {
  const expected = (expectedFingerprint ?? '').replace(/[:\s]/g, '').toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(expected) || entry.certificate_sha256 !== expected) return 'fingerprint';
  const approved = approvedGithubApkUrl(entry.apk_url);
  if (!approved || !/^[a-f0-9]{64}$/.test(entry.apk_sha256)) return 'asset';
  const parts = new URL(approved).pathname.split('/');
  const tag = parts[5];
  const assetName = parts[6];
  try {
    const response = await fetcher(`https://api.github.com/repos/dawar-tariq/Printly-/releases/tags/${encodeURIComponent(tag)}`, {
      headers: { accept: 'application/vnd.github+json', 'user-agent': 'Printly-Release-Manager' },
      redirect: 'error', signal: AbortSignal.timeout(10_000), cache: 'no-store',
    });
    if (response.status === 404) return 'asset';
    if (!response.ok || !response.body) return 'unavailable';
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      for (;;) {
        const part = await reader.read();
        if (part.done) break;
        total += part.value.byteLength;
        if (total > 1_000_000) { await reader.cancel(); return 'unavailable'; }
        chunks.push(part.value);
      }
    } finally { reader.releaseLock(); }
    const data: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!data || typeof data !== 'object' || Array.isArray(data)) return 'unavailable';
    const record = data as Record<string, unknown>;
    if (record.draft !== false || record.prerelease !== false || record.tag_name !== tag || !Array.isArray(record.assets)) return 'asset';
    const matches = record.assets.filter((candidate: unknown) => {
      if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return false;
      const asset = candidate as Record<string, unknown>;
      return asset.name === assetName && asset.state === 'uploaded' && asset.browser_download_url === approved && asset.digest === `sha256:${entry.apk_sha256}`;
    });
    return matches.length === 1 ? 'ok' : 'asset';
  } catch { return 'unavailable'; }
}
