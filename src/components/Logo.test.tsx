// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { PRINTLY_INK, PRINTLY_MARK_PATH, PRINTLY_ORANGE, PRINTLY_WORDMARK_PATH } from '@/lib/brand';

vi.mock('next/link', () => ({ default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a href={href} {...props}>{children}</a> }));
import { Logo } from './Logo';

afterEach(cleanup);

describe('Printly logo', () => {
  it('uses the selected artwork and has an accessible home link', () => {
    const { container } = render(<Logo />);
    expect(screen.getByRole('link', { name: 'Printly' }).getAttribute('href')).toBe('/');
    const paths = container.querySelectorAll('svg path');
    expect(paths[0].getAttribute('d')).toBe(PRINTLY_MARK_PATH);
    expect(paths[0].getAttribute('fill')).toBe(PRINTLY_ORANGE);
    expect(paths[1].getAttribute('d')).toBe(PRINTLY_WORDMARK_PATH);
    expect(paths[1].getAttribute('fill')).toBe(PRINTLY_INK);
  });

  it('supports dark headers and a compact shop header on small screens', () => {
    const { container } = render(<Logo href="/admin" inverse compactOnMobile />);
    expect(screen.getByRole('link', { name: 'Printly' }).getAttribute('href')).toBe('/admin');
    const icons = container.querySelectorAll('svg');
    expect(icons).toHaveLength(2);
    expect(icons[1].querySelectorAll('path')[1].getAttribute('fill')).toBe('#ffffff');
  });
});
