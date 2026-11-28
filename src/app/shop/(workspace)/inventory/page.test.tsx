// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import InventoryPage from './page';

const stock = [{ id: 'one', name: 'A4 paper', category: 'paper', qty: 5, unit: 'sheets', low_stock_threshold: 10 }];
const success = () => ({ ok: true, json: async () => ({ items: stock }) });
beforeEach(() => { vi.stubGlobal('fetch', vi.fn()); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('mobile inventory', () => {
  it('never presents an unavailable stock list as empty or healthy', async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error('offline'));
    render(<InventoryPage />);
    expect((await screen.findByRole('alert')).textContent).toMatch(/could not refresh stock/i);
    expect(screen.queryByText(/no stock yet/i)).toBeNull();
    expect(screen.getByText(/stock is unavailable/i)).toBeTruthy();
  });
  it('does not let a refresh started before an uncertain write unlock retries', async () => {
    let resolveOld!: (value: Response) => void;
    vi.mocked(fetch).mockResolvedValueOnce(success() as Response)
      .mockReturnValueOnce(new Promise((resolve) => { resolveOld = resolve; }))
      .mockRejectedValueOnce(new Error('lost response'));
    render(<InventoryPage />);
    await screen.findByText('A4 paper');
    fireEvent.click(screen.getByRole('button', { name: 'Refresh inventory' }));
    fireEvent.click(screen.getByRole('button', { name: /add 10 sheets to A4 paper/i }));
    await screen.findByRole('alert');
    resolveOld(success() as Response);
    await waitFor(() => expect((screen.getByRole('button', { name: /add 10 sheets to A4 paper/i }) as HTMLButtonElement).disabled).toBe(true));
    expect(screen.getByRole('alert').textContent).toMatch(/could not confirm/i);
  });
  it('requires a refresh after an uncertain adjustment and supports the low-stock filter', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(success() as Response).mockRejectedValueOnce(new Error('lost response')).mockResolvedValueOnce(success() as Response);
    render(<InventoryPage />);
    expect(await screen.findByText('A4 paper')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /low stock \(1\)/i }));
    expect(screen.getByText('A4 paper')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /add 10 sheets to A4 paper/i }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/could not confirm.*refresh/i);
    expect((screen.getByRole('button', { name: /add 10 sheets to A4 paper/i }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: /refresh stock/i }));
    await waitFor(() => expect((screen.getByRole('button', { name: /add 10 sheets to A4 paper/i }) as HTMLButtonElement).disabled).toBe(false));
  });
  it('sends stock adjustments and threshold edits, then reloads saved stock', async () => {
    vi.mocked(fetch).mockResolvedValue(success() as Response);
    render(<InventoryPage />);
    await screen.findByText('A4 paper');
    fireEvent.click(screen.getByRole('button', { name: /add 10 sheets to A4 paper/i }));
    await screen.findByText('Stock updated.');
    expect(fetch).toHaveBeenCalledWith('/api/shop/inventory/one', expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ adjust: 10 }) }));
    fireEvent.click(screen.getByRole('button', { name: 'Set low-stock level' }));
    fireEvent.change(screen.getByLabelText('Low at or below (sheets)'), { target: { value: '12' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/shop/inventory/one', expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ low_stock_threshold: 12 }) })));
  });
  it('adds and deletes items only after the intended user actions', async () => {
    vi.mocked(fetch).mockResolvedValue(success() as Response);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<InventoryPage />);
    await screen.findByText('A4 paper');
    fireEvent.click(screen.getByText('Add a stock item'));
    fireEvent.change(screen.getByLabelText('Item name'), { target: { value: 'New paper' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add item' }));
    await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/shop/inventory', expect.objectContaining({ method: 'POST', body: expect.stringContaining('New paper') })));
    await waitFor(() => expect((screen.getByRole('button', { name: 'Delete A4 paper' }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: 'Delete A4 paper' }));
    await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/shop/inventory/one', expect.objectContaining({ method: 'DELETE' })));
  });

});
