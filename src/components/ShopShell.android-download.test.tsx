// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';

vi.mock('next/navigation', () => ({ usePathname: () => '/shop/settings' }));
vi.mock('next/link', () => ({ default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a href={href} {...props}>{children}</a> }));
vi.mock('@/components/Logo', () => ({ Logo: () => null }));
vi.mock('@/components/SignOutButton', () => ({ SignOutButton: () => null }));
vi.mock('@/components/SubscriptionNotice', () => ({ SubscriptionNotice: () => null }));
vi.mock('@/components/ShopAvailability', () => ({ ShopAvailability: () => null }));
vi.mock('@/components/ShopApplicationStatus', () => ({ ShopApplicationStatus: () => null }));
vi.mock('@/components/OwnerAppUpdatePrompt', () => ({ OwnerAppUpdatePrompt: () => null }));
import { ShopShell } from './ShopShell';
import { RestrictedShopShell } from './RestrictedShopShell';

afterEach(cleanup);

describe('Android download navigation', () => {
  it('places the Android app option immediately after Settings', () => {
    render(<ShopShell shop={{ id: 'shop', name: 'Example', slug: 'example', short_code: 'P12345', kyc_status: 'approved', status: 'active', is_open: true }}
      reviewNote="" subscription={null} warningDays={7} isOwner><p>Dashboard</p></ShopShell>);
    const nav = within(screen.getByRole('navigation', { name: 'Shop navigation' }));
    const links = nav.getAllByRole('link');
    const settings = links.findIndex((link) => link.textContent?.includes('Settings & QR'));
    expect(settings).toBeGreaterThanOrEqual(0);
    expect(links[settings + 1].textContent).toContain('Android app');
    expect(links[settings + 1].getAttribute('href')).toBe('/shop/app');
  });

  it('keeps the download page reachable when a subscription has expired', () => {
    render(<RestrictedShopShell shopName="Example" active={false} subscription={null} warningDays={7} isOwner><p>Recovery</p></RestrictedShopShell>);
    const nav = within(screen.getByRole('navigation', { name: 'Subscription and recovery' }));
    expect(nav.getByRole('link', { name: /app/i }).getAttribute('href')).toBe('/shop/app');
  });
});
