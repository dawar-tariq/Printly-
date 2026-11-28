// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

const state = vi.hoisted(() => ({ pathname: '/shop/home' }));
vi.mock('next/navigation', () => ({ usePathname: () => state.pathname }));
vi.mock('next/link', () => ({ default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a href={href} {...props}>{children}</a> }));
vi.mock('@/components/Logo', () => ({ Logo: () => null }));
vi.mock('@/components/SignOutButton', () => ({ SignOutButton: () => null }));
vi.mock('@/components/SubscriptionNotice', () => ({ SubscriptionNotice: () => null }));
vi.mock('@/components/ShopAvailability', () => ({ ShopAvailability: ({ initialOpen, isOwner }: { initialOpen: boolean; isOwner: boolean }) => <span data-testid="availability">{`${initialOpen}:${isOwner}`}</span> }));
vi.mock('@/components/ShopApplicationStatus', () => ({ ShopApplicationStatus: () => null }));
vi.mock('@/components/OwnerAppUpdatePrompt', () => ({ OwnerAppUpdatePrompt: () => null }));
import { ShopShell } from './ShopShell';
import { RestrictedShopShell } from './RestrictedShopShell';

afterEach(cleanup);
const shop = { id: 'shop', name: 'Shop', slug: 'shop', short_code: 'P12345', kyc_status: 'approved', status: 'active', is_open: true };
describe('availability location', () => {
  it('shows the control on home for owner and staff with the correct props', () => {
    state.pathname = '/shop/home';
    const view = render(<ShopShell shop={shop} reviewNote="" subscription={null} warningDays={7} isOwner><p>Home</p></ShopShell>);
    expect(screen.getByTestId('availability').textContent).toBe('true:true');
    view.rerender(<ShopShell shop={{ ...shop, is_open: false }} reviewNote="" subscription={null} warningDays={7} isOwner={false}><p>Home</p></ShopShell>);
    expect(screen.getByTestId('availability').textContent).toBe('false:false');
  });
  it.each(['/shop', '/shop/orders/123', '/shop/inventory', '/shop/reports', '/shop/more', '/shop/settings', '/shop/home/other'])('hides the control on %s', (path) => {
    state.pathname = path;
    render(<ShopShell shop={shop} reviewNote="" subscription={null} warningDays={7} isOwner><p>Page</p></ShopShell>);
    expect(screen.queryByTestId('availability')).toBeNull();
  });
  it.each(['/shop/subscription', '/shop/recovery', '/shop/app'])('hides it in restricted pages such as %s', (path) => {
    state.pathname = path;
    render(<RestrictedShopShell shopName="Shop" isOpen active={false} subscription={null} warningDays={7} isOwner><p>Page</p></RestrictedShopShell>);
    expect(screen.queryByTestId('availability')).toBeNull();
  });
});
