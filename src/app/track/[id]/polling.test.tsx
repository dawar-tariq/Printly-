// @vitest-environment jsdom
import React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

vi.mock('next/navigation', () => ({ useParams: () => ({ id: '11111111-1111-4111-8111-111111111111' }) }));
vi.mock('next/link', () => ({ default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a href={href} {...props}>{children}</a> }));
import TrackPage from './page';

afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it('pauses background tracking and refreshes as soon as the tab becomes visible', async () => {
  vi.useFakeTimers();
  let visibility: DocumentVisibilityState = 'visible';
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);
  const fetchMock = vi.fn(async () => Response.json({ track: {
    order_id: '11111111-1111-4111-8111-111111111111', token: 'A1', status: 'queued',
    payment_status: 'cod_pending', payment_method: 'cod', shop_name: 'Shop', shop_slug: 'shop',
    shop_city: '', total_paise: 100, eta_minutes: 20, item_count: 1, rush: false,
    created_at: '2026-11-19T12:00:00Z', ready_at: null, collected_at: null,
  } }));
  vi.stubGlobal('fetch', fetchMock);
  render(<TrackPage />);
  await act(async () => {});
  expect(fetchMock).toHaveBeenCalledTimes(1);
  visibility = 'hidden';
  await act(async () => { vi.advanceTimersByTime(45_000); });
  expect(fetchMock).toHaveBeenCalledTimes(1);
  visibility = 'visible';
  await act(async () => { fireEvent(document, new Event('visibilitychange')); });
  expect(fetchMock).toHaveBeenCalledTimes(2);
  await act(async () => { vi.advanceTimersByTime(15_000); });
  expect(fetchMock).toHaveBeenCalledTimes(3);
});

const tracked = (token: string) => ({
  order_id: '11111111-1111-4111-8111-111111111111', token, status: 'queued',
  payment_status: 'cod_pending', payment_method: 'cod', shop_name: 'Shop', shop_slug: 'shop',
  shop_city: '', total_paise: 100, eta_minutes: 20, item_count: 1, rush: false,
  created_at: '2026-11-19T12:00:00Z', ready_at: null, collected_at: null,
});

it('does not let an older request overwrite a newer tracking update', async () => {
  let resolveOld!: (response: Response) => void;
  const oldResponse = new Promise<Response>((resolve) => { resolveOld = resolve; });
  const fetchMock = vi.fn().mockReturnValueOnce(oldResponse).mockResolvedValue(Response.json({ track: tracked('NEW') }));
  vi.stubGlobal('fetch', fetchMock);
  render(<TrackPage />);
  await act(async () => { fireEvent(document, new Event('visibilitychange')); });
  expect(await screen.findByText('NEW')).toBeTruthy();
  await act(async () => { resolveOld(Response.json({ track: tracked('OLD') })); });
  expect(screen.queryByText('OLD')).toBeNull();
  expect(screen.getByText('NEW')).toBeTruthy();
});

it('retains the last order and warns if a refresh returns invalid data', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(Response.json({ track: tracked('A1') })).mockResolvedValue(Response.json({})));
  render(<TrackPage />);
  expect(await screen.findByText('A1')).toBeTruthy();
  await act(async () => { fireEvent(document, new Event('visibilitychange')); });
  expect(screen.getByText('A1')).toBeTruthy();
  expect(screen.getByRole('status').textContent).toMatch(/may be out of date/i);
});
