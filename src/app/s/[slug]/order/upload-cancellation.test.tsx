// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const state = vi.hoisted(() => ({
  transferMode: 'hold' as 'hold' | 'complete', presignMode: 'complete' as 'hold' | 'complete', finalizeMode: 'hold' as 'hold' | 'lost' | 'complete',
  transferResolve: null as null | (() => void), presignResolve: null as null | ((response: Response) => void),
  finalizeResolve: null as null | ((response: Response) => void),
  starts: 0, transfers: 0, aborts: 0, finalize: 0, presign: 0, deletes: [] as unknown[], failDelete: false,
}));
vi.mock('next/navigation', () => ({ useParams: () => ({ slug: 'demo' }), useRouter: () => ({ push: vi.fn() }) }));
vi.mock('next/link', () => ({ default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a href={href} {...props}>{children}</a> }));
vi.mock('@/lib/supabase-client', () => ({ createBrowserSupabase: () => ({}) }));
vi.mock('@/lib/resumable-upload', () => ({ createResumableTransfer: () => {
  state.transfers++;
  return {
    start: () => { state.starts++; return state.transferMode === 'hold' ? new Promise<void>((resolve) => { state.transferResolve = resolve; }) : Promise.resolve(); },
    // Model an abort racing with a successful response rather than assuming the
    // remote server necessarily stopped when the browser cancelled.
    abort: async () => { state.aborts++; },
  };
} }));
import OrderWizard from './page';

const order = '11111111-1111-4111-8111-111111111111';
const fileId = '33333333-3333-4333-8333-333333333333';
const path = `shop/${order}/${fileId}-document.pdf`;
const signed = () => Response.json({ file_id: fileId, path, token: 'signed' });
const verified = () => Response.json({ file_id: fileId, page_count: 2 });

beforeEach(() => {
  Object.assign(state, { transferMode: 'hold', presignMode: 'complete', finalizeMode: 'hold', transferResolve: null, presignResolve: null, finalizeResolve: null, starts: 0, transfers: 0, aborts: 0, finalize: 0, presign: 0, deletes: [], failDelete: false });
  localStorage.clear();
  vi.stubGlobal('fetch', vi.fn(async (input: string, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith('/api/shops/')) return Response.json({ shop: { name: 'Demo', status: 'active' }, accepting_orders: true, services: [{ service: 'print', enabled: true }] });
    if (url === '/api/orders') return Response.json({ order_id: order });
    if (url === `/api/orders/${order}/files`) {
      state.presign++;
      return state.presignMode === 'hold' ? new Promise<Response>((resolve) => { state.presignResolve = resolve; }) : signed();
    }
    if (url.endsWith('/finalize')) {
      state.finalize++;
      if (state.finalizeMode === 'hold') return new Promise<Response>((resolve) => { state.finalizeResolve = resolve; });
      if (state.finalizeMode === 'lost' && state.finalize === 1) throw new Error('response lost');
      return verified();
    }
    if (init?.method === 'DELETE') {
      state.deletes.push(JSON.parse(String(init.body)));
      if (state.failDelete && state.deletes.length === 1) return Response.json({ error: { message: 'Cleanup unavailable' } }, { status: 503 });
      return Response.json({ ok: true });
    }
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
  return view;
}

describe('upload cancellation and response races', () => {
  it('stops a late presign response from starting a transfer after leaving the wizard', async () => {
    state.presignMode = 'hold';
    const view = await addFile();
    await waitFor(() => expect(state.presignResolve).not.toBeNull());
    view.unmount();
    await act(async () => { state.presignResolve!(signed()); await new Promise((resolve) => setTimeout(resolve, 10)); });
    expect(state.transfers).toBe(0);
    expect(state.starts).toBe(0);
    expect(state.finalize).toBe(0);
  });

  it('does not finalize if an upload completes after cancellation', async () => {
    await addFile();
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel upload' }));
    await waitFor(() => expect(state.deletes).toEqual([{ path }]));
    await waitFor(() => expect(screen.queryByText('document.pdf')).toBeNull());
    expect(state.aborts).toBe(1);
    await act(async () => { state.transferResolve!(); await new Promise((resolve) => setTimeout(resolve, 0)); });
    expect(state.finalize).toBe(0);
    expect((screen.getByRole('button', { name: 'Continue' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('keeps checkout blocked and retries cleanup when cancellation races finalization', async () => {
    state.transferMode = 'complete'; state.failDelete = true;
    await addFile();
    await waitFor(() => expect(state.finalizeResolve).not.toBeNull());
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel upload' }));
    await screen.findByText('Removal was not completed. Please retry removal.');
    expect((screen.getByRole('button', { name: 'Continue' }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => { state.finalizeResolve!(verified()); await new Promise((resolve) => setTimeout(resolve, 0)); });
    expect(screen.queryByText(/2 pages · uploaded/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Retry removal' }));
    await waitFor(() => expect(state.deletes).toEqual([{ path }, { path }]));
    await waitFor(() => expect(screen.queryByText('document.pdf')).toBeNull());
  });

  it('retries a lost finalization response on the same file without another transfer', async () => {
    state.transferMode = 'complete'; state.finalizeMode = 'lost';
    await addFile();
    await screen.findByText(/2 pages · uploaded/);
    expect(state.presign).toBe(1);
    expect(state.transfers).toBe(1);
    expect(state.starts).toBe(1);
    expect(state.finalize).toBe(2);
    expect((screen.getByRole('button', { name: /Continue · 2 pages/ }) as HTMLButtonElement).disabled).toBe(false);
  });
});
