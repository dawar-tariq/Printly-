import { describe, expect, it } from 'vitest';
import { codeFromPublicId, isGstinFormat, normalizeGstin, normalizeShopName, publicShopPath } from './shop-identity';
import { portalDestination } from './portal-auth';

describe('shop identity', () => {
  it('uses a code rather than the shop name in the customer URL', () => {
    expect(publicShopPath('DEMO1')).toBe('/s/p-demo1');
    expect(codeFromPublicId('p-demo1')).toBe('DEMO1');
    expect(codeFromPublicId('P-AB23CD45')).toBe('AB23CD45');
    expect(codeFromPublicId('demo-prints')).toBeNull();
  });
  it('compares names ignoring case and repeated whitespace', () => {
    expect(normalizeShopName('  Bright   PRINTS  ')).toBe(normalizeShopName('bright prints'));
    expect(normalizeShopName('Bright Prints')).not.toBe(normalizeShopName('Bright Print'));
  });
  it('checks GSTIN format without claiming registration is verified', () => {
    expect(normalizeGstin('01abcde1234f1z5')).toBe('01ABCDE1234F1Z5');
    expect(isGstinFormat('01abcde1234f1z5')).toBe(true);
    expect(isGstinFormat('fake-number')).toBe(false);
    expect(isGstinFormat('01ABCDE1234F0Z5')).toBe(false);
  });
});

describe('portal destinations', () => {
  it('keeps admins and shops in their own portals', () => {
    expect(portalDestination('admin', '/admin/shops?kyc=pending')).toBe('/admin/shops?kyc=pending');
    expect(portalDestination('admin', '/shop')).toBe('/admin');
    expect(portalDestination('shop', '/admin')).toBe('/shop');
  });
  it('rejects external, protocol-relative and login-loop destinations', () => {
    expect(portalDestination('admin', 'https://evil.example/admin')).toBe('/admin');
    expect(portalDestination('shop', '//evil.example/shop')).toBe('/shop');
    expect(portalDestination('admin', '/admin/login')).toBe('/admin');
    expect(portalDestination('shop', '/shop/signup')).toBe('/shop');
  });
});
