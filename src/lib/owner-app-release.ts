export type OwnerAppRelease =
  | { available: false }
  | { available: true; versionCode: number; versionName: string; downloadUrl: string; sha256: string; notes: string };

type ReleaseEnvironment = Record<string, string | undefined>;

/**
 * Only advertise a complete, explicitly configured Android release. A release
 * URL must be HTTPS and either our own /downloads path or this repository's
 * GitHub Releases. Android also verifies that upgrades use the original key.
 */
export function ownerAppRelease(env: ReleaseEnvironment): OwnerAppRelease {
  const rawCode = env.PRINTLY_ANDROID_VERSION_CODE?.trim() ?? '';
  const versionName = env.PRINTLY_ANDROID_VERSION_NAME?.trim() ?? '';
  const sha256 = env.PRINTLY_ANDROID_APK_SHA256?.trim().toLowerCase() ?? '';
  const rawUrl = env.PRINTLY_ANDROID_APK_URL?.trim() ?? '';
  if (!/^[1-9]\d{0,8}$/.test(rawCode) || !/^[A-Za-z0-9][A-Za-z0-9._+-]{0,39}$/.test(versionName) || !/^[a-f0-9]{64}$/.test(sha256) || !rawUrl) return { available: false };
  try {
    const site = new URL(env.NEXT_PUBLIC_SITE_URL ?? '');
    const url = new URL(rawUrl, site);
    if (site.protocol !== 'https:' || url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || !url.pathname.toLowerCase().endsWith('.apk')) return { available: false };
    const ownDownload = url.origin === site.origin && url.pathname.startsWith('/downloads/');
    const githubRelease = url.origin === 'https://github.com' && url.pathname.startsWith('/dawar-tariq/Printly-/releases/download/');
    if (!ownDownload && !githubRelease) return { available: false };
    return { available: true, versionCode: Number(rawCode), versionName, downloadUrl: url.toString(), sha256, notes: (env.PRINTLY_ANDROID_RELEASE_NOTES ?? '').trim().slice(0, 400) };
  } catch {
    return { available: false };
  }
}

export function validNativeVersion(value: string | null): number | null {
  return value && /^[1-9]\d{0,8}$/.test(value) ? Number(value) : null;
}
