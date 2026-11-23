// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const mocks = vi.hoisted(() => ({ doc: null as null | Record<string, unknown>, print: vi.fn() }));
vi.mock('@/components/DocumentCanvas', () => ({
  useLoadedDocument: () => ({ doc: mocks.doc, loading: false, error: null }),
  DocumentCanvas: () => <div>Document preview</div>,
}));
vi.mock('@/lib/document-print', () => ({
  MAX_RASTER_PRINT_PAGES: 20,
  printDocument: mocks.print,
  suggestedOrientation: async () => 'portrait',
}));
import { PrintFileDialog, type FilePrintSpec } from './PrintFileDialog';

const spec: FilePrintSpec = { id: 'item', file_id: 'file', service: 'print', paper_size: 'A4', color: 'bw', sides: 'duplex', paper_gsm: 80, option: null, copies: 2, pages: 5 };
const OriginalURL = globalThis.URL;
beforeEach(() => {
  mocks.doc = { kind: 'pdf', pageCount: 5, blob: new Blob(['pdf'], { type: 'application/pdf' }) };
  mocks.print.mockReset().mockResolvedValue(undefined);
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value: function (this: HTMLDialogElement) { this.open = true; } });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value: function (this: HTMLDialogElement) { this.open = false; } });
  vi.stubGlobal('URL', Object.assign(class extends OriginalURL {}, { createObjectURL: vi.fn(() => 'blob:test'), revokeObjectURL: vi.fn() }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('shop print dialog duplex instructions', () => {
  it('shows sheet counts, manual printer steps and passes duplex to print preparation', async () => {
    const checked = vi.fn();
    const close = vi.fn();
    render(<PrintFileDialog url="/file" mime="application/pdf" name="file.pdf" specs={[spec]} onClose={close} onChecked={checked} />);
    expect(screen.getByText(/3 sheet\(s\) per copy, 6 total/i)).toBeTruthy();
    expect(screen.getByText(/pages 1\/2, 3\/4/i)).toBeTruthy();
    expect(screen.getByText(/select two-sided printing and one page per side/i)).toBeTruthy();
    expect(screen.getByText(/blank final page/i)).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Open print dialog' }) as HTMLButtonElement).disabled).toBe(true);
    screen.getAllByRole('checkbox').forEach((checkbox) => fireEvent.click(checkbox));
    fireEvent.click(screen.getByRole('button', { name: 'Open print dialog' }));
    await waitFor(() => expect(mocks.print).toHaveBeenCalledWith(mocks.doc, 'A4', 'portrait', 'duplex'));
    expect(checked).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole('button', { name: /I checked the physical print/i }));
    expect(checked).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
  });

  it('warns the operator if the preview count differs from the priced count', () => {
    mocks.doc = { ...mocks.doc, pageCount: 4 };
    render(<PrintFileDialog url="/file" mime="application/pdf" name="file.pdf" specs={[spec]} onClose={vi.fn()} onChecked={vi.fn()} />);
    expect(screen.getByRole('alert').textContent).toMatch(/preview has 4 pages.*priced for 5/i);
  });

  it('does not apply duplex preparation to single-sided orders', async () => {
    render(<PrintFileDialog url="/file" mime="application/pdf" name="file.pdf" specs={[{ ...spec, sides: 'single' }]} onClose={vi.fn()} onChecked={vi.fn()} />);
    expect(screen.queryByText(/sheet\(s\) per copy/i)).toBeNull();
    screen.getAllByRole('checkbox').forEach((checkbox) => fireEvent.click(checkbox));
    fireEvent.click(screen.getByRole('button', { name: 'Open print dialog' }));
    await waitFor(() => expect(mocks.print).toHaveBeenCalledWith(mocks.doc, 'A4', 'portrait', 'single'));
  });
});
