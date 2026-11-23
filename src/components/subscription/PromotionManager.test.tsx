// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { PromotionManager } from './PromotionManager';

const promoId = '11111111-1111-4111-8111-111111111111';
const plan = { monthly_paise: 12500, six_months_paise: 60000, yearly_paise: 100000, upi_id: 'printly@upi', payee_name: 'Printly', warning_days: 7 };
let offers: any;
let writes: any[];
beforeEach(() => {
  writes = [];
  offers = { promos: [], announcements: [], promos_has_more: false, announcements_has_more: false };
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === 'POST') { const body = JSON.parse(String(init.body)); writes.push(body); return Response.json({ ok: true, result: { id: promoId } }); }
    return Response.json(offers);
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('promotion manager', () => {
  it('creates a fixed-amount code with terms, IST dates and usage limits', async () => {
    render(<PromotionManager plan={plan} />);
    await screen.findByText('No promo codes yet.');
    fireEvent.change(screen.getByLabelText('Promo code'), { target: { value: 'thankyou' } });
    fireEvent.change(screen.getByLabelText('Discount type'), { target: { value: 'fixed' } });
    fireEvent.change(screen.getByLabelText('Amount off (₹)'), { target: { value: '25.50' } });
    fireEvent.click(screen.getByLabelText('Monthly'));
    fireEvent.change(screen.getByLabelText('Promo starts at (IST)'), { target: { value: '2030-01-01T10:30' } });
    fireEvent.change(screen.getByLabelText('Promo ends at (IST)'), { target: { value: '2030-01-31T23:59' } });
    fireEvent.change(screen.getByLabelText('Total use limit'), { target: { value: '50' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create promo code' }));
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0]).toEqual({ action: 'save_promo', id: null, expected_version: null, promo: {
      code: 'THANKYOU', discount_type: 'fixed', discount_value: 2550, terms: ['six_months', 'yearly'],
      starts_at: '2030-01-01T05:00:00.000Z', ends_at: '2030-01-31T18:29:00.000Z', max_uses: 50, max_uses_per_shop: 1, enabled: true,
    } });
    expect(await screen.findByText(/Promo saved/)).toBeTruthy();
  });
  it('warns before saving an unlimited free code', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<PromotionManager plan={plan} />);
    await screen.findByText('No promo codes yet.');
    fireEvent.change(screen.getByLabelText('Promo code'), { target: { value: 'FREE100' } });
    fireEvent.change(screen.getByLabelText('Percent off'), { target: { value: '100' } });
    fireEvent.change(screen.getByLabelText('Uses per shop'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create promo code' }));
    expect(confirm).toHaveBeenCalledWith(expect.stringMatching(/no per-shop limit/i));
    expect(writes).toHaveLength(0);
    confirm.mockReturnValue(true);
    fireEvent.click(screen.getByRole('button', { name: 'Create promo code' }));
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0].promo).toMatchObject({ discount_value: 100, max_uses_per_shop: null });
  });
  it('checks only eligible term prices before warning that a fixed code can be free', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<PromotionManager plan={plan} />);
    await screen.findByText('No promo codes yet.');
    fireEvent.change(screen.getByLabelText('Promo code'), { target: { value: 'YEAR125' } });
    fireEvent.change(screen.getByLabelText('Discount type'), { target: { value: 'fixed' } });
    fireEvent.change(screen.getByLabelText('Amount off (₹)'), { target: { value: '125' } });
    fireEvent.click(screen.getByLabelText('Monthly'));
    fireEvent.click(screen.getByLabelText('Six months'));
    fireEvent.change(screen.getByLabelText('Uses per shop'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create promo code' }));
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(confirm).not.toHaveBeenCalled();
    expect(writes[0].promo).toMatchObject({ discount_value: 12500, terms: ['yearly'], max_uses_per_shop: null });
  });
  it('creates a public announcement linked to an existing code', async () => {
    offers.promos = [{ id: promoId, code: 'THANKS', discount_type: 'percent', discount_value: 25, terms: ['monthly'],
      starts_at: null, ends_at: null, max_uses: null, max_uses_per_shop: 1, enabled: true, version: 0, approved_uses: 0, reserved_uses: 0 }];
    render(<PromotionManager plan={plan} />);
    await screen.findByRole('button', { name: 'Edit promo THANKS' });
    fireEvent.change(screen.getByLabelText('Announcement title'), { target: { value: 'A treat for shops' } });
    fireEvent.change(screen.getByLabelText('Announcement message'), { target: { value: 'Thank you for being with us.' } });
    fireEvent.change(screen.getByLabelText('Link a promo code (optional)'), { target: { value: ' thanks ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create announcement' }));
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0]).toEqual({ action: 'save_announcement', id: null, expected_version: null, announcement: {
      title: 'A treat for shops', message: 'Thank you for being with us.', promo_code: 'THANKS',
      starts_at: null, ends_at: null, enabled: true, public_visible: true,
    } });
  });
  it('keeps an older linked code when editing or pausing its announcement', async () => {
    offers.announcements = [{ id: '22222222-2222-4222-8222-222222222222', title: 'Older offer', message: 'Hello', promo_id: promoId,
      promo_code: 'OLDSALE', starts_at: null, ends_at: null, enabled: true, public_visible: true, version: 3 }];
    render(<PromotionManager plan={plan} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Edit announcement Older offer' }));
    expect((screen.getByLabelText('Link a promo code (optional)') as HTMLInputElement).value).toBe('OLDSALE');
    fireEvent.click(screen.getByRole('button', { name: 'Save announcement changes' }));
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0]).toMatchObject({ expected_version: 3, announcement: { promo_code: 'OLDSALE', enabled: true } });
    await waitFor(() => expect((screen.getByRole('button', { name: 'Pause announcement Older offer' }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: 'Pause announcement Older offer' }));
    await waitFor(() => expect(writes).toHaveLength(2));
    expect(writes[1]).toMatchObject({ expected_version: 3, announcement: { promo_code: 'OLDSALE', enabled: false } });
  });
  it('edits a code using its saved version and makes the code immutable', async () => {
    offers.promos = [{ id: promoId, code: 'THANKS', discount_type: 'percent', discount_value: 25, terms: ['monthly'],
      starts_at: null, ends_at: null, max_uses: 5, max_uses_per_shop: 1, enabled: true, version: 7, approved_uses: 2, reserved_uses: 1 }];
    render(<PromotionManager plan={plan} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Edit promo THANKS' }));
    expect((screen.getByLabelText('Promo code') as HTMLInputElement).readOnly).toBe(true);
    fireEvent.change(screen.getByLabelText('Percent off'), { target: { value: '30' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save promo changes' }));
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0]).toMatchObject({ id: promoId, expected_version: 7, promo: { code: 'THANKS', discount_value: 30, max_uses: 5 } });
  });
  it('navigates independently to older codes and announcements', async () => {
    const requests: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      requests.push(url);
      const params = new URL(url, 'https://printly.test').searchParams;
      const promoPage = Number(params.get('promo_page')), announcementPage = Number(params.get('announcement_page'));
      return Response.json({
        promos: promoPage ? [{ id: promoId, code: 'OLDSALE', discount_type: 'percent', discount_value: 25, terms: ['monthly'],
          starts_at: null, ends_at: null, max_uses: null, max_uses_per_shop: 1, enabled: true, version: 0, approved_uses: 0, reserved_uses: 0 }] : [],
        announcements: announcementPage ? [{ id: '22222222-2222-4222-8222-222222222222', title: 'Older update', message: 'Hello', promo_id: promoId,
          promo_code: 'OLDSALE', starts_at: null, ends_at: null, enabled: true, public_visible: true, version: 0 }] : [],
        promos_has_more: promoPage === 0, announcements_has_more: announcementPage === 0,
      });
    }));
    render(<PromotionManager plan={plan} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Older promo codes' }));
    await screen.findByRole('button', { name: 'Edit promo OLDSALE' });
    fireEvent.click(screen.getByRole('button', { name: 'Older announcements' }));
    await screen.findByRole('button', { name: 'Edit announcement Older update' });
    expect(requests.at(-1)).toContain('promo_page=1&announcement_page=1');
    fireEvent.click(screen.getByRole('button', { name: 'Newer promo codes' }));
    await screen.findByText('No promo codes yet.');
    expect(requests.at(-1)).toContain('promo_page=0&announcement_page=1');
    expect(screen.getByRole('button', { name: 'Edit announcement Older update' })).toBeTruthy();
  });
  it('shows invalid date order without sending a request', async () => {
    render(<PromotionManager plan={plan} />);
    await screen.findByText('No promo codes yet.');
    fireEvent.change(screen.getByLabelText('Promo code'), { target: { value: 'SALE20' } });
    fireEvent.change(screen.getByLabelText('Percent off'), { target: { value: '20' } });
    fireEvent.change(screen.getByLabelText('Promo starts at (IST)'), { target: { value: '2031-01-01T10:30' } });
    fireEvent.change(screen.getByLabelText('Promo ends at (IST)'), { target: { value: '2030-01-01T10:30' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create promo code' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/end must be later/i);
    expect(writes).toHaveLength(0);
  });
});
