// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

vi.mock('recharts', () => ({ ResponsiveContainer: ({ children }: React.PropsWithChildren) => <div>{children}</div>, BarChart: ({ children }: React.PropsWithChildren) => <div>{children}</div>, Bar: () => null, Tooltip: () => null, XAxis: () => null, YAxis: () => null }));
import ReportsPage from './page';

const report = (orders: number, paise: number) => ({ days: 1, orders_count: orders, paid_orders_count: orders, revenue_paise: paise, avg_order_paise: paise, service_counts: {}, series: [{ day: 'Today', revenue_paise: paise, orders }] });
const success = (data: unknown) => ({ ok: true, json: async () => data }) as Response;
beforeEach(() => vi.stubGlobal('fetch', vi.fn()));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('reports screen', () => {
  it('shows a useful recovery message rather than a misleading empty total', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({ ok: false, json: async () => ({ error: { message: 'Choose a shorter period.' } }) } as Response);
    render(<ReportsPage />);
    expect((await screen.findByRole('alert')).textContent).toMatch(/choose a shorter period/i);
    expect(screen.queryByText('Revenue (collected)')).toBeNull();
  });
  it('ignores a slower response for the previously selected period and preserves paise', async () => {
    let resolveWeek!: (value: Response) => void;
    vi.mocked(fetch).mockReturnValueOnce(new Promise((resolve) => { resolveWeek = resolve; })).mockResolvedValueOnce(success(report(2, 123)));
    render(<ReportsPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Today' }));
    expect(await screen.findAllByText('₹1.23')).toHaveLength(2);
    resolveWeek(success(report(99, 99900)));
    await waitFor(() => expect(screen.queryByText('99 orders started')).toBeNull());
    expect(screen.getByText('2 orders started')).toBeTruthy();
  });
});
