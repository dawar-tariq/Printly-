// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { OwnerAppUpdatePrompt } from './OwnerAppUpdatePrompt';

const release = { available: true, versionCode: 2, versionName: '1.1', downloadUrl: 'https://github.com/dawar-tariq/Printly-/releases/download/v1/app.apk', sha256: 'a'.repeat(64), notes: 'Native improvements' };
beforeEach(() => { localStorage.clear(); vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => release })); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('Android update prompt', () => {
  it('only prompts a known older installed version and can be dismissed', async () => {
    localStorage.setItem('printly-owner-android-version', '1');
    render(<OwnerAppUpdatePrompt />);
    expect(await screen.findByRole('dialog')).toBeTruthy();
    expect((screen.getByRole('link', { name: /download update/i }) as HTMLAnchorElement).href).toBe(release.downloadUrl);
    fireEvent.click(screen.getByRole('button', { name: /remind me later/i }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(localStorage.getItem('printly-owner-update-dismissed')).toMatch(/^2:\d+$/);
  });
  it('keeps keyboard focus in the dialog and restores it when dismissed', async () => {
    localStorage.setItem('printly-owner-android-version', '1');
    render(<><button type="button">Underlying control</button><OwnerAppUpdatePrompt /></>);
    const underlying = screen.getByRole('button', { name: 'Underlying control' });
    underlying.focus();
    expect(await screen.findByRole('dialog')).toBeTruthy();
    const close = screen.getByRole('button', { name: /close update prompt/i });
    const later = screen.getByRole('button', { name: /remind me later/i });
    await waitFor(() => expect(document.activeElement).toBe(close));
    fireEvent.keyDown(window, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(later);
    fireEvent.keyDown(window, { key: 'Tab' });
    expect(document.activeElement).toBe(close);
    underlying.focus(); // A script or assistive technology may move focus outside.
    fireEvent.keyDown(window, { key: 'Tab' });
    expect(document.activeElement).toBe(close);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(underlying));
  });
  it('does not prompt a normal browser or the latest app version', async () => {
    const first = render(<OwnerAppUpdatePrompt />);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
    first.unmount(); localStorage.setItem('printly-owner-android-version', '2');
    render(<OwnerAppUpdatePrompt />);
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
