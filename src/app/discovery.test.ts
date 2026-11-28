import { afterEach, expect, it, vi } from 'vitest';
import robots from './robots';
import sitemap from './sitemap';

afterEach(() => vi.unstubAllEnvs());
it('does not publish a sitemap or invite indexing for the isolated test site', () => {
  vi.stubEnv('PRINTLY_ISOLATED_TEST', '1');
  vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://printly-native-test.vercel.app');
  expect(sitemap()).toEqual([]);
  expect(robots()).toEqual({ rules: { userAgent: '*', disallow: '/' } });
});
it('lists public information pages at the configured origin without tracking links', () => {
  vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://printly.example');
  const urls = sitemap().map((entry) => entry.url);
  expect(urls).toContain('https://printly.example/');
  expect(urls).toContain('https://printly.example/pricing');
  expect(urls).toContain('https://printly.example/privacy');
  expect(urls.some((url) => url.includes('/track/'))).toBe(false);
  expect(robots().sitemap).toBe('https://printly.example/sitemap.xml');
});
it('does not invent a domain if the site origin is missing or malformed', () => {
  vi.stubEnv('NEXT_PUBLIC_SITE_URL', '');
  expect(sitemap()).toEqual([]);
  expect(robots().sitemap).toBeUndefined();
  for (const value of ['https://user:secret@invalid.example', 'https://printly.example/path', 'https://printly.example/?secret=1']) {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', value);
    expect(sitemap()).toEqual([]);
    expect(robots().sitemap).toBeUndefined();
  }
});
