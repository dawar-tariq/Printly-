// @vitest-environment jsdom
import React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
vi.mock('next/link', () => ({ default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a href={href} {...props}>{children}</a> }));
import HomePage from './page';

afterEach(() => { cleanup(); vi.unstubAllEnvs(); });

it('replaces real-payment marketing with an isolated synthetic-data landing page', () => {
  vi.stubEnv('PRINTLY_ISOLATED_TEST', '1');
  render(<HomePage />);
  expect(screen.getByRole('heading', { name: 'Test with synthetic data only.' })).toBeTruthy();
  expect(screen.getByText(/Never send money/)).toBeTruthy();
  expect(screen.getByText(/Dropbox import is disabled/)).toBeTruthy();
  expect(screen.queryByText(/demo shop has real checkout options/i)).toBeNull();
  expect(screen.queryByText(/pay the shop directly/i)).toBeNull();
  expect(screen.getByRole('link', { name: 'Open test shop' }).getAttribute('href')).toBe('/s/p-demo1');
  expect(screen.getByRole('link', { name: 'Owner test sign in' }).getAttribute('href')).toBe('/login');
  expect(screen.getByRole('link', { name: 'Admin test sign in' }).getAttribute('href')).toBe('/admin/login');
});

it('offers shop sign-in without exposing an admin portal in the public navigation', () => {
  render(<HomePage />);
  expect(screen.getAllByRole('link', { name: 'Shop sign in' }).every((link) => link.getAttribute('href') === '/login')).toBe(true);
  expect(screen.queryByRole('link', { name: /admin sign in/i })).toBeNull();
});

it('explains subscription access and links to the actual signup and pricing pages', () => {
  render(<HomePage />);
  expect(screen.getByText(/one all-features subscription gives your shop/i)).toBeTruthy();
  expect(screen.getByRole('link', { name: /apply to list your shop/i }).getAttribute('href')).toBe('/shop/signup');
  expect(screen.getByRole('link', { name: /see shop pricing/i }).getAttribute('href')).toBe('/pricing');
  expect(screen.queryByText(/list your shop — free/i)).toBeNull();
  expect(screen.queryByText(/4\.6 \(128 ratings\)/i)).toBeNull();
  expect(screen.getByText(/demo shop has real checkout options/i)).toBeTruthy();
});

it('provides expandable FAQs, working navigation and a keyboard-dismissable mobile menu', () => {
  render(<HomePage />);
  const summary = screen.getByText('Do I need to download an app?');
  const details = summary.closest('details')!;
  expect(details.open).toBe(false);
  fireEvent.click(summary);
  expect(details.open).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Open menu' }));
  expect(screen.getByRole('navigation', { name: 'Mobile navigation' })).toBeTruthy();
  fireEvent.keyDown(window, { key: 'Escape' });
  expect(screen.queryByRole('navigation', { name: 'Mobile navigation' })).toBeNull();
  for (const path of ['/privacy', '/terms', '/copyright', '/about', '/faq', '/security']) {
    expect(document.querySelector(`a[href="${path}"]`), path).toBeTruthy();
  }
});
