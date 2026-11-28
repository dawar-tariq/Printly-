// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { OwnerAppDownload } from './OwnerAppDownload';

const release = {
  available: true, versionCode: 4, versionName: '2.0.1',
  downloadUrl: 'https://github.com/dawar-tariq/Printly-/releases/download/v2.0.1/printly-owner.apk',
  sha256: 'a'.repeat(64), notes: 'Reliability improvements.',
};
beforeEach(() => vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://printly-steel-three.vercel.app'));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe('owner Android download', () => {
  it('shows no download link while the release is unpublished', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ available: false })));
    render(<OwnerAppDownload />);
    expect(await screen.findByText(/not available for download yet/i)).toBeTruthy();
    expect(screen.queryByRole('link', { name: /download android/i })).toBeNull();
  });
  it('shows the configured APK, checksum and installation instructions', async () => {
    const fetchMock = vi.fn(async () => Response.json(release));
    vi.stubGlobal('fetch', fetchMock);
    render(<OwnerAppDownload />);
    const link = await screen.findByRole('link', { name: /download android apk · 2\.0\.1/i });
    expect(link.getAttribute('href')).toBe(release.downloadUrl);
    expect(link.getAttribute('referrerpolicy')).toBe('no-referrer');
    expect(screen.getByText(`File SHA-256: ${release.sha256}`)).toBeTruthy();
    expect(screen.getByText(/not a Google Play installation/i)).toBeTruthy();
    expect(screen.getByText(/turn that permission off afterwards/i)).toBeTruthy();
    expect(screen.getByText('Reliability improvements.')).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith('/api/shop/app-release', expect.objectContaining({ cache: 'no-store' }));
  });
  it('rejects a malformed or untrusted response and allows retry', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({ ...release, downloadUrl: 'https://evil.example/app.apk' }))
      .mockResolvedValueOnce(Response.json(release));
    vi.stubGlobal('fetch', fetchMock);
    render(<OwnerAppDownload />);
    expect(await screen.findByText(/could not check the android app/i)).toBeTruthy();
    expect(screen.queryByRole('link', { name: /download android/i })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(await screen.findByRole('link', { name: /download android apk/i })).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
