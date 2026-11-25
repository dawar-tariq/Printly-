// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

const router = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));
vi.mock('next/link', () => ({ default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a href={href} {...props}>{children}</a> }));
vi.mock('qrcode', () => ({ default: { toDataURL: async () => 'data:image/png;base64,qr' } }));
import ShopSubscriptionPage from './page';

const id = '11111111-1111-4111-8111-111111111111';
const purchaseId = '22222222-2222-4222-8222-222222222222';
const promoId = '33333333-3333-4333-8333-333333333333';
let data: any; // Test fixture mutates like the server.
let posts: Array<Record<string, any>>;
let dropFirstStart: boolean;
let changeQuoteOnStart: boolean;
let failGet: boolean;
beforeEach(() => {
  window.localStorage.clear(); router.refresh.mockClear();
  data = { shop: { id, name: 'Demo', short_code: 'DEMO1234' }, is_owner: true,
    subscription: { shop_id: id, term: 'grace', started_at: '2020-01-01T00:00:00Z', expires_at: '2020-01-31T00:00:00Z', is_permanent: false },
    plan: { monthly_paise: 12500, six_months_paise: 60000, yearly_paise: 100000, upi_id: 'printly@upi', payee_name: 'Printly', warning_days: 7 }, purchases: [], announcements: [] };
  posts = []; dropFirstStart = false; changeQuoteOnStart = false; failGet = false;
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === 'POST') {
      const body = JSON.parse(String(init.body)); posts.push(body);
      if (body.action === 'quote') {
        if (body.code && !['SAVE10', 'FREE'].includes(body.code)) return Response.json({ error: { code: 'promo_unavailable', message: 'This promo code is unavailable.' } }, { status: 409 });
        const base = body.term === 'monthly' ? data.plan.monthly_paise : body.term === 'six_months' ? data.plan.six_months_paise : data.plan.yearly_paise;
        const months = body.term === 'monthly' ? 1 : body.term === 'six_months' ? 6 : 12;
        const discount = body.code === 'FREE' ? base : body.code === 'SAVE10' ? Math.floor(base / 10) : 0;
        return Response.json({ ok: true, result: { term: body.term, base_paise: base, monthly_reference_paise: data.plan.monthly_paise === null ? null : data.plan.monthly_paise * months,
          discount_paise: discount, amount_paise: base - discount, promo_code: body.code, promo_id: body.code ? promoId : null, promo_version: body.code ? 0 : null, plan_version: 2, access_expires_at: data.subscription?.expires_at ?? null } });
      }
      if (body.action === 'start') {
        if (changeQuoteOnStart) return Response.json({ error: { code: 'quote_changed', message: 'The price or offer changed. Refresh the quote.' } }, { status: 409 });
        const existing = data.purchases.find((p: any) => p.request_key === body.request_key);
        if (existing) return Response.json({ ok: true, result: { purchase: existing, existing: true, different_selection: existing.term !== body.term || existing.promo_code !== body.code } });
        const q = body.expected_quote;
        const purchase = { id: purchaseId, shop_id: id, term: body.term, amount_paise: q.amount_paise, upi_id: q.amount_paise ? 'printly@upi' : null,
          payee_name: q.amount_paise ? 'Printly' : null, status: q.amount_paise ? 'initiated' : 'approved', utr: null, created_at: '2026-01-01T00:00:00Z',
          base_amount_paise: q.base_paise, monthly_reference_paise: q.monthly_reference_paise, discount_paise: q.discount_paise, promo_code: q.promo_code, request_key: body.request_key,
          period_start: q.amount_paise ? null : '2031-01-01T00:00:00Z', period_end: q.amount_paise ? null : '2032-01-01T00:00:00Z' };
        data.purchases = [purchase];
        if (!q.amount_paise) data.subscription = { ...data.subscription, term: body.term, expires_at: '2032-01-01T00:00:00Z' };
        if (dropFirstStart) { dropFirstStart = false; throw new Error('Connection interrupted. Refresh before retrying.'); }
        return Response.json({ ok: true, result: { purchase, existing: false } });
      }
      if (body.action === 'submit') Object.assign(data.purchases[0], { status: 'submitted', utr: body.utr });
      if (body.action === 'cancel') Object.assign(data.purchases[0], { status: 'cancelled' });
      return Response.json({ ok: true, result: data.purchases[0] });
    }
    return failGet ? Response.json({ error: { message: 'Could not load subscription details.' } }, { status: 503 }) : Response.json(data);
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); window.localStorage.clear(); });

