// @vitest-environment jsdom
import React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
const state = vi.hoisted(() => ({ pricing: null as null | { monthly_paise: number | null; six_months_paise: number | null; yearly_paise: number | null } }));
vi.mock('next/link', () => ({ default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a href={href} {...props}>{children}</a> }));
vi.mock('@/lib/public-pricing', () => ({ getPublicPricing: async () => state.pricing }));
import PricingPage from './page';

afterEach(cleanup);
it('shows the configured prices without inventing a discount or a price for an unavailable term', async () => {
  state.pricing = { monthly_paise: 12345, six_months_paise: null, yearly_paise: 100000 };
  render(await PricingPage());
  expect(screen.getByText('₹123.45')).toBeTruthy();
  expect(screen.getByText('₹1,000')).toBeTruthy();
  expect(screen.getByText('Not currently available')).toBeTruthy();
  expect(screen.getAllByText(/no automatic recurring charge/i).length).toBeGreaterThan(0);
  expect(screen.getAllByRole('link', { name: /apply for your shop/i }).every((link) => link.getAttribute('href') === '/shop/signup')).toBe(true);
});
it('fails honestly when the price source cannot be read', async () => {
  state.pricing = null;
  render(await PricingPage());
  expect(screen.getByRole('status').textContent).toMatch(/temporarily unavailable/i);
  expect(screen.queryByText('₹123.45')).toBeNull();
});
