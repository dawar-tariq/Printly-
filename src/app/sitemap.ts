import type { MetadataRoute } from 'next';
import { PUBLIC_PAGE_PATHS } from '@/lib/public-pages';
import { siteOrigin } from '@/lib/site-origin';

export default function sitemap(): MetadataRoute.Sitemap {
  const origin = siteOrigin(process.env.NEXT_PUBLIC_SITE_URL);
  if (!origin) return [];
  return PUBLIC_PAGE_PATHS.map((path) => ({ url: `${origin}${path}`, changeFrequency: path === '/' || path === '/pricing' ? 'weekly' : 'monthly', priority: path === '/' ? 1 : 0.7 }));
}
