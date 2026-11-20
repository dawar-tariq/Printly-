// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';

const id = '11111111-1111-4111-8111-111111111111';
vi.mock('next/navigation', () => ({ useParams: () => ({ id: '11111111-1111-4111-8111-111111111111' }) }));
vi.mock('next/link', () => ({ default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a href={href} {...props}>{children}</a> }));
import TrackPage from './page';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const track = (payment_status: string) => ({
  order_id: id, token: null, status: 'draft', payment_status, payment_method: 'upi',
  shop_name: 'Demo', shop_slug: 'demo', shop_city: 'Srinagar', total_paise: 472, eta_minutes: 20,
  item_count: 1, rush: false, created_at: '2026-11-19T12:00:00Z', ready_at: null, collected_at: null,
});

describe('UPI tracking recovery', () => {
  it('lets the original browser report a paid transfer without calling it confirmed', async () => {
    let status = 'pending';
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/track')) return Response.json({ track: track(status) });
      if (url.endsWith('/payment-submitted')) { status = 'submitted'; return Response.json({ ok: true }); }
      throw new Error('Unexpected request');
    });
    vi.stubGlobal('fetch', fetcher);
    render(<TrackPage />);
    expect(await screen.findByText('Payment not reported yet')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('UPI reference / UTR (optional)'), { target: { value: ' REF-123 ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Report payment to shop' }));
    await waitFor(() => expect(screen.getByText('Waiting for payment confirmation')).toBeTruthy());
    const submit = fetcher.mock.calls.find(([url]) => url.endsWith('/payment-submitted'));
    expect(JSON.parse(String(submit?.[1]?.body))).toEqual({ utr: 'REF-123' });
    expect(screen.getByText(/shop still needs to verify/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Report payment to shop' })).toBeNull();
  });

  it('explains session expiry and gives a shop-details link without marking payment reported', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => url.endsWith('/track')
      ? Response.json({ track: track('rejected') })
      : Response.json({ error: { message: 'Your order session expired. Please contact the shop about this payment.' } }, { status: 403 })));
    render(<TrackPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Report payment to shop' }));
    await screen.findByText(/your order session expired/i);
    expect(screen.getByText(/do not pay twice/i)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'View shop details' }).getAttribute('href')).toBe('/s/demo');
  });
});
