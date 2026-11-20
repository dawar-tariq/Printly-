// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/components/AccountPassword', () => ({ AccountPassword: () => null }));
import AdminSettingsPage from './page';

const defaults = { commission_bps: 800, gst_bps: 1800, rush_bps: 1000 };
let maintenance: boolean;
let writes: Array<Record<string, unknown>>;

beforeEach(() => {
  maintenance = false;
  writes = [];
  vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === 'PUT') {
      const body = JSON.parse(String(init.body));
      writes.push(body);
      if (typeof body.maintenance === 'boolean') maintenance = body.maintenance;
      return Response.json({ ok: true });
    }
    return Response.json({ settings: { ...defaults, maintenance } });
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('admin maintenance settings', () => {
  it('shows the saved state and applies both enable and disable only after saving', async () => {
    render(<AdminSettingsPage />);
    expect(await screen.findByText('Currently off')).toBeTruthy();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Enable maintenance mode' }));
    expect(screen.getByText('Save settings to apply this change.')).toBeTruthy();
    expect(maintenance).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));
    expect(await screen.findByText('Currently on')).toBeTruthy();
    expect(writes[0]).toEqual({ maintenance: true });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Enable maintenance mode' }));
    fireEvent.click(screen.getByRole('button', { name: /saved|save settings/i }));
    expect(await screen.findByText('Currently off')).toBeTruthy();
    expect(writes[1]).toEqual({ maintenance: false });
  });

  it('does not overwrite a maintenance change made by another admin when saving rates', async () => {
    render(<AdminSettingsPage />);
    await screen.findByText('Currently off');
    maintenance = true; // Changed after this page was loaded.
    fireEvent.change(screen.getByLabelText('GST (%)'), { target: { value: '20' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));
    expect(await screen.findByText('Currently on')).toBeTruthy();
    expect(writes[0]).not.toHaveProperty('maintenance');
    expect(writes[0].gst_bps).toBe(2000);
  });

  it('does not permit saving default values when settings could not be loaded', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('Unavailable', { status: 503 })));
    render(<AdminSettingsPage />);
    expect((await screen.findByRole('alert')).textContent).toContain('Could not load the current settings');
    expect(screen.queryByRole('button', { name: 'Save settings' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
  });

  it('reports a failed save without claiming maintenance was enabled', async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => init?.method === 'PUT'
      ? Response.json({ error: { message: 'Could not save settings. Please retry.' } }, { status: 503 })
      : Response.json({ settings: { ...defaults, maintenance: false } }));
    vi.stubGlobal('fetch', fetcher);
    render(<AdminSettingsPage />);
    await screen.findByText('Currently off');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Enable maintenance mode' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Could not save settings'));
    expect(screen.getByText('Currently off')).toBeTruthy();
  });
});
