// @vitest-environment jsdom
import React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
vi.mock('next/link', () => ({ default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a href={href} {...props}>{children}</a> }));
import HomePage from './page';

afterEach(cleanup);

it('keeps the administrator portal off the shop-facing landing page', () => {
  render(<HomePage />);
  expect(screen.getByRole('link', { name: 'Shop sign in' }).getAttribute('href')).toBe('/login');
  expect(screen.queryByRole('link', { name: /admin sign in/i })).toBeNull();
});
