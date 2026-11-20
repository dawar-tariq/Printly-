import type { MetadataRoute } from 'next';
import { siteOrigin } from '@/lib/site-origin';

export default function robots(): MetadataRoute.Robots {
  const origin = siteOrigin(process.env.NEXT_PUBLIC_SITE_URL);
  return { rules: { userAgent: '*', allow: ['/', '/shop/signup'], disallow: ['/api/', '/admin/', '/shop/', '/track/', '/s/*/order'] }, ...(origin ? { sitemap: `${origin}/sitemap.xml` } : {}) };
}
