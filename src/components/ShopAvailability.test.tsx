// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));
import { ShopAvailability } from './ShopAvailability';
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); refresh.mockClear(); });

describe('shop owner availability control', () => {
  it('lets an owner close and reopen without implying subscription override', async () => {
    const calls: boolean[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      const { is_open } = JSON.parse(String(init.body)); calls.push(is_open); return Response.json({ is_open });
    }));
    render(<ShopAvailability initialOpen isOwner />);
    expect(screen.getByText(/active subscription/i)).toBeTruthy();
    expect(screen.getByLabelText('Shop availability').className).toContain('open');
    fireEvent.click(screen.getByRole('button', { name: 'Close shop' }));
    expect(await screen.findByText('Shop closed')).toBeTruthy();
    expect(screen.getByLabelText('Shop availability').className).toContain('closed');
    expect(screen.getByText(/Existing orders and started payments remain available/i)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Reopen shop' }));
    await screen.findByText('Shop open');
    expect(calls).toEqual([false, true]); expect(refresh).toHaveBeenCalledTimes(2);
  });
  it('lets staff see the status but not change it', () => {
    render(<ShopAvailability initialOpen={false} isOwner={false} />);
    expect(screen.getByText('Shop closed')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Reopen shop' })).toBeNull();
    expect(screen.getByText(/Only the owner can change/i)).toBeTruthy();
  });
  it('does not guess the outcome of a lost response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network lost'); }));
    render(<ShopAvailability initialOpen isOwner />);
    fireEvent.click(screen.getByRole('button', { name: 'Close shop' }));
    await waitFor(() => expect(screen.getByText('Status unconfirmed')).toBeTruthy());
    expect(screen.getByRole('button', { name: 'Refresh status' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Close shop' })).toBeNull();
  });
});
