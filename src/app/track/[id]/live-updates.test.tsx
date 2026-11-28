// @vitest-environment jsdom
import React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

const realtime = vi.hoisted(() => ({ signal: undefined as undefined | (() => void), stop: vi.fn() }));
vi.mock('@/lib/track-realtime', () => ({ subscribeTrackingUpdates: (_id: string, signal: () => void) => { realtime.signal = signal; return realtime.stop; } }));
vi.mock('next/navigation', () => ({ useParams: () => ({ id: '11111111-1111-4111-8111-111111111111' }) }));
vi.mock('next/link', () => ({ default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a href={href} {...props}>{children}</a> }));
import TrackPage from './page';

const id = '11111111-1111-4111-8111-111111111111';
afterEach(() => { cleanup(); realtime.signal = undefined; realtime.stop.mockClear(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it('shows the full order ID and updates from a hint without trusting its contents or requiring refresh', async () => {
  vi.useFakeTimers();
  let status = 'queued';
  const fetcher = vi.fn(async () => Response.json({ track: {
    order_id: id, token: 'A-123', status, payment_status: 'cod_pending', payment_method: 'cod',
    shop_name: 'Demo', shop_slug: 'demo', shop_city: '', total_paise: 100, eta_minutes: 10,
    item_count: 1, rush: false, created_at: '2026-11-19T12:00:00Z', ready_at: null, collected_at: null,
  } }));
  vi.stubGlobal('fetch', fetcher);
  const view = render(<TrackPage />);
  await act(async () => {});
  expect(screen.getByText(id)).toBeTruthy();
  expect(screen.getByText(/In the queue/)).toBeTruthy();
  status = 'printing';
  await act(async () => { realtime.signal?.(); realtime.signal?.(); realtime.signal?.(); vi.advanceTimersByTime(3_000); });
  expect(fetcher).toHaveBeenCalledTimes(2); // one initial request, one debounced authoritative read
  expect(screen.getByText(/Printing now/)).toBeTruthy();
  view.unmount();
  expect(realtime.stop).toHaveBeenCalledTimes(1);
});

it('uses visible-page polling when live updates are unavailable', async () => {
  vi.useFakeTimers();
  const fetcher = vi.fn(async () => Response.json({ track: {
    order_id: id, token: 'A-123', status: 'queued', payment_status: 'cod_pending', payment_method: 'cod',
    shop_name: 'Demo', shop_slug: 'demo', shop_city: '', total_paise: 100, eta_minutes: 10,
    item_count: 1, rush: false, created_at: '2026-11-19T12:00:00Z', ready_at: null, collected_at: null,
  } }));
  vi.stubGlobal('fetch', fetcher);
  render(<TrackPage />);
  await act(async () => {});
  await act(async () => { vi.advanceTimersByTime(15_000); });
  expect(fetcher).toHaveBeenCalledTimes(2);
  fireEvent(document, new Event('visibilitychange'));
});
