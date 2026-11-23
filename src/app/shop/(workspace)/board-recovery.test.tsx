// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';

const mocks = vi.hoisted(() => ({ push: vi.fn(), on: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock('next/link', () => ({ default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a href={href} {...props}>{children}</a> }));
vi.mock('@/lib/supabase-client', () => ({ createBrowserSupabase: () => {
  const channel = { on: (...args: unknown[]) => { mocks.on(...args); return channel; }, subscribe: () => channel };
  return { channel: () => channel, removeChannel: () => {} };
} }));
import ShopBoardPage from './page';

const id = '11111111-1111-4111-8111-111111111111';
const payment = { id, token: null, status: 'draft', payment_status: 'pending', payment_method: 'upi',
  customer_name: 'A', customer_phone: '9797000000', total_paise: 472, rush: false, eta_minutes: 20, utr: null,
  created_at: '2026-11-19T12:00:00Z', items: [{ count: 1 }] };
const empty = (page = 1, count = 0) => ({ orders: [], pagination: { page, pages: Math.max(1, Math.ceil(count / 30)), count } });
function board(confirm = [payment], queuedCount = 0, page = 1) {
  return { shop_id: 'shop-1', completed_today: 135, attention: [], lanes: {
    confirm: { orders: confirm, pagination: { page: 1, pages: 1, count: confirm.length } },
    queued: empty(page, queuedCount), printing: empty(), ready: empty(),
  } };
}
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); mocks.push.mockClear(); mocks.on.mockClear(); });

describe('shop order board', () => {
  it('does not show empty lanes when the initial order request fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 503 })));
    render(<ShopBoardPage />);
    expect((await screen.findByRole('alert')).textContent).toMatch(/do not assume there are no orders/i);
    expect(screen.queryByText('Nothing here')).toBeNull();
  });
  it('keeps the previous snapshot visible and warns when a later refresh fails', async () => {
    let broken = false;
    vi.stubGlobal('fetch', vi.fn(async () => broken ? new Response('', { status: 503 }) : Response.json(board())));
    render(<ShopBoardPage />);
    await screen.findByRole('button', { name: 'Payment received' });
    await waitFor(() => expect(mocks.on).toHaveBeenCalled());
    broken = true; fireEvent(document, new Event('visibilitychange'));
    await screen.findByText(/information below may be out of date/i);
    expect(screen.getByRole('button', { name: 'Payment received' })).toBeTruthy();
    broken = false; fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(screen.queryByText(/information below may be out of date/i)).toBeNull());
  });
  it('keeps pending payments unconfirmed and looks up only a valid tracking link', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json(board())));
    render(<ShopBoardPage />);
    expect((await screen.findByRole('button', { name: 'Payment received' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByText('Find an order with its tracking link'));
    const input = screen.getByLabelText('Tracking link or order ID');
    fireEvent.change(input, { target: { value: 'not-an-order' } });
    fireEvent.click(screen.getByRole('button', { name: 'Find order' }));
    expect(screen.getByRole('alert').textContent).toContain('full tracking link');
    fireEvent.change(input, { target: { value: `https://printly.example/track/${id}/?shared=1` } });
    fireEvent.click(screen.getByRole('button', { name: 'Find order' }));
    expect(mocks.push).toHaveBeenCalledWith(`/shop/orders/${id}`);
  });
  it('paginates beyond 100, searches on the server, and subscribes only to this shop', async () => {
    const requests: Array<{ search: string; pages: { queued: number } }> = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)); requests.push(body);
      return Response.json(board([], 135, body.pages.queued));
    }));
    render(<ShopBoardPage />);
    await screen.findByText('135 total · page 1 of 5');
    expect(screen.getAllByText('135')).toHaveLength(2); // exact completed count and queue total
    expect(mocks.on.mock.calls[0][1]).toMatchObject({ table: 'orders', filter: 'shop_id=eq.shop-1' });
    fireEvent.click(screen.getByRole('button', { name: 'Next queued page' }));
    await screen.findByText('135 total · page 2 of 5');
    fireEvent.change(screen.getByLabelText('Search all open orders'), { target: { value: 'A-123' } });
    await waitFor(() => expect(requests.some((r) => r.search === 'A-123' && r.pages.queued === 1)).toBe(true));
  });
  it('ignores older attention items falling into the bounded window but alerts for new ones', async () => {
    const starts = vi.fn();
    class TestAudio {
      state = 'running'; currentTime = 0; destination = {};
      resume = async () => {}; close = async () => {};
      createOscillator() { return { type: '', frequency: { value: 0 }, connect: () => {}, start: starts, stop: () => {} }; }
      createGain() { return { gain: { setValueAtTime: () => {}, exponentialRampToValueAtTime: () => {} }, connect: () => {} }; }
    }
    vi.stubGlobal('AudioContext', TestAudio);
    let attention = [{ id: 'newest', updated_at: '2026-11-19T12:00:00Z' }];
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ ...board([]), attention })));
    render(<ShopBoardPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Enable sound' }));
    await waitFor(() => expect(starts).toHaveBeenCalledTimes(1)); // opt-in test sound
    attention = [{ id: 'older', updated_at: '2026-11-19T11:00:00Z' }];
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await waitFor(() => expect((fetch as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThanOrEqual(2));
    expect(starts).toHaveBeenCalledTimes(1);
    attention = [{ id: 'fresh', updated_at: '2026-11-19T13:00:00Z' }];
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await waitFor(() => expect(starts).toHaveBeenCalledTimes(2));
  });
  it('requires an independent-verification confirmation for a submitted UPI report', async () => {
    const posts: string[] = [];
    const submitted = { ...payment, payment_status: 'submitted' };
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('confirm-payment')) { posts.push(url); return Response.json({ ok: true }); }
      return Response.json(board([submitted]));
    }));
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<ShopBoardPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Payment received' }));
    expect(confirm.mock.calls[0][0]).toMatch(/not proof of payment/i);
    expect(posts).toHaveLength(0);
  });
});
