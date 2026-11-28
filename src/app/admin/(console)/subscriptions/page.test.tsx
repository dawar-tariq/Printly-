// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

vi.mock('next/link', () => ({ default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a href={href} {...props}>{children}</a> }));
import AdminSubscriptionsPage from './page';

const shopId = '11111111-1111-4111-8111-111111111111';
const purchaseId = '22222222-2222-4222-8222-222222222222';
let writes: Array<{ url: string; body: Record<string, unknown> }>;
const fixture = { plan: { monthly_paise: null, six_months_paise: null, yearly_paise: null, upi_id: null, payee_name: null, warning_days: 7, version: 3 },
  shops: [{ id: shopId, name: 'Demo Shop', short_code: 'DEMO', status: 'active', subscription: null }],
  pending: [{ id: purchaseId, shop_id: shopId, term: 'monthly', amount_paise: 12500, upi_id: 'printly@upi', payee_name: 'Printly', status: 'submitted', utr: '123456789012', submitted_at: '2026-01-02T00:00:00Z', shop: { id: shopId, name: 'Demo Shop', short_code: 'DEMO' } }],
  history: [], pagination: { page: 1, pages: 1, count: 1, pendingPage: 1, pendingPages: 1, pendingCount: 1 } };
beforeEach(() => {
  writes = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === 'POST' || init?.method === 'PUT') { writes.push({ url, body: JSON.parse(String(init.body)) }); return Response.json({ ok: true }); }
    if (url.includes('/offers')) return Response.json({ promos: [], announcements: [], promos_has_more: false, announcements_has_more: false });
    return Response.json(fixture);
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('admin subscription management', () => {
  it('requires confirmation before starting the selected shop pilot', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<AdminSubscriptionsPage />);
    const button = await screen.findByRole('button', { name: 'Grant 30-day pilot' });
    fireEvent.click(button);
    expect(writes).toEqual([]);
    confirm.mockReturnValue(true);
    fireEvent.click(button);
    await waitFor(() => expect(writes).toEqual([{ url: '/api/admin/subscriptions/pilot', body: { shop_id: shopId } }]));
  });
  it('requires the admin to acknowledge independent verification before approval', async () => {
    render(<AdminSubscriptionsPage />);
    expect(await screen.findByText('123456789012')).toBeTruthy();
    const approve = screen.getByRole('button', { name: 'Approve verified payment' }) as HTMLButtonElement;
    expect(approve.disabled).toBe(true);
    fireEvent.click(screen.getByLabelText('I independently checked this exact transfer in the receiving account.'));
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    fireEvent.click(approve);
    expect(writes).toEqual([]);
    confirm.mockReturnValue(true);
    fireEvent.click(approve);
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0]).toEqual({ url: '/api/admin/subscriptions/review', body: { purchase_id: purchaseId, action: 'approve', note: '' } });
  });
  it('requires an explanation before rejection and supports permanent grants without purchase', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<AdminSubscriptionsPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Reject report' }));
    expect(screen.getByRole('alert').textContent).toContain('reason');
    expect(writes).toEqual([]);
    fireEvent.change(screen.getByLabelText('Review note (required for rejection)'), { target: { value: 'Transfer not found' } });
    fireEvent.click(screen.getByRole('button', { name: 'Reject report' }));
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0].body).toMatchObject({ action: 'reject', note: 'Transfer not found' });
    await waitFor(() => expect((screen.getByRole('button', { name: 'Grant permanent' }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: 'Grant permanent' }));
    await waitFor(() => expect(writes).toHaveLength(2));
    expect(writes[1]).toMatchObject({ url: '/api/admin/subscriptions/permanent', body: { shop_id: shopId, enabled: true } });
  });
  it('rejects stale edits and lets an admin deliberately reload the latest plan', async () => {
    let version = 3;
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'PUT') return Response.json({ error: { message: 'The plan was changed by another admin. Reload the saved values before making your changes again.' } }, { status: 409 });
      if (url.includes('/offers')) return Response.json({ promos: [], announcements: [], promos_has_more: false, announcements_has_more: false });
      return Response.json({ ...fixture, plan: { ...fixture.plan, version, monthly_paise: version === 4 ? 25000 : null } });
    }));
    render(<AdminSubscriptionsPage />);
    await screen.findByText('Plan and payment settings');
    fireEvent.change(screen.getByLabelText('Monthly price (₹)'), { target: { value: '125' } });
    version = 4;
    fireEvent.click(screen.getByRole('button', { name: 'Save plan settings' }));
    expect((await screen.findByRole('alert')).textContent).toContain('another admin');
    fireEvent.click(screen.getByRole('button', { name: 'Reload saved values' }));
    await waitFor(() => expect((screen.getByLabelText('Monthly price (₹)') as HTMLInputElement).value).toBe('250.00'));
  });

  it('saves exact term prices and the configured Printly UPI recipient', async () => {
    render(<AdminSubscriptionsPage />);
    await screen.findByText('Plan and payment settings');
    fireEvent.change(screen.getByLabelText('Monthly price (₹)'), { target: { value: '125.50' } });
    fireEvent.change(screen.getByLabelText('Six-month price (₹)'), { target: { value: '600' } });
    fireEvent.change(screen.getByLabelText('Printly UPI ID'), { target: { value: 'printly@upi' } });
    fireEvent.change(screen.getByLabelText('UPI payee name'), { target: { value: 'Printly' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save plan settings' }));
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0]).toEqual({ url: '/api/admin/subscriptions', body: { expected_version: 3, monthly_paise: 12550, six_months_paise: 60000, yearly_paise: null, upi_id: 'printly@upi', payee_name: 'Printly', warning_days: 7 } });
    expect(screen.queryByText(/commission|settlement/i)).toBeNull();
  });
});
