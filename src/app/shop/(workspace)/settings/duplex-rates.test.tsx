// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('@/components/AccountPassword', () => ({ AccountPassword: () => null }));
import ShopSettingsPage from './page';

type Row = { service: string; paper_size: string | null; color: string | null; sides: string | null; paper_gsm: number | null; option: string | null; unit: string; price_paise: number };
const single: Row = { service: 'print', paper_size: 'A4', color: 'bw', sides: 'single', paper_gsm: 80, option: null, unit: 'page', price_paise: 200 };
const duplex: Row = { ...single, sides: 'duplex', price_paise: 150 };
const legacy: Row = { service: 'photocopy', paper_size: 'A4', color: 'bw', sides: null, paper_gsm: null, option: null, unit: 'sheet', price_paise: 175 };
let rows: Row[];
let saved: Row[][];

beforeEach(() => {
  rows = [{ ...single }, { ...duplex }, { ...legacy }];
  saved = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/shop/me') return Response.json({
      shop: { name: 'Shop', address: 'Street', city: 'Srinagar', phone: '9999999999', gstin: null, upi_id: null, eta_minutes: 20, rush_surcharge_bps: 1000, short_code: 'DEMO1', kyc_status: 'approved' },
      services: [], onboarding: null, is_owner: true,
    });
    if (url === '/api/shop/rate-card' && init?.method === 'PUT') {
      saved.push(JSON.parse(String(init.body)).rows);
      return Response.json({ ok: true });
    }
    if (url === '/api/shop/rate-card') return Response.json({ rows });
    throw new Error(`Unexpected fetch: ${url}`);
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('shop duplex rate editor', () => {
  it('offers the Android app download guide from settings', async () => {
    render(<ShopSettingsPage />);
    const link = await screen.findByRole('link', { name: /Android app/i });
    expect(link.getAttribute('href')).toBe('/shop/app');
  });

  it('only changes an existing duplex rate after the shop chooses a unit and saves', async () => {
    render(<ShopSettingsPage />);
    const unit = await screen.findByLabelText('Billing unit for print rate 2') as HTMLSelectElement;
    expect(unit.value).toBe('page');
    expect(screen.getByText('Legacy sheet (charged per page)')).toBeTruthy();
    expect(saved).toEqual([]);

    fireEvent.change(unit, { target: { value: 'duplex_sheet' } });
    fireEvent.change(screen.getByLabelText('Price in rupees for print rate 2'), { target: { value: '3' } });
    const sides = screen.getByLabelText('Sides for print rate 2') as HTMLSelectElement;
    expect(sides.value).toBe('duplex');
    expect((sides.querySelector('option[value="single"]') as HTMLOptionElement).disabled).toBe(true);
    expect(saved).toEqual([]);

    fireEvent.click(screen.getByRole('button', { name: 'Save rates' }));
    await waitFor(() => expect(saved).toHaveLength(1));
    expect(saved[0]).toEqual([single, { ...duplex, unit: 'duplex_sheet', price_paise: 300 }, legacy]);
    expect(saved[0].every((row) => !('editorId' in row))).toBe(true);
  });

  it('edits a newly added duplicate row independently from the original', async () => {
    rows = [{ ...single }];
    render(<ShopSettingsPage />);
    await screen.findByLabelText('Sides for print rate 1');
    fireEvent.change(screen.getByLabelText('Add a rate'), { target: { value: 'print' } });
    const first = screen.getByLabelText('Sides for print rate 1') as HTMLSelectElement;
    const second = screen.getByLabelText('Sides for print rate 2') as HTMLSelectElement;
    fireEvent.change(second, { target: { value: 'duplex' } });
    expect(first.value).toBe('single');
    expect(second.value).toBe('duplex');
    fireEvent.change(screen.getByLabelText('Billing unit for print rate 2'), { target: { value: 'duplex_sheet' } });
    fireEvent.change(screen.getByLabelText('Price in rupees for print rate 2'), { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save rates' }));
    await waitFor(() => expect(saved).toHaveLength(1));
    expect(saved[0]).toEqual([single, { ...single, sides: 'duplex', unit: 'duplex_sheet', price_paise: 300 }]);
  });

  it('can add a separate duplex photocopy rate while preserving the wildcard legacy rate', async () => {
    rows = [{ ...legacy }];
    render(<ShopSettingsPage />);
    await screen.findByLabelText('Sides for photocopy rate 1');
    expect((screen.getByLabelText('Paper GSM for photocopy rate 1') as HTMLInputElement).value).toBe('');
    fireEvent.change(screen.getByLabelText('Add a rate'), { target: { value: 'photocopy_duplex' } });
    fireEvent.change(screen.getByLabelText('Billing unit for photocopy rate 2'), { target: { value: 'duplex_sheet' } });
    fireEvent.change(screen.getByLabelText('Price in rupees for photocopy rate 2'), { target: { value: '2.5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save rates' }));
    await waitFor(() => expect(saved).toHaveLength(1));
    expect(saved[0]).toEqual([legacy, { service: 'photocopy', paper_size: 'A4', color: 'bw', sides: 'duplex', paper_gsm: null, option: null, unit: 'duplex_sheet', price_paise: 250 }]);
  });
});
