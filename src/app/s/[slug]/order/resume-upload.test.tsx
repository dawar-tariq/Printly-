// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const state = vi.hoisted(() => ({ starts: 0, aborts: 0, transfers: 0, finalize: 0, presign: 0, deletes: [] as unknown[], terminal: false }));
vi.mock('next/navigation', () => ({ useParams: () => ({ slug: 'demo' }), useRouter: () => ({ push: vi.fn() }) }));
vi.mock('next/link', () => ({ default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a href={href} {...props}>{children}</a> }));
vi.mock('@/lib/supabase-client', () => ({ createBrowserSupabase: () => ({}) }));
vi.mock('@/lib/resumable-upload', () => ({ createResumableTransfer: ({ onProgress }: { onProgress: (sent: number, total: number) => void }) => {
  state.transfers++;
  return {
    start: async () => { state.starts++; if (state.starts === 1) { onProgress(5, 10); throw new Error('Upload interrupted'); } onProgress(10, 10); },
    abort: async () => { state.aborts++; },
  };
} }));
import OrderWizard from './page';

const order = '11111111-1111-4111-8111-111111111111';
const fileId = '33333333-3333-4333-8333-333333333333';
const path = `shop/${order}/${fileId}-document.pdf`;
beforeEach(() => {
  state.starts = 0; state.aborts = 0; state.transfers = 0; state.finalize = 0; state.presign = 0; state.deletes = []; state.terminal = false;
  localStorage.clear();
  vi.stubGlobal('fetch', vi.fn(async (input: string, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith('/api/shops/')) return Response.json({ shop: { name: 'Demo', status: 'active' }, accepting_orders: true, services: [{ service: 'print', enabled: true }] });
    if (url === '/api/orders') return Response.json({ order_id: order });
    if (url === `/api/orders/${order}/files`) { state.presign++; return Response.json({ file_id: fileId, path, token: 'signed' }); }
    if (url.endsWith('/finalize')) {
      state.finalize++;
      if (state.terminal) return Response.json({ error: { message: 'Invalid file' } }, { status: 422 });
      if (state.finalize === 1) return Response.json({ error: { message: 'Verification temporarily unavailable' } }, { status: 503 });
      return Response.json({ file_id: fileId, page_count: 2 });
    }
    if (init?.method === 'DELETE') { state.deletes.push(JSON.parse(String(init.body))); return Response.json({ ok: true }); }
    throw new Error(`Unexpected request ${url}`);
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); localStorage.clear(); });

async function addFile() {
  const view = render(<OrderWizard />);
  fireEvent.click(await screen.findByRole('button', { name: /print pdf/i }));
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
  await screen.findByText('Add your files');
  const input = view.container.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [new File(['pdf'], 'document.pdf', { type: 'application/pdf' })] } });
}

describe('upload resume and verification recovery', () => {
  it('resumes the same transfer and retries finalization without uploading again or enabling checkout early', async () => {
    await addFile();
    const resume = await screen.findByRole('button', { name: 'Resume upload' });
    expect(screen.getByText('Upload interrupted')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Continue' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(resume);
    expect(await screen.findByText('Verification temporarily unavailable')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Continue' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Retry file check' }));
    expect(await screen.findByText(/2 pages · uploaded/)).toBeTruthy();
    expect(state.presign).toBe(1);
    expect(state.transfers).toBe(1);
    expect(state.starts).toBe(2);
    expect(state.finalize).toBe(2);
    expect((screen.getByRole('button', { name: /Continue · 2 pages/ }) as HTMLButtonElement).disabled).toBe(false);
  });
  it('retains the rejected path until removal is tombstoned and cleaned', async () => {
    state.terminal = true;
    await addFile();
    fireEvent.click(await screen.findByRole('button', { name: 'Resume upload' }));
    await screen.findByText('Invalid file');
    expect(screen.queryByRole('button', { name: 'Resume upload' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(state.deletes).toEqual([{ path }]));
    expect(state.aborts).toBe(1);
    expect(screen.queryByText('document.pdf')).toBeNull();
  });
});
