import type { MetadataRoute } from 'next';
import { siteOrigin } from '@/lib/site-origin';

export default function robots(): MetadataRoute.Robots {
  if (process.env.PRINTLY_ISOLATED_TEST === '1') return { rules: { userAgent: '*', disallow: '/' } };
  const origin = siteOrigin(process.env.NEXT_PUBLIC_SITE_URL);
  return { rules: { userAgent: '*', allow: ['/', '/shop/signup'], disallow: ['/api/', '/admin/', '/shop/', '/track/', '/s/*/order'] }, ...(origin ? { sitemap: `${origin}/sitemap.xml` } : {}) };
}
