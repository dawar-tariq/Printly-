import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ open: true, subscribed: true }));
vi.mock('next/link', () => ({ default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a href={href} {...props}>{children}</a> }));
vi.mock('@/lib/public-shop', () => ({ findPublicShop: async () => ({ data: {
  id: '11111111-1111-4111-8111-111111111111', short_code: 'DEMO1', slug: 'demo-shop', name: 'Demo Prints',
  status: 'active', is_open: state.open, address: 'Market', city: 'Srinagar', phone: '', eta_minutes: 20, rating_avg: 0, rating_count: 0,
}, error: null }) }));
vi.mock('@/lib/subscription-server', () => ({ shopHasSubscription: async () => state.subscribed }));
vi.mock('@/lib/supabase', () => ({
  createAdminSupabase: () => ({}),
  createServerSupabase: async () => ({ from: (table: string) => ({ select: () => ({ eq: () => table === 'shop_services'
    ? { eq: () => ({ order: async () => ({ data: [] }) }) }
    : Promise.resolve({ data: [] }) }) }) }),
}));
import ShopLandingPage from './page';
beforeEach(() => { state.open = true; state.subscribed = true; });

const view = async () => renderToStaticMarkup(await ShopLandingPage({ params: Promise.resolve({ slug: 'p-demo1' }) }));
describe('public shop availability', () => {
  it('shows a start-order link only while the shop is accepting orders', async () => {
    expect(await view()).toContain('Start your order');
    state.open = false;
    const closed = await view();
    expect(closed).toContain('This shop is closed');
    expect(closed).not.toContain('Start your order');
    expect(closed).toContain('Return to a previous checkout');
    expect(closed).toContain('href="/s/p-demo1/order"');
  });
  it('does not allow orders merely because the owner switch is open', async () => {
    state.subscribed = false;
    const markup = await view();
    expect(markup).toContain('not accepting orders');
    expect(markup).not.toContain('Start your order');
  });
});
