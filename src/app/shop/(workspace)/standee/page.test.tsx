// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

vi.mock('next/link', () => ({ default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a href={href} {...props}>{children}</a> }));
import ShopStandeePage from './page';

const first = {
  info: { shop_name: 'Bright Prints', owner_name: 'Asha Khan', short_code: 'AB1234', order_url: 'https://printly.example/s/p-ab1234/order', status: 'active', kyc_status: 'approved' },
  revision: 'a'.repeat(64), theme: 'orange', preview: 'data:image/png;base64,YQ==',
};
let current: typeof first;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  current = structuredClone(first);
  fetchMock = vi.fn(async (url: string) => {
    const params = new URL(url, 'https://printly.example').searchParams;
    if (params.get('format') === 'preview') return Response.json({ ...current, theme: params.get('theme') });
    return new Response('file', { status: 200, headers: { 'Content-Type': 'application/pdf' } });
  });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('shop standee dashboard', () => {
  it('shows the real saved identity, ordering URL, QR preview and all requested actions', async () => {
    render(<ShopStandeePage />);
    await screen.findByText('Bright Prints');
    expect(screen.getByText('Asha Khan')).toBeTruthy();
    expect(screen.getByText('AB1234')).toBeTruthy();
    expect(screen.getByRole('link', { name: /printly.example\/s\/p-ab1234\/order/i }).getAttribute('href')).toBe(first.info.order_url);
    expect(screen.getByRole('img', { name: 'A4 QR standee for Bright Prints' }).getAttribute('src')).toBe(first.preview);
    for (const label of ['Generate QR Standee', 'Preview Standee', 'Download PDF', 'Download PNG']) expect(screen.getByRole('button', { name: label })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Print Standee' }).getAttribute('href')).toContain(`revision=${first.revision}`);
    expect(screen.getByRole('link', { name: 'Settings & QR' }).getAttribute('href')).toBe('/shop/settings');
    fireEvent.click(screen.getByRole('button', { name: 'Preview Standee' }));
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByRole('img', { name: 'Full preview of Bright Prints standee' })).toBeTruthy();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('regenerates using the latest saved details and warns when a shop is not active', async () => {
    render(<ShopStandeePage />);
    await screen.findByText('Bright Prints');
    current = { ...current, info: { ...current.info, shop_name: 'Updated Shop', owner_name: 'New Owner', status: 'paused', kyc_status: 'pending' }, revision: 'b'.repeat(64) };
    fireEvent.click(screen.getByRole('button', { name: 'Generate QR Standee' }));
    await screen.findByText('Updated Shop');
    expect(screen.getByText('New Owner')).toBeTruthy();
    expect(screen.queryByText('Asha Khan')).toBeNull();
    expect(screen.getByRole('status').textContent).toContain("isn't accepting orders yet");
    expect(screen.getByRole('link', { name: 'Print Standee' }).getAttribute('href')).toContain(`revision=${'b'.repeat(64)}`);
  });

  it('regenerates approved colours and downloads the matching revision', async () => {
    render(<ShopStandeePage />);
    await screen.findByText('Bright Prints');
    fireEvent.click(screen.getByRole('button', { name: 'Deep orange' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('theme=deep'), expect.any(Object)));
    await waitFor(() => expect((screen.getByRole('button', { name: 'Download PDF' }) as HTMLButtonElement).disabled).toBe(false));
    expect(screen.getByRole('button', { name: 'Deep orange' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('link', { name: 'Print Standee' }).getAttribute('href')).toContain('theme=deep');
    const createObjectURL = vi.fn(() => 'blob:standee');
    const revokeObjectURL = vi.fn();
    class MockURL extends URL { static createObjectURL = createObjectURL; static revokeObjectURL = revokeObjectURL; }
    vi.stubGlobal('URL', MockURL);
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const timers = vi.spyOn(window, 'setTimeout');
    fireEvent.click(screen.getByRole('button', { name: 'Download PDF' }));
    await waitFor(() => expect(createObjectURL).toHaveBeenCalled());
    expect(click).toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining(`format=pdf&theme=deep&revision=${first.revision}`), expect.any(Object));
    const revokeTimer = timers.mock.calls.findIndex((args) => args[1] === 60_000);
    if (revokeTimer >= 0) window.clearTimeout(timers.mock.results[revokeTimer].value as unknown as number);
  });

  it('surfaces a stale preview error and disables exports until regeneration', async () => {
    fetchMock.mockImplementation(async (url: string) => url.includes('format=preview')
      ? Response.json(first)
      : Response.json({ error: { message: 'Shop details have changed. Generate the standee again.' } }, { status: 409 }));
    render(<ShopStandeePage />);
    await screen.findByText('Bright Prints');
    fireEvent.click(screen.getByRole('button', { name: 'Download PNG' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Generate the standee again');
    expect((screen.getByRole('button', { name: 'Download PNG' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
