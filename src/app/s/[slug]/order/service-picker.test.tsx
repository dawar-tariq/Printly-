// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';

vi.mock('next/navigation', () => ({ useParams: () => ({ slug: 'p-demo1' }), useRouter: () => ({ push: vi.fn() }) }));
vi.mock('next/link', () => ({ default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a href={href} {...props}>{children}</a> }));
vi.mock('@/lib/supabase-client', () => ({ createBrowserSupabase: vi.fn() }));
import OrderWizard from './page';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('customer service picker', () => {
  it('makes the selected service clearly visible and accessible', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      shop: { name: 'Demo Prints', status: 'active' }, accepting_orders: true,
      services: [{ service: 'print', enabled: true }, { service: 'photocopy', enabled: true }, { service: 'scan', enabled: false }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })));
    render(<OrderWizard />);
    const print = await screen.findByRole('button', { name: /print pdf/i });
    const copy = screen.getByRole('button', { name: /photocopy/i });
    const next = screen.getByRole('button', { name: 'Continue' }) as HTMLButtonElement;
    expect(next.disabled).toBe(true);
    expect(print.getAttribute('aria-pressed')).toBe('false');
    expect(screen.queryByRole('button', { name: /^scan/i })).toBeNull();

    fireEvent.click(copy);
    expect(copy.getAttribute('aria-pressed')).toBe('true');
    expect(copy.className).toContain('bg-orange-100');
    expect(copy.textContent).toContain('Selected');
    expect(next.disabled).toBe(false);

    fireEvent.click(print);
    expect(print.getAttribute('aria-pressed')).toBe('true');
    expect(copy.getAttribute('aria-pressed')).toBe('false');
    expect(copy.textContent).not.toContain('Selected');
  });

  it('does not accept orders when subscription availability is false', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ shop: { name: 'Demo', status: 'active' }, accepting_orders: false, services: [{ service: 'print', enabled: true }] })));
    render(<OrderWizard />);
    fireEvent.click(await screen.findByRole('button', { name: /print pdf/i }));
    expect((screen.getByRole('button', { name: 'Continue' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/not accepting orders right now/i)).toBeTruthy();
  });

  it('shows a closed notice and disables ordering when the owner closes the shop', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ shop: { name: 'Demo', status: 'active', is_open: false }, accepting_orders: false, services: [{ service: 'print', enabled: true }] })));
    render(<OrderWizard />);
    fireEvent.click(await screen.findByRole('button', { name: /print pdf/i }));
    expect(screen.getByText(/This shop is closed/i)).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Continue' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('does not advance when order creation fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => url.startsWith('/api/shops/')
      ? Response.json({ shop: { name: 'Demo', status: 'active' }, accepting_orders: true, services: [{ service: 'print', enabled: true }] })
      : Response.json({ error: { message: 'Shop is unavailable' } }, { status: 403 })));
    render(<OrderWizard />);
    fireEvent.click(await screen.findByRole('button', { name: /print pdf/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await waitFor(() => expect(screen.getByText('Shop is unavailable')).toBeTruthy());
    expect(screen.getByText('What do you need?')).toBeTruthy();
    expect(screen.queryByText('Add your files')).toBeNull();
  });
});
