// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { computeQuote, type ItemSpec, type RateRow } from '@/lib/pricing';
import { CUSTOMER_CONTACT_KEY } from '@/lib/remembered-customer-contact';

vi.mock('next/navigation', () => ({ useParams: () => ({ slug: 'p-demo1' }), useRouter: () => ({ push: vi.fn() }) }));
vi.mock('next/link', () => ({ default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a href={href} {...props}>{children}</a> }));
vi.mock('@/lib/supabase-client', () => ({ createBrowserSupabase: () => ({ storage: { from: () => ({ uploadToSignedUrl: async () => ({ error: null }) }) } }) }));
vi.mock('@/lib/resumable-upload', () => ({ createResumableTransfer: ({ onProgress }: { onProgress: (sent: number, total: number) => void }) => ({ start: async () => { onProgress(100, 100); }, abort: async () => {} }) }));
import OrderWizard from './page';

const order = '11111111-1111-4111-8111-111111111111';
const first = '33333333-3333-4333-8333-333333333333';
const second = '44444444-4444-4444-8444-444444444444';
let selectedItems: ItemSpec[];
let rate: RateRow;

beforeEach(() => {
  window.sessionStorage.clear();
  window.localStorage.clear();
  selectedItems = [];
  rate = { service: 'print', paper_size: 'A4', color: 'bw', sides: 'duplex', paper_gsm: 80, option: null, unit: 'duplex_sheet', price_paise: 300 };
  vi.stubGlobal('fetch', vi.fn(async (input: string, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith('/api/shops/')) return Response.json({ shop: { name: 'Demo Prints', status: 'active' }, accepting_orders: true, services: [{ service: 'print', enabled: true }] });
    if (url === '/api/orders') return Response.json({ order_id: order });
    if (url === `/api/orders/${order}/files` && init?.method === 'POST') {
      const body = JSON.parse(String(init.body));
      const id = body.name === 'five.pdf' ? first : second;
      return Response.json({ file_id: id, path: `${id}.pdf`, token: 'signed-upload' });
    }
    if (url.endsWith('/finalize')) {
      const id = url.includes(first) ? first : second;
      return Response.json({ file_id: id, page_count: id === first ? 5 : 1 });
    }
    if (url === `/api/orders/${order}/items` && init?.method === 'PUT') {
      selectedItems = JSON.parse(String(init.body)).items;
      return Response.json({ ok: true });
    }
    if (url.startsWith(`/api/orders/${order}/quote`)) {
      return Response.json({ quote: computeQuote(selectedItems, [rate], { gstBps: 1800 }), rush: false, quote_token: 'a'.repeat(64) });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

async function goToDuplex() {
  const view = render(<OrderWizard />);
  fireEvent.click(await screen.findByRole('button', { name: /print pdf/i }));
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
  await screen.findByText('Add your files');
  const input = view.container.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [
    new File(['one'], 'five.pdf', { type: 'application/pdf' }),
    new File(['two'], 'one.pdf', { type: 'application/pdf' }),
  ] } });
  await screen.findByText(/5 pages · uploaded/);
  await screen.findByText(/1 page · uploaded/);
  fireEvent.click(screen.getByRole('button', { name: /Continue · 6 pages/i }));
  await screen.findByRole('heading', { name: 'Options' });
  fireEvent.click(screen.getByRole('button', { name: 'Double (duplex)' }));
  fireEvent.click(screen.getByRole('button', { name: '+' }));
  expect(screen.getByText(/8 physical sheets needed for 2 copies of each file/i)).toBeTruthy();
  expect(screen.getByText(/pages 1 and 2 share a sheet/i)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Continue to payment' }));
  await screen.findByText('Order summary');
}

describe('customer duplex checkout', () => {
  it('shows files, odd-page sheet quantities and the actual per-sheet price before payment', async () => {
    await goToDuplex();
    expect(selectedItems).toMatchObject([
      { file_id: first, sides: 'duplex', pages: 5, copies: 2 },
      { file_id: second, sides: 'duplex', pages: 1, copies: 2 },
    ]);
    expect(screen.getByText('five.pdf')).toBeTruthy();
    expect(screen.getByText('one.pdf')).toBeTruthy();
    expect(screen.getByText('6 × ₹3 per physical duplex sheet')).toBeTruthy();
    expect(screen.getByText('2 × ₹3 per physical duplex sheet')).toBeTruthy();
    expect(screen.getByText('₹28.32')).toBeTruthy();
  });

  it('shows per-page billing when that is the shop’s duplex rate', async () => {
    rate = { ...rate, unit: 'page', price_paise: 150 };
    await goToDuplex();
    await waitFor(() => expect(screen.getByText('10 × ₹1.50 per printed page')).toBeTruthy());
    expect(screen.getByText('2 × ₹1.50 per printed page')).toBeTruthy();
    expect(screen.getByText('₹21.24')).toBeTruthy();
  });

  it('allows only an identical ambiguous checkout retry after the shop closes', async () => {
    const mock = vi.mocked(fetch);
    const original = mock.getMockImplementation()!;
    const attempts: unknown[] = [];
    let closed = false;
    mock.mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.startsWith('/api/shops/') && closed) return Response.json({ shop: { name: 'Demo Prints', status: 'active', is_open: false }, accepting_orders: false, services: [{ service: 'print', enabled: true }] });
      if (url === `/api/orders/${order}/pay`) {
        attempts.push(JSON.parse(String(init?.body)));
        if (attempts.length === 1) throw new Error('response lost');
        // The first request could still commit even if this later retry races
        // the shop closure and is rejected before that commit becomes visible.
        if (attempts.length === 2) return Response.json({ error: { code: 'shop_closed', message: 'This shop is closed.' } }, { status: 403 });
        return Response.json({ mode: 'placed', total_paise: 2832 });
      }
      return original(input, init);
    });
    await goToDuplex();
    fireEvent.change(screen.getByLabelText(/Your name/), { target: { value: 'Customer' } });
    fireEvent.change(screen.getByLabelText(/^Phone/), { target: { value: '9797000000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Proceed to pay' }));
    await screen.findByText(/Could not complete checkout/);
    expect((screen.getByLabelText(/Your name/).closest('fieldset') as HTMLFieldSetElement).disabled).toBe(true);
    closed = true;
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    fireEvent(document, new Event('visibilitychange'));
    await screen.findByText(/This shop is closed/);
    const retry = screen.getByRole('button', { name: 'Retry checkout safely' }) as HTMLButtonElement;
    expect(retry.disabled).toBe(false);
    fireEvent.click(retry);
    await waitFor(() => expect(attempts).toHaveLength(2));
    await waitFor(() => expect((screen.getByRole('button', { name: 'Retry checkout safely' }) as HTMLButtonElement).disabled).toBe(false));
    expect((screen.getByLabelText(/Your name/).closest('fieldset') as HTMLFieldSetElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Retry checkout safely' }));
    await waitFor(() => expect(attempts).toHaveLength(3));
    expect(attempts[1]).toEqual(attempts[0]);
    expect(attempts[2]).toEqual(attempts[0]);
  });

  it('recovers an interrupted checkout after reload, without saving contact details or starting another payment', async () => {
    const mock = vi.mocked(fetch);
    const original = mock.getMockImplementation()!;
    const checks: unknown[] = [];
    let closed = false;
    let paymentAttempts = 0;
    mock.mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.startsWith('/api/shops/') && closed) return Response.json({ shop: { name: 'Demo Prints', status: 'active', is_open: false }, accepting_orders: false, services: [{ service: 'print', enabled: true }] });
      if (url === `/api/orders/${order}/pay`) { paymentAttempts++; throw new Error('response lost'); }
      if (url === `/api/orders/${order}/pay/recover`) {
        checks.push(JSON.parse(String(init?.body)));
        if (checks.length === 1) return Response.json({ error: { code: 'checkout_unconfirmed', message: 'Checkout is not confirmed yet. Wait and check again.' } }, { status: 409 });
        return Response.json({ mode: 'upi', link: 'upi://pay?pa=original%40upi', pa: 'original@upi', pn: 'Demo Prints', am: '28.32', tn: 'Printly', shop_name: 'Demo Prints', total_paise: 2832 });
      }
      return original(input, init);
    });
    await goToDuplex();
    fireEvent.change(screen.getByLabelText(/Your name/), { target: { value: 'Private Customer' } });
    fireEvent.change(screen.getByLabelText(/^Phone/), { target: { value: '9797000000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Proceed to pay' }));
    await screen.findByText(/Could not complete checkout/);
    const saved = window.sessionStorage.getItem('printly-checkout-v1:p-demo1')!;
    expect(saved).not.toContain('Private Customer'); expect(saved).not.toContain('9797000000');
    expect(JSON.parse(saved)).toEqual({ order_id: order, method: 'upi', quote_token: 'a'.repeat(64) });

    closed = true;
    cleanup();
    render(<OrderWizard />);
    await screen.findByRole('heading', { name: 'Check your previous checkout' });
    expect(screen.getByRole('link', { name: 'View tracking link' }).getAttribute('href')).toBe(`/track/${order}`);
    fireEvent.click(screen.getByRole('button', { name: 'Check previous checkout' }));
    await screen.findByText(/Checkout is not confirmed yet/);
    expect(window.sessionStorage.getItem('printly-checkout-v1:p-demo1')).toBe(saved);
    fireEvent.click(screen.getByRole('button', { name: 'Check previous checkout' }));
    await screen.findByText(/This checkout was already started/);
    expect(screen.getByRole('link', { name: /Open UPI app/i }).getAttribute('href')).toBe('upi://pay?pa=original%40upi');
    expect(paymentAttempts).toBe(1);
    expect(checks).toEqual([{ method: 'upi', quote_token: 'a'.repeat(64) }, { method: 'upi', quote_token: 'a'.repeat(64) }]);
    expect(window.localStorage.getItem(CUSTOMER_CONTACT_KEY)).toBeNull();
  });

  it('offers opt-in saved details, restores them on a repeat visit and allows removal before ordering', async () => {
    await goToDuplex();
    const remember = screen.getByRole('checkbox', { name: 'Remember my details on this browser' }) as HTMLInputElement;
    expect(remember.checked).toBe(false);
    fireEvent.change(screen.getByLabelText(/Your name/), { target: { value: 'Aisha Khan' } });
    fireEvent.change(screen.getByLabelText(/^Phone/), { target: { value: '9797000000' } });
    fireEvent.change(screen.getByLabelText(/Email \(optional\)/), { target: { value: 'aisha@example.com' } });
    fireEvent.change(screen.getByLabelText(/Notes for the shop/), { target: { value: 'do not save this' } });
    expect(window.localStorage.getItem(CUSTOMER_CONTACT_KEY)).toBeNull();
    fireEvent.click(remember);
    await screen.findByText('Saved on this browser.');
    expect(window.localStorage.getItem(CUSTOMER_CONTACT_KEY)).not.toContain('do not save this');

    cleanup();
    await goToDuplex();
    expect((screen.getByLabelText(/Your name/) as HTMLInputElement).value).toBe('Aisha Khan');
    expect((screen.getByLabelText(/^Phone/) as HTMLInputElement).value).toBe('9797000000');
    expect((screen.getByLabelText(/Email \(optional\)/) as HTMLInputElement).value).toBe('aisha@example.com');
    expect((screen.getByLabelText(/Notes for the shop/) as HTMLInputElement).value).toBe('');
    fireEvent.change(screen.getByLabelText(/^Phone/), { target: { value: '9876500000' } });
    await waitFor(() => expect(JSON.parse(window.localStorage.getItem(CUSTOMER_CONTACT_KEY)!).phone).toBe('9876500000'));

    cleanup();
    render(<OrderWizard />);
    await screen.findByText(/Contact details are saved on this browser/);
    fireEvent.click(screen.getByRole('button', { name: 'Clear saved details' }));
    expect(window.localStorage.getItem(CUSTOMER_CONTACT_KEY)).toBeNull();
    expect(screen.getByText(/Saved details removed/)).toBeTruthy();
  });

  it('flushes opt-in before checkout, and clearing it cannot alter a safe payment retry', async () => {
    const mock = vi.mocked(fetch);
    const original = mock.getMockImplementation()!;
    const attempts: unknown[] = [];
    mock.mockImplementation(async (input, init) => {
      if (String(input) === `/api/orders/${order}/pay`) {
        attempts.push(JSON.parse(String(init?.body)));
        throw new Error('response lost');
      }
      return original(input, init);
    });
    await goToDuplex();
    fireEvent.change(screen.getByLabelText(/Your name/), { target: { value: 'Aisha' } });
    fireEvent.change(screen.getByLabelText(/^Phone/), { target: { value: '9797000000' } });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Remember my details on this browser' }));
    fireEvent.click(screen.getByRole('button', { name: 'Proceed to pay' }));
    await screen.findByText(/Could not complete checkout/);
    expect(JSON.parse(window.localStorage.getItem(CUSTOMER_CONTACT_KEY)!).name).toBe('Aisha');
    const recovery = window.sessionStorage.getItem('printly-checkout-v1:p-demo1');
    fireEvent.click(screen.getByRole('button', { name: 'Clear saved details' }));
    expect(window.localStorage.getItem(CUSTOMER_CONTACT_KEY)).toBeNull();
    expect(window.sessionStorage.getItem('printly-checkout-v1:p-demo1')).toBe(recovery);
    fireEvent.click(screen.getByRole('button', { name: 'Retry checkout safely' }));
    await waitFor(() => expect(attempts).toHaveLength(2));
    expect(attempts[1]).toEqual(attempts[0]);
  });
});
