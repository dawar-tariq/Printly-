// @vitest-environment jsdom
import React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
const state = vi.hoisted(() => ({ pricing: null as null | { monthly_paise: number | null; six_months_paise: number | null; yearly_paise: number | null }, announcements: [] as any[] | null }));
vi.mock('next/link', () => ({ default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a href={href} {...props}>{children}</a> }));
vi.mock('@/lib/public-pricing', () => ({ getPublicPricing: async () => state.pricing }));
vi.mock('@/lib/subscription-offers-server', () => ({ getPublicSubscriptionAnnouncements: async () => state.announcements }));
import PricingPage from './page';

afterEach(cleanup);
it('shows the configured prices without inventing a discount or a price for an unavailable term', async () => {
  state.pricing = { monthly_paise: 12345, six_months_paise: null, yearly_paise: 100000 };
  render(await PricingPage());
  expect(screen.getByText('₹123.45')).toBeTruthy();
  expect(screen.getByText('₹1,000')).toBeTruthy();
  expect(screen.getByText('Not currently available')).toBeTruthy();
  expect(screen.getByText(/Save ₹481.40 compared with 12 monthly terms/)).toBeTruthy();
  expect(screen.getAllByText(/no automatic recurring charge/i).length).toBeGreaterThan(0);
  expect(screen.getAllByRole('link', { name: /apply for your shop/i }).every((link) => link.getAttribute('href') === '/shop/signup')).toBe(true);
});
it('fails honestly when the price source cannot be read', async () => {
  state.pricing = null;
  render(await PricingPage());
  expect(screen.getByRole('status').textContent).toMatch(/temporarily unavailable/i);
  expect(screen.queryByText('₹123.45')).toBeNull();
});
it('shows a published linked code and accurate eligibility without treating it as the base price', async () => {
  state.pricing = { monthly_paise: 10000, six_months_paise: 55000, yearly_paise: 100000 };
  state.announcements = [{ id: '11111111-1111-4111-8111-111111111111', title: 'A thank-you for shops', message: 'Enjoy a little extra.', ends_at: null,
    promo: { code: 'THANKS20', discount_type: 'percent', discount_value: 20, terms: ['yearly'], ends_at: null } }];
  render(await PricingPage());
  expect(screen.getByText('A thank-you for shops')).toBeTruthy();
  expect(screen.getByText('THANKS20')).toBeTruthy();
  expect(screen.getByText(/Eligible terms: Yearly/)).toBeTruthy();
  expect(screen.getByText('₹1,000')).toBeTruthy();
  expect(screen.getByText(/Save ₹200 compared with 12 monthly terms/)).toBeTruthy();
  state.announcements = [];
});
it('does not call a higher term price a saving', async () => {
  state.pricing = { monthly_paise: 10000, six_months_paise: 70000, yearly_paise: null };
  state.announcements = [];
  render(await PricingPage());
  expect(screen.getByText(/₹100 more compared with 6 monthly terms/)).toBeTruthy();
  expect(screen.queryByText(/Save ₹100 compared with 6 monthly terms/)).toBeNull();
});
