// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';

const id = '11111111-1111-4111-8111-111111111111';
const mocks = vi.hoisted(() => ({ router: { push: vi.fn() } }));
vi.mock('next/navigation', () => ({ useParams: () => ({ id: '11111111-1111-4111-8111-111111111111' }), useRouter: () => mocks.router }));
vi.mock('next/link', () => ({ default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a href={href} {...props}>{children}</a> }));
import OrderDetailPage from './page';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('recording an absent customer’s payment report', () => {
  it('asks for acknowledgement and records only a claim, not payment confirmation', async () => {
    let status = 'pending';
    const fetcher = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'POST') { status = 'submitted'; return Response.json({ ok: true, outcome: 'submitted' }); }
      return Response.json({
        order: { id, token: null, status: 'draft', payment_status: status, payment_method: 'upi', customer_name: 'A', customer_phone: '9797000000', customer_email: '', notes: '', subtotal_paise: 400, tax_paise: 72, total_paise: 472, rush: false, eta_minutes: 20, utr: null, created_at: '2026-11-19T12:00:00Z', shops: { id: 'shop', name: 'Demo', slug: 'demo' } },
        items: [], files: [], events: [], payment: null,
      });
    });
    vi.stubGlobal('fetch', fetcher);
    const acknowledge = vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<OrderDetailPage />);
    const report = await screen.findByRole('button', { name: 'Record customer’s payment report' });
    fireEvent.click(report);
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(0);
    acknowledge.mockReturnValue(true);
    fireEvent.change(screen.getByLabelText('Customer’s UTR / reference (optional)'), { target: { value: ' REF-123 ' } });
    fireEvent.click(report);
    await screen.findByText(/customer report recorded/i);
    await waitFor(() => expect(screen.getByText('submitted')).toBeTruthy());
    const post = fetcher.mock.calls.find(([, init]) => init?.method === 'POST');
    expect(JSON.parse(String(post?.[1]?.body))).toEqual({ action: 'report', utr: 'REF-123' });
    expect(screen.queryByRole('button', { name: 'Record customer’s payment report' })).toBeNull();
    expect(screen.getByText(/verify the transfer before confirming payment/i)).toBeTruthy();
  });
});
