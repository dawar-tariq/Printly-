export type OwnerAppRelease =
  | { available: false }
  | { available: true; versionCode: number; versionName: string; downloadUrl: string; sha256: string; notes: string };

type ReleaseEnvironment = Record<string, string | undefined>;
const VERSION_NAME = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,39}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const DOWNLOAD_FILE = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,119}\.apk$/i;
const RELEASE_TAG = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,79}$/;

/** Limit links to a simple HTTPS file path on our site or this repository's releases. */
export function approvedOwnerApkUrl(rawUrl: string, siteUrl: string): string | null {
  try {
    const site = new URL(siteUrl);
    if (site.protocol !== 'https:' || site.username || site.password || site.pathname !== '/' || site.search || site.hash) return null;
    const url = new URL(rawUrl, site);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) return null;
    const parts = url.pathname.split('/');
    const ownDownload = url.origin === site.origin && parts.length === 3 && parts[1] === 'downloads' && DOWNLOAD_FILE.test(parts[2]);
    const githubRelease = url.origin === 'https://github.com' && parts.length === 7 &&
      parts[1] === 'dawar-tariq' && parts[2] === 'Printly-' && parts[3] === 'releases' && parts[4] === 'download' &&
      RELEASE_TAG.test(parts[5]) && DOWNLOAD_FILE.test(parts[6]);
    return ownDownload || githubRelease ? url.toString() : null;
  } catch { return null; }
}

/** Reject malformed or untrusted responses before rendering an app download link. */
export function parseOwnerAppRelease(value: unknown, siteUrl: string): OwnerAppRelease | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  if (item.available === false) return { available: false };
  if (item.available !== true || typeof item.versionCode !== 'number' || !Number.isSafeInteger(item.versionCode) ||
      item.versionCode < 1 || item.versionCode > 999_999_999 || typeof item.versionName !== 'string' || !VERSION_NAME.test(item.versionName) ||
      typeof item.sha256 !== 'string' || !SHA256.test(item.sha256) || typeof item.notes !== 'string' || item.notes.length > 400 ||
      typeof item.downloadUrl !== 'string') return null;
  const downloadUrl = approvedOwnerApkUrl(item.downloadUrl, siteUrl);
  if (!downloadUrl) return null;
  return { available: true, versionCode: item.versionCode, versionName: item.versionName, downloadUrl, sha256: item.sha256, notes: item.notes };
}

/** Only advertise a complete, explicitly configured release; configuration is not signature verification. */
export function ownerAppRelease(env: ReleaseEnvironment): OwnerAppRelease {
  const rawCode = env.PRINTLY_ANDROID_VERSION_CODE?.trim() ?? '';
  const candidate = {
    available: true,
    versionCode: /^[1-9]\d{0,8}$/.test(rawCode) ? Number(rawCode) : 0,
    versionName: env.PRINTLY_ANDROID_VERSION_NAME?.trim() ?? '',
    sha256: env.PRINTLY_ANDROID_APK_SHA256?.trim().toLowerCase() ?? '',
    downloadUrl: env.PRINTLY_ANDROID_APK_URL?.trim() ?? '',
    notes: (env.PRINTLY_ANDROID_RELEASE_NOTES ?? '').trim().slice(0, 400),
  };
  return parseOwnerAppRelease(candidate, env.NEXT_PUBLIC_SITE_URL ?? '') ?? { available: false };
}

export function validNativeVersion(value: string | null): number | null {
  return value && /^[1-9]\d{0,8}$/.test(value) ? Number(value) : null;
}
