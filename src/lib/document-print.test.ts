// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LoadedDocument } from './document-client';

const mocks = vi.hoisted(() => ({ render: vi.fn() }));
vi.mock('@/lib/document-client', () => ({ renderDocumentPage: mocks.render }));
import { printDocument } from './document-print';

let print: ReturnType<typeof vi.fn>;
let frame: HTMLIFrameElement | undefined;
let append: { mockRestore: () => void };

beforeEach(() => {
  vi.useFakeTimers();
  mocks.render.mockReset().mockImplementation(async (_doc: LoadedDocument, page: number) => {
    const canvas = document.createElement('canvas');
    canvas.dataset.page = String(page);
    return canvas;
  });
  print = vi.fn();
  frame = undefined;
  const originalAppend = document.body.appendChild.bind(document.body);
  append = vi.spyOn(document.body, 'appendChild').mockImplementation((node) => {
    const result = originalAppend(node);
    if (node instanceof HTMLIFrameElement) {
      frame = node;
      Object.defineProperty(node.contentWindow!, 'focus', { value: vi.fn(), configurable: true });
      Object.defineProperty(node.contentWindow!, 'print', { value: print, configurable: true });
    }
    return result;
  });
});
afterEach(() => {
  vi.runAllTimers();
  append.mockRestore();
  vi.useRealTimers();
  document.body.innerHTML = '';
});

const pdf = (pages: number) => ({ kind: 'pdf', pageCount: pages } as LoadedDocument);

describe('raster print preparation', () => {
  it('keeps pages in order and appends a blank reverse for an odd duplex file', async () => {
    await printDocument(pdf(5), 'A4', 'portrait', 'duplex');
    const pages = Array.from(frame!.contentDocument!.querySelectorAll('.page'));
    expect(pages).toHaveLength(6);
    expect(pages.slice(0, 5).map((page) => page.querySelector('canvas')?.dataset.page)).toEqual(['1', '2', '3', '4', '5']);
    expect(pages[5].getAttribute('data-duplex-blank')).toBe('true');
    expect(pages[5].children).toHaveLength(0);
    expect(print).toHaveBeenCalledOnce();
  });

  it('does not append a blank page for an even duplex document or a single-sided one', async () => {
    await printDocument(pdf(4), 'A4', 'portrait', 'duplex');
    expect(frame!.contentDocument!.querySelectorAll('.page')).toHaveLength(4);
    expect(frame!.contentDocument!.querySelector('[data-duplex-blank]')).toBeNull();
    await printDocument(pdf(5), 'A4', 'portrait', 'single');
    expect(frame!.contentDocument!.querySelectorAll('.page')).toHaveLength(5);
    expect(frame!.contentDocument!.querySelector('[data-duplex-blank]')).toBeNull();
  });

  it('still directs longer PDFs to the native viewer', async () => {
    await expect(printDocument(pdf(21), 'A4', 'portrait', 'duplex')).rejects.toThrow(/PDF viewer/i);
    expect(frame).toBeUndefined();
    expect(print).not.toHaveBeenCalled();
  });
});
