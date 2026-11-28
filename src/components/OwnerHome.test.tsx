// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { OwnerHome } from './OwnerHome';

const empty = () => ({ orders: [], pagination: { count: 0 } });
const board = () => ({ lanes: { confirm: empty(), queued: { orders: [{ id: 'order', token: 'A-001', status: 'queued', customer_name: 'Test customer', total_paise: 123, created_at: new Date().toISOString() }], pagination: { count: 1 } }, printing: empty(), ready: empty() } });
const success = (value: unknown) => ({ ok: true, json: async () => value }) as Response;
beforeEach(() => vi.stubGlobal('fetch', vi.fn()));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('shop overview', () => {
  it('shows live summary values and links to the existing shop tools', async () => {
    vi.mocked(fetch).mockImplementation(async (url) => String(url).includes('/board') ? success(board()) : String(url).includes('/me') ? success({ shop: { name: 'Example shop' } }) : success({ orders_count: 1, revenue_paise: 123 }));
    render(<OwnerHome />);
    expect(await screen.findByText('#A-001')).toBeTruthy();
    expect(screen.getByText('Orders started today')).toBeTruthy();
    expect(screen.getAllByText('₹1.23')).toHaveLength(2);
    expect(screen.getByRole('link', { name: /view orders/i }).getAttribute('href')).toBe('/shop');
    expect(screen.getByRole('link', { name: /shop qr/i }).getAttribute('href')).toBe('/shop/settings#shop-qr');
    expect(screen.getByRole('link', { name: /rates/i }).getAttribute('href')).toBe('/shop/settings#rate-card');
  });
  it('keeps important orders visible when the report is unavailable', async () => {
    vi.mocked(fetch).mockImplementation(async (url) => String(url).includes('/board') ? success(board()) : String(url).includes('/me') ? success({ shop: { name: 'Example shop' } }) : Promise.reject(new Error('offline')));
    render(<OwnerHome firstName="Owner" />);
    expect(await screen.findByText('#A-001')).toBeTruthy();
    expect(screen.getByText('Example shop')).toBeTruthy();
    expect((await screen.findByRole('alert')).textContent).toMatch(/could not be refreshed/i);
    expect(screen.queryByText('No open orders right now.')).toBeNull();
  });
  it('does not claim there are no orders if the board cannot load', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('offline'));
    render(<OwnerHome />);
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.queryByText('No open orders right now.')).toBeNull();
    expect(screen.getByText(/Order list unavailable/i)).toBeTruthy();
  });
  it('refreshes when the page becomes visible', async () => {
    vi.mocked(fetch).mockImplementation(async (url) => String(url).includes('/board') ? success(board()) : String(url).includes('/me') ? success({ shop: { name: 'Example shop' } }) : success({ orders_count: 1, revenue_paise: 123 }));
    render(<OwnerHome />);
    await screen.findByText('#A-001');
    const calls = vi.mocked(fetch).mock.calls.length;
    document.dispatchEvent(new Event('visibilitychange'));
    await waitFor(() => expect(vi.mocked(fetch).mock.calls.length).toBeGreaterThan(calls));
  });
});
