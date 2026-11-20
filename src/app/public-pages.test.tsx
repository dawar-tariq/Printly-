// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
vi.mock('next/link', () => ({ default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a href={href} {...props}>{children}</a> }));
import PrivacyPage from './privacy/page';
import TermsPage from './terms/page';
import CopyrightPage from './copyright/page';
import ContactPage from './contact/page';
import FaqPage from './faq/page';
import RefundsPage from './refunds/page';
import AboutPage from './about/page';
import CookiesPage from './cookies/page';
import SecurityPage from './security/page';
import AccessibilityPage from './accessibility/page';

afterEach(cleanup);
describe('public information pages', () => {
  it.each([
    [PrivacyPage, 'Privacy policy'], [TermsPage, 'Terms & conditions'], [CopyrightPage, 'Copyright'],
    [RefundsPage, 'Refunds & cancellations'], [CookiesPage, 'Cookie notice'], [SecurityPage, 'Security at Printly'],
    [AccessibilityPage, 'Accessibility'], [ContactPage, 'A little help, right where you need it.'],
    [AboutPage, 'For the shops that make things happen.'], [FaqPage, 'A little clarity goes a long way.'],
  ])('renders a useful page with a main heading and shared navigation', (Page, heading) => {
    render(<Page />);
    expect(screen.getByRole('heading', { level: 1, name: heading })).toBeTruthy();
    expect(screen.getByRole('main')).toBeTruthy();
    expect(document.querySelector('a[href="/privacy"]')).toBeTruthy();
  });
  it('is honest about retention, order links, and the missing public support email', () => {
    render(<PrivacyPage />);
    expect(screen.getByText(/does not currently provide a fixed automatic deletion schedule/i)).toBeTruthy();
    expect(screen.getByText(/tracking link can be used to view order status/i)).toBeTruthy();
    expect(screen.getByText(/public Printly support email is not currently listed/i)).toBeTruthy();
    expect(document.querySelector('a[href^="mailto:"]')).toBeNull();
  });
  it('does not promise automatic refunds', () => {
    render(<RefundsPage />);
    expect(screen.getByText(/does not automatically send money back/i)).toBeTruthy();
  });
});
