import { afterEach, expect, it, vi } from 'vitest';
import { PUBLIC_PAGE_PATHS, publicCanonical } from '@/lib/public-pages';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

it('emits a distinct canonical URL for each indexable public page', async () => {
  vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://printly.example/');
  vi.resetModules();
  const pages = [
    ['/', () => import('./page')],
    ['/about', () => import('./about/page')],
    ['/pricing', () => import('./pricing/page')],
    ['/faq', () => import('./faq/page')],
    ['/contact', () => import('./contact/page')],
    ['/privacy', () => import('./privacy/page')],
    ['/terms', () => import('./terms/page')],
    ['/refunds', () => import('./refunds/page')],
    ['/cookies', () => import('./cookies/page')],
    ['/copyright', () => import('./copyright/page')],
    ['/security', () => import('./security/page')],
    ['/accessibility', () => import('./accessibility/page')],
    ['/shop/signup', () => import('./shop/signup/layout')],
  ] as const;
  expect(pages.map(([path]) => path)).toEqual(PUBLIC_PAGE_PATHS);
  for (const [path, load] of pages) {
    expect((await load()).metadata.alternates?.canonical).toBe(`https://printly.example${path}`);
  }
});

it('does not create a canonical URL when the configured origin is missing or unsafe', () => {
  vi.stubEnv('NODE_ENV', 'production');
  for (const value of ['', 'https://user:secret@example.com', 'https://example.com/path', 'http://example.com']) {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', value);
    expect(publicCanonical('/pricing')).toBeUndefined();
  }
});
