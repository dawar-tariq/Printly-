// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const router = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));
vi.mock('next/link', () => ({ default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a href={href} {...props}>{children}</a> }));
vi.mock('qrcode', () => ({ default: { toDataURL: async () => 'data:image/png;base64,qr' } }));
import ShopSubscriptionPage from './page';

const id = '11111111-1111-4111-8111-111111111111';
const purchaseId = '22222222-2222-4222-8222-222222222222';
let data: any; // Test fixture mutates like the server.
let posts: Array<Record<string, unknown>>;
beforeEach(() => {
  data = { shop: { id, name: 'Demo', short_code: 'DEMO1234' }, is_owner: true,
    subscription: { shop_id: id, term: 'grace', started_at: '2020-01-01T00:00:00Z', expires_at: '2020-01-31T00:00:00Z', is_permanent: false },
    plan: { monthly_paise: 12500, six_months_paise: 60000, yearly_paise: 100000, upi_id: 'printly@upi', payee_name: 'Printly', warning_days: 7 }, purchases: [] };
  posts = [];
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === 'POST') {
      const body = JSON.parse(String(init.body)); posts.push(body);
      if (body.action === 'start') data.purchases = [{ id: purchaseId, shop_id: id, term: body.term, amount_paise: 12500, upi_id: 'printly@upi', payee_name: 'Printly', status: 'initiated', utr: null, created_at: '2026-01-01T00:00:00Z' }];
      if (body.action === 'submit') Object.assign(data.purchases[0], { status: 'submitted', utr: body.utr });
      return Response.json({ ok: true });
    }
    return Response.json(data);
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('shop subscription payment experience', () => {
  it('keeps expired access locked while the owner starts a payment and reports a reference', async () => {
    render(<ShopSubscriptionPage />);
    expect(await screen.findByText('Expired')).toBeTruthy();
    expect(screen.getByText(/Dashboard and new customer orders are paused/)).toBeTruthy();
    expect(screen.getByRole('link', { name: /handle open orders/i }).getAttribute('href')).toBe('/shop/recovery');
    fireEvent.click(screen.getByRole('button', { name: 'Choose monthly' }));
    expect(await screen.findByText('Complete your UPI payment')).toBeTruthy();
    expect(screen.getByText(/Printly · printly@upi/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Open UPI app' }).getAttribute('href')).toContain('pa=printly%40upi');
    fireEvent.change(screen.getByLabelText('UPI transaction reference / UTR'), { target: { value: '123456789012' } });
    fireEvent.click(screen.getByRole('button', { name: 'Submit payment reference' }));
    expect(await screen.findByText('Payment report submitted')).toBeTruthy();
    expect(screen.getByText('Awaiting independent verification')).toBeTruthy();
    expect(screen.getByText('Expired')).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Open dashboard' })).toBeNull();
    expect(posts).toEqual([{ action: 'start', term: 'monthly' }, { action: 'submit', purchase_id: purchaseId, utr: '123456789012' }]);
  });
  it('shows staff the status but does not let them purchase', async () => {
    data.is_owner = false;
    render(<ShopSubscriptionPage />);
    expect(await screen.findByText(/Only the shop owner/)).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Choose yearly' }) as HTMLButtonElement).disabled).toBe(true);
    expect(posts).toEqual([]);
  });
  it('never invites a new payment for a request if permanent access was granted in the meantime', async () => {
    data.subscription = { ...data.subscription, is_permanent: true };
    data.purchases = [{ id: purchaseId, shop_id: id, term: 'monthly', amount_paise: 12500, upi_id: 'printly@upi', payee_name: 'Printly', status: 'initiated', utr: null, created_at: '2026-01-01T00:00:00Z' }];
    render(<ShopSubscriptionPage />);
    await screen.findByText(/Permanent access is now enabled/);
    expect(screen.queryByRole('link', { name: 'Open UPI app' })).toBeNull();
    expect(screen.getByText(/If you already paid before permanent access/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Cancel unpaid request' })).toBeTruthy();
  });
  it('refreshes an open payment page and removes the QR if permanent access is granted', async () => {
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    data.purchases = [{ id: purchaseId, shop_id: id, term: 'monthly', amount_paise: 12500, upi_id: 'printly@upi', payee_name: 'Printly', status: 'initiated', utr: null, created_at: '2026-01-01T00:00:00Z' }];
    render(<ShopSubscriptionPage />);
    expect(await screen.findByRole('link', { name: 'Open UPI app' })).toBeTruthy();
    data.subscription = { ...data.subscription, is_permanent: true };
    fireEvent(document, new Event('visibilitychange'));
    expect(await screen.findByText(/Permanent access is now enabled/)).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Open UPI app' })).toBeNull();
  });
  it('does not offer an unconfigured plan', async () => {
    data.plan.upi_id = null;
    render(<ShopSubscriptionPage />);
    await screen.findByText(/payments are not configured yet/i);
    await waitFor(() => expect((screen.getByRole('button', { name: 'Choose monthly' }) as HTMLButtonElement).disabled).toBe(true));
  });
});
