/** Validate the one canonical origin used for public links and metadata. */
export function siteOrigin(value: string | undefined, production = process.env.NODE_ENV === 'production'): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || (production && url.protocol !== 'https:') ||
        url.username || url.password || url.search || url.hash || !['', '/'].includes(url.pathname)) return null;
    return url.origin;
  } catch { return null; }
}
