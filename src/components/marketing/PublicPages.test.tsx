// @vitest-environment jsdom
import React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
vi.mock('next/link', () => ({ default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a href={href} {...props}>{children}</a> }));
import CopyrightPage from '@/app/copyright/page';
import AboutPage from '@/app/about/page';
import FaqPage from '@/app/faq/page';
import ContactPage from '@/app/contact/page';
afterEach(cleanup);
it('keeps policy navigation connected to its actual sections', () => {
  render(<CopyrightPage />);
  const nav = screen.getByRole('navigation', { name: 'On this page' });
  const anchors = Array.from(nav.querySelectorAll('a'));
  expect(anchors.length).toBe(4);
  for (const anchor of anchors) expect(document.getElementById(anchor.getAttribute('href')!.slice(1))).toBeTruthy();
  expect(screen.getByText(/Files you provide remain your content/)).toBeTruthy();
});
it('keeps the about page image-free and linked to shop signup', () => {
  render(<AboutPage />);
  expect(document.querySelector('main img')).toBeNull();
  expect(screen.getByRole('link', { name: /bring your shop on board/i }).getAttribute('href')).toBe('/shop/signup');
});
it('retains accessible FAQ accordions and working topic links', () => {
  render(<FaqPage />);
  const link = document.querySelector('a[href="#faq-group-0"]');
  expect(link).toBeTruthy();
  expect(document.getElementById('faq-group-0')).toBeTruthy();
  expect(screen.getByText('Do I need to download an app?').closest('details')).toBeTruthy();
});
it('routes platform and order support to the right places', () => {
  render(<ContactPage />);
  expect(screen.getByRole('link', { name: /write to support/i }).getAttribute('href')).toBe('/support');
  expect(screen.getByText(/contact the shop directly/i)).toBeTruthy();
});
