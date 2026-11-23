// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { computeQuote, type ItemSpec, type RateRow } from '@/lib/pricing';

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
});
