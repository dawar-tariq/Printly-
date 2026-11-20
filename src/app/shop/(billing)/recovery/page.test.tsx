// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const router = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router, useParams: () => ({ id: '11111111-1111-4111-8111-111111111111' }) }));
vi.mock('next/link', () => ({ default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a href={href} {...props}>{children}</a> }));
import RecoveryPage from './page';
import { ShopOrderDetail } from '@/components/ShopOrderDetail';
const id = '11111111-1111-4111-8111-111111111111';
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); router.push.mockClear(); });

describe('limited order recovery', () => {
  it('lists open orders and lets staff find an older order by tracking link', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ orders: [{ id, token: null, status: 'draft', payment_status: 'submitted', payment_method: 'upi', customer_name: 'Customer', total_paise: 472, utr: 'REF-123', created_at: '2026-01-01T00:00:00Z' }], pagination: { page: 1, pages: 1, count: 1 } })));
    render(<RecoveryPage />);
    const link = await screen.findByRole('link', { name: /Customer/ });
    expect(link.getAttribute('href')).toBe(`/shop/recovery/${id}`);
    fireEvent.change(screen.getByLabelText('Tracking link or order ID'), { target: { value: `https://printly.test/track/${id}` } });
    fireEvent.click(screen.getByRole('button', { name: 'Find order' }));
    expect(router.push).toHaveBeenCalledWith(`/shop/recovery/${id}`);
    expect(screen.getByRole('link', { name: 'Review subscription' }).getAttribute('href')).toBe('/shop/subscription');
  });
  it('requires independent verification before confirming a customer UPI report', async () => {
    let status = 'submitted';
    const posts: Array<Record<string, unknown>> = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'POST') { posts.push(JSON.parse(String(init.body))); status = 'confirmed'; return Response.json({ ok: true }); }
      return Response.json({ order: { id, token: null, status: status === 'confirmed' ? 'queued' : 'draft', payment_status: status, payment_method: 'upi', customer_name: 'A', customer_phone: '9797000000', customer_email: '', notes: '', subtotal_paise: 400, tax_paise: 72, total_paise: 472, rush: false, eta_minutes: 20, utr: 'REF-123', created_at: '2026-01-01T00:00:00Z', shops: { id: 'shop', name: 'Demo', slug: 'demo' } }, items: [], files: [], events: [], payment: null });
    }));
    const confirmation = vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<ShopOrderDetail backHref="/shop/recovery" />);
    const button = await screen.findByRole('button', { name: 'Payment received' });
    expect(screen.getByText(/independently check your receiving account/i)).toBeTruthy();
    fireEvent.click(button); expect(posts).toHaveLength(0);
    confirmation.mockReturnValue(true); fireEvent.click(button);
    await waitFor(() => expect(posts).toEqual([{ action: 'confirm' }]));
    expect(screen.getByRole('link', { name: 'Back to orders' }).getAttribute('href')).toBe('/shop/recovery');
    await screen.findByText('Payment confirmed and order queued.');
  });
});
