import { publicShopPath } from '@/lib/shop-identity';

export const STANDEE_THEMES = {
  orange: { label: 'Printly orange', accent: '#c2410c', cream: '#fffaf4', peach: '#fff0e3', border: '#edc5aa' },
  deep: { label: 'Deep orange', accent: '#9a3412', cream: '#fffaf4', peach: '#fff0e3', border: '#ddad91' },
} as const;

export type StandeeTheme = keyof typeof STANDEE_THEMES;
export type StandeeInfo = {
  shop_name: string;
  owner_name: string;
  short_code: string;
  order_url: string;
  status: string;
  kyc_status: string;
};

export function isStandeeTheme(value: string): value is StandeeTheme {
  return Object.prototype.hasOwnProperty.call(STANDEE_THEMES, value);
}

/** The canonical site URL is configured on the server, never taken from a request Host header. */
export function standeeOrderUrl(siteUrl: string | undefined, shortCode: string, production = process.env.NODE_ENV === 'production'): string {
  if (!siteUrl || !/^[a-z0-9]{4,16}$/i.test(shortCode)) throw new Error('The shop URL is not configured correctly.');
  let base: URL;
  try { base = new URL(siteUrl); } catch { throw new Error('The shop URL is not configured correctly.'); }
  if (!['http:', 'https:'].includes(base.protocol) || (production && base.protocol !== 'https:') ||
      base.username || base.password || base.search || base.hash || !['', '/'].includes(base.pathname)) {
    throw new Error('The shop URL is not configured correctly.');
  }
  const result = `${base.origin}${publicShopPath(shortCode)}/order`;
  // Keep QR modules generously sized on A4; reject an unexpectedly long host.
  if (new TextEncoder().encode(result).length > 180) throw new Error('The shop URL is too long to print reliably.');
  return result;
}