describe('shop subscription payment experience', () => {
  it('allows a synthetic report but never offers a payment QR or UPI link on the isolated site', async () => {
    vi.stubEnv('NEXT_PUBLIC_PRINTLY_ISOLATED_TEST', '1');
    render(<ShopSubscriptionPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Choose monthly' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Continue to simulated payment' }));
    expect(await screen.findByText('Simulate a payment')).toBeTruthy();
    expect(screen.getByText(/SIMULATED PAYMENT ONLY/)).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Open UPI app' })).toBeNull();
    expect(screen.queryByAltText('UPI payment QR code')).toBeNull();
    expect(screen.queryByText(/Printly · printly@upi/)).toBeNull();
    fireEvent.change(screen.getByLabelText('Synthetic test reference'), { target: { value: 'TEST123456' } });
    fireEvent.click(screen.getByRole('button', { name: 'Submit payment reference' }));
    expect(await screen.findByText('Payment report submitted')).toBeTruthy();
    expect(posts.at(-1)).toMatchObject({ action: 'submit', utr: 'TEST123456' });
  });
  it('keeps expired access locked while the owner reviews, pays, and reports a reference', async () => {
    render(<ShopSubscriptionPage />);
    expect(await screen.findByText('Expired')).toBeTruthy();
    expect(screen.getByText(/Dashboard and new customer orders are paused/)).toBeTruthy();
    expect(screen.getByRole('link', { name: /handle open orders/i }).getAttribute('href')).toBe('/shop/recovery');
    fireEvent.click(screen.getByRole('button', { name: 'Choose monthly' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Continue to UPI payment' }));
    expect(await screen.findByText('Complete your UPI payment')).toBeTruthy();
    expect(screen.getByText(/Printly · printly@upi/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Open UPI app' }).getAttribute('href')).toContain('pa=printly%40upi');
    fireEvent.change(screen.getByLabelText('UPI transaction reference / UTR'), { target: { value: '123456789012' } });
    fireEvent.click(screen.getByRole('button', { name: 'Submit payment reference' }));
    expect(await screen.findByText('Payment report submitted')).toBeTruthy();
    expect(screen.getByText('Awaiting independent verification')).toBeTruthy();
    expect(screen.getByText('Expired')).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Open dashboard' })).toBeNull();
    expect(posts.map((p) => p.action)).toEqual(['quote', 'start', 'submit']);
    expect(posts[1]).toMatchObject({ term: 'monthly', code: null, expected_quote: { amount_paise: 12500 } });
    expect(posts[1].request_key).toMatch(/^[0-9a-f-]{36}$/);
  });
  it('separates term savings, promo savings and total savings before payment', async () => {
    render(<ShopSubscriptionPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Choose yearly' }));
    await screen.findByRole('button', { name: 'Continue to UPI payment' });
    fireEvent.change(screen.getByLabelText('Promo code'), { target: { value: 'save10' } });
    expect(screen.queryByRole('button', { name: 'Continue to UPI payment' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Apply code' }));
    await screen.findByText('SAVE10 applied to this term');
    const breakdown = screen.getByText('Your price breakdown').parentElement!;
    expect(within(breakdown).getByText('Term savings vs monthly').parentElement?.textContent).toContain('₹500');
    expect(within(breakdown).getByText('Promo savings').parentElement?.textContent).toContain('₹100');
    expect(within(breakdown).getByText('Total savings vs monthly').parentElement?.textContent).toContain('₹600');
    expect(within(breakdown).getByText('You pay').parentElement?.textContent).toContain('₹900');
    expect(posts[1]).toMatchObject({ action: 'quote', term: 'yearly', code: 'SAVE10' });
  });
  it('allows a fully discounted term to activate immediately even if UPI is not configured', async () => {
    data.plan.upi_id = null;
    render(<ShopSubscriptionPage />);
    await screen.findByText(/payments are not configured yet/i);
    fireEvent.click(screen.getByRole('button', { name: 'Choose monthly' }));
    const paid = await screen.findByRole('button', { name: 'Continue to UPI payment' }) as HTMLButtonElement;
    expect(paid.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Promo code'), { target: { value: 'FREE' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply code' }));
    expect((await screen.findByRole('button', { name: 'Activate for free' }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Activate for free' }));
    expect(await screen.findByText(/Monthly access activated for free/)).toBeTruthy();
    expect(screen.getByText(/Activated with promo/)).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Open UPI app' })).toBeNull();
    expect(posts.at(-1)).toMatchObject({ action: 'start', code: 'FREE', expected_quote: { amount_paise: 0 } });
  });
  it('recovers a lost free-activation response without a second activation, even after refresh', async () => {
    dropFirstStart = true;
    render(<ShopSubscriptionPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Choose monthly' }));
    await screen.findByLabelText('Promo code');
    fireEvent.change(screen.getByLabelText('Promo code'), { target: { value: 'FREE' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply code' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Activate for free' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/Connection interrupted/i);
    expect(data.purchases).toHaveLength(1);
    expect(window.localStorage.length).toBe(1);
    fireEvent.click(screen.getByRole('button', { name: 'Refresh status' }));
    expect(await screen.findByText(/Recovered your earlier request/)).toBeTruthy();
    expect(data.purchases).toHaveLength(1);
    expect(posts.filter((p) => p.action === 'start')).toHaveLength(1);
    expect(window.localStorage.length).toBe(0);
  });
  it('reuses the same key when retrying an uncertain activation', async () => {
    dropFirstStart = true;
    render(<ShopSubscriptionPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Choose monthly' }));
    await screen.findByLabelText('Promo code');
    fireEvent.change(screen.getByLabelText('Promo code'), { target: { value: 'FREE' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply code' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Activate for free' }));
    await screen.findByRole('alert');
    fireEvent.click(screen.getByRole('button', { name: 'Activate for free' }));
    await screen.findByText(/Monthly access activated for free/);
    const attempts = posts.filter((p) => p.action === 'start');
    expect(attempts).toHaveLength(2);
    expect(attempts[0].request_key).toBe(attempts[1].request_key);
    expect(data.purchases).toHaveLength(1);
  });
  it('recovers the earlier choice rather than granting a second term if selection changes after a lost response', async () => {
    dropFirstStart = true;
    render(<ShopSubscriptionPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Choose monthly' }));
    await screen.findByRole('button', { name: 'Continue to UPI payment' });
    fireEvent.change(screen.getByLabelText('Promo code'), { target: { value: 'FREE' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply code' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Activate for free' }));
    await screen.findByRole('alert');
    fireEvent.click(screen.getByRole('button', { name: 'Choose yearly' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Activate for free' }));
    expect(await screen.findByText(/An earlier request was recovered for Monthly/)).toBeTruthy();
    const attempts = posts.filter((p) => p.action === 'start');
    expect(attempts.map((p) => p.term)).toEqual(['monthly', 'yearly']);
    expect(attempts[0].request_key).toBe(attempts[1].request_key);
    expect(data.purchases).toHaveLength(1);
  });
  it('will not start an activation if essential persistent browser storage is blocked', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('storage blocked'); });
    render(<ShopSubscriptionPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Choose monthly' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Continue to UPI payment' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/Enable essential browser storage/);
    expect(posts.filter((p) => p.action === 'start')).toHaveLength(0);
  });
  it('shows live announcements and honestly labels a term that costs more than monthly', async () => {
    data.plan.yearly_paise = 200000;
    data.announcements = [{ id: '44444444-4444-4444-8444-444444444444', title: 'Shop update', message: 'A special thank you.', ends_at: null,
      promo: { code: 'SAVE10', discount_type: 'percent', discount_value: 10, terms: ['yearly'], ends_at: null } }];
    render(<ShopSubscriptionPage />);
    expect(await screen.findByText('Shop update')).toBeTruthy();
    expect(screen.getByText('SAVE10')).toBeTruthy();
    expect(screen.getByText(/₹500 more compared with 12 monthly terms/)).toBeTruthy();
    expect(screen.queryByText(/Save ₹500 compared with 12 monthly terms/)).toBeNull();
  });
  it('requires a fresh review when the server reports a changed quote', async () => {
    changeQuoteOnStart = true;
    render(<ShopSubscriptionPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Choose monthly' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Continue to UPI payment' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/price or offer changed/i);
    expect(screen.queryByRole('button', { name: 'Continue to UPI payment' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Refresh quote' })).toBeTruthy();
    expect(data.purchases).toHaveLength(0);
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
  it('disables an unconfigured term rather than inventing a price', async () => {
    data.plan.yearly_paise = null;
    render(<ShopSubscriptionPage />);
    await waitFor(() => expect((screen.getByRole('button', { name: 'Choose yearly' }) as HTMLButtonElement).disabled).toBe(true));
  });
});
