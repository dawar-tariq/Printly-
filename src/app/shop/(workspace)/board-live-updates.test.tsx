// @vitest-environment jsdom
import React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';

const realtime = vi.hoisted(() => ({ bindings: [] as Array<{ filter: Record<string, string>; callback: () => void }>, status: undefined as undefined | ((s: string) => void), remove: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('next/link', () => ({ default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a href={href} {...props}>{children}</a> }));
vi.mock('@/lib/supabase-client', () => ({ createBrowserSupabase: () => {
  const channel = {
    on: (_kind: string, filter: Record<string, string>, callback: () => void) => { realtime.bindings.push({ filter, callback }); return channel; },
    subscribe: (callback: (s: string) => void) => { realtime.status = callback; return channel; },
  };
  return { channel: () => channel, removeChannel: realtime.remove };
} }));
import ShopBoardPage from './page';

const empty = { orders: [], pagination: { page: 1, pages: 1, count: 0 } };
afterEach(() => { cleanup(); realtime.bindings = []; realtime.status = undefined; realtime.remove.mockClear(); vi.useRealTimers(); vi.unstubAllGlobals(); });

it('subscribes only to this shop’s inserts and updates and refreshes after a hint or reconnect', async () => {
  vi.useFakeTimers();
  const fetcher = vi.fn(async () => Response.json({ shop_id: 'shop-1', completed_today: 0, attention: [], lanes: {
    confirm: empty, queued: empty, printing: empty, ready: empty,
  } }));
  vi.stubGlobal('fetch', fetcher);
  const view = render(<ShopBoardPage />);
  await act(async () => {});
  expect(screen.getByText('New orders')).toBeTruthy();
  expect(realtime.bindings.map(({ filter }) => filter.event)).toEqual(['INSERT', 'UPDATE']);
  expect(realtime.bindings.every(({ filter }) => filter.filter === 'shop_id=eq.shop-1')).toBe(true);
  expect(fetcher).toHaveBeenCalledTimes(1);
  await act(async () => { realtime.bindings[1].callback(); realtime.bindings[1].callback(); vi.advanceTimersByTime(350); });
  expect(fetcher).toHaveBeenCalledTimes(2);
  await act(async () => { realtime.status?.('SUBSCRIBED'); });
  expect(fetcher).toHaveBeenCalledTimes(3);
  view.unmount();
  expect(realtime.remove).toHaveBeenCalledTimes(1);
});
