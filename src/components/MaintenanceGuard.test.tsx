// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ pathname: '/' }));
vi.mock('next/navigation', () => ({ usePathname: () => state.pathname }));
import { MaintenanceGuard } from './MaintenanceGuard';
import { MAINTENANCE_CHECK_INTERVAL_MS } from '@/lib/maintenance';

const open = () => Response.json({ maintenance: false });
const closed = () => Response.json({ error: { code: 'maintenance', message: 'Unavailable' } }, { status: 503 });
const flush = async () => { await act(async () => {}); };

beforeEach(() => {
  state.pathname = '/';
  vi.useFakeTimers();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('maintenance notice for already-open pages', () => {
  it('blocks the existing UI when maintenance starts, then restores it without losing input', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(open()).mockResolvedValueOnce(closed()).mockResolvedValueOnce(open());
    vi.stubGlobal('fetch', fetcher);
    render(<MaintenanceGuard><label>Draft note<input defaultValue="" /></label></MaintenanceGuard>);
    await flush();
    const input = screen.getByRole('textbox') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'Keep my draft' } });
    await act(async () => { await vi.advanceTimersByTimeAsync(MAINTENANCE_CHECK_INTERVAL_MS); });
    expect(screen.getByRole('alertdialog')).toBeTruthy();
    expect(screen.getByRole('img', { name: 'Printly' })).toBeTruthy();
    expect(screen.getByText('We’re making things better')).toBeTruthy();
    expect(screen.getByText(/don’t pay again/i)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Administrator sign in' }).getAttribute('href')).toBe('/admin/login');
    expect(input.closest('[inert]')).not.toBeNull();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Try again' })); });
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe('Keep my draft');
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(fetcher.mock.calls[0][0]).toBe('/api/maintenance-status');
  });

  it('does not poll or cover the admin console', async () => {
    state.pathname = '/admin/settings';
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    render(<MaintenanceGuard><p>Admin controls</p></MaintenanceGuard>);
    await flush();
    await act(async () => { await vi.advanceTimersByTimeAsync(MAINTENANCE_CHECK_INTERVAL_MS * 2); });
    expect(fetcher).not.toHaveBeenCalled();
    expect(screen.getByText('Admin controls')).toBeTruthy();
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('checks again on focus and shows an honest outage message if the check fails', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(open()).mockRejectedValueOnce(new Error('offline'));
    vi.stubGlobal('fetch', fetcher);
    render(<MaintenanceGuard><p>Customer page</p></MaintenanceGuard>);
    await flush();
    await act(async () => { window.dispatchEvent(new Event('focus')); });
    expect(screen.getByRole('alertdialog')).toBeTruthy();
    expect(screen.getByText('Temporarily unavailable')).toBeTruthy();
    expect(screen.queryByText('Maintenance in progress')).toBeNull();
  });
});
