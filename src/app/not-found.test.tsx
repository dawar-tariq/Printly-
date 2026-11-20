// @vitest-environment jsdom
import React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
vi.mock('next/link', () => ({ default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a href={href} {...props}>{children}</a> }));
import NotFound from './not-found';

afterEach(cleanup);

it('offers a branded way back from missing pages', () => {
  render(<NotFound />);
  expect(screen.getByRole('heading', { name: 'We couldn’t find that page.' })).toBeTruthy();
  expect(screen.getByRole('link', { name: 'Printly' }).getAttribute('href')).toBe('/');
  expect(screen.getByRole('link', { name: 'Back to Printly' }).getAttribute('href')).toBe('/');
});
