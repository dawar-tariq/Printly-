import { siteOrigin } from '@/lib/site-origin';

/** Only these public pages receive canonical URLs and appear in the sitemap. */
export const PUBLIC_PAGE_PATHS = [
  '/', '/about', '/pricing', '/faq', '/contact', '/privacy', '/terms',
  '/refunds', '/cookies', '/copyright', '/security', '/accessibility', '/shop/signup',
] as const;

export type PublicPagePath = (typeof PUBLIC_PAGE_PATHS)[number];

export function publicCanonical(path: PublicPagePath): { canonical: string } | undefined {
  const origin = siteOrigin(process.env.NEXT_PUBLIC_SITE_URL);
  return origin ? { canonical: `${origin}${path}` } : undefined;
}
