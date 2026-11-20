import type { MetadataRoute } from 'next';
import { siteOrigin } from '@/lib/site-origin';

const publicPaths = ['', '/about', '/pricing', '/faq', '/contact', '/privacy', '/terms', '/refunds', '/cookies', '/copyright', '/security', '/accessibility', '/shop/signup'];

export default function sitemap(): MetadataRoute.Sitemap {
  const origin = siteOrigin(process.env.NEXT_PUBLIC_SITE_URL);
  if (!origin) return [];
  return publicPaths.map((path) => ({ url: `${origin}${path || '/'}`, changeFrequency: path === '' || path === '/pricing' ? 'weekly' : 'monthly', priority: path === '' ? 1 : 0.7 }));
}
