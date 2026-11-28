import { describe, expect, it } from 'vitest';
import { PDFDocument, degrees, rgb } from 'pdf-lib';
import { createCanvas, DOMMatrix, ImageData, Path2D } from '@napi-rs/canvas';
import { applyDocumentEdits, type LoadedDocument } from './document-client';
import { clampMargin, cropBoxFromViewport, EMPTY_EDIT, fileMime, hasPageEdit, type PageEdit } from './document-shared';

Object.assign(globalThis, { DOMMatrix, ImageData, Path2D });

async function raster(pdf: import('pdfjs-dist').PDFDocumentProxy, pageNo: number, rotation?: number) {
  const page = await pdf.getPage(pageNo);
  const viewport = page.getViewport({ scale: 1, ...(rotation === undefined ? {} : { rotation }) });
  const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
  const context = canvas.getContext('2d');
  await page.render({ canvasContext: context as unknown as CanvasRenderingContext2D, viewport, background: 'white' }).promise;
  return { canvas, viewport };
}

describe('document edit geometry', () => {
  it('keeps a minimum visible region and recognizes known mobile file types', () => {
    expect(clampMargin({ left: 0, right: 40, top: 0, bottom: 0 }, 'left', 90).left).toBe(55);
    expect(clampMargin({ left: 0, right: 0, top: 0, bottom: 0 }, 'top', -4).top).toBe(0);
    expect(hasPageEdit(EMPTY_EDIT)).toBe(false);
    expect(fileMime('report.DOCX', '')).toContain('wordprocessingml');
    expect(fileMime('photo.jpg', 'application/octet-stream')).toBe('image/jpeg');
  });

  it('saves the exact visible crop on rotated, offset PDF pages without changing other pages', async () => {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const source = await PDFDocument.create();
    for (const rotation of [0, 90, 180, 270]) {
      const page = source.addPage([200, 300]);
      page.drawRectangle({ x: 0, y: 0, width: 200, height: 300, color: rgb(1, 1, 1) });
      page.drawRectangle({ x: 0, y: 0, width: 100, height: 150, color: rgb(1, 0, 0) });
      page.drawRectangle({ x: 100, y: 0, width: 100, height: 150, color: rgb(0, 1, 0) });
      page.drawRectangle({ x: 0, y: 150, width: 100, height: 150, color: rgb(0, 0, 1) });
      page.drawRectangle({ x: 100, y: 150, width: 100, height: 150, color: rgb(1, 1, 0) });
      page.setCropBox(10, 20, 180, 260);
      page.setRotation(degrees(rotation));
    }
    source.addPage([100, 120]);
    const bytes = await source.save();
    const original = await pdfjs.getDocument({ data: new Uint8Array(bytes), isEvalSupported: false }).promise;
    const doc: LoadedDocument = { kind: 'pdf', pdf: original, blob: new Blob([new Uint8Array(bytes)], { type: 'application/pdf' }), pageCount: 5, destroy: () => {} };
    const edits: Record<number, PageEdit> = {};
    for (let page = 1; page <= 4; page++) edits[page] = { rotation: 90, margins: { left: 10, right: 20, top: 15, bottom: 5 } };
    const result = await applyDocumentEdits(doc, edits, 'application/pdf');
    const savedBytes = new Uint8Array(await result.arrayBuffer());
    const saved = await PDFDocument.load(savedBytes);
    expect(saved.getPageCount()).toBe(5);
    expect(saved.getPage(4).getSize()).toEqual({ width: 100, height: 120 });
    const rendered = await pdfjs.getDocument({ data: savedBytes.slice(), isEvalSupported: false }).promise;
    for (let pageNumber = 1; pageNumber <= 4; pageNumber++) {
      const before = await original.getPage(pageNumber);
      const rotation = (before.rotate + 90) % 360;
      const sourceView = before.getViewport({ scale: 1, rotation });
      const expectedBox = cropBoxFromViewport(sourceView, edits[pageNumber].margins);
      const actualBox = saved.getPage(pageNumber - 1).getCropBox();
      for (const key of ['x', 'y', 'width', 'height'] as const) expect(actualBox[key]).toBeCloseTo(expectedBox[key], 4);
      expect(saved.getPage(pageNumber - 1).getRotation().angle).toBe(rotation);
      const orig = await raster(original, pageNumber, rotation);
      const out = await raster(rendered, pageNumber);
      expect(out.viewport.width).toBeCloseTo(sourceView.width * 0.7, 2);
      expect(out.viewport.height).toBeCloseTo(sourceView.height * 0.8, 2);
      // Compare interior pixels in all quadrants of the selected area, not just metadata.
      for (const [x, y] of [[0.2, 0.2], [0.8, 0.2], [0.2, 0.8], [0.8, 0.8]]) {
        const ox = Math.floor(orig.viewport.width * (0.1 + 0.7 * x));
        const oy = Math.floor(orig.viewport.height * (0.15 + 0.8 * y));
        const nx = Math.floor(out.viewport.width * x);
        const ny = Math.floor(out.viewport.height * y);
        const a = orig.canvas.getContext('2d').getImageData(ox, oy, 1, 1).data;
        const b = out.canvas.getContext('2d').getImageData(nx, ny, 1, 1).data;
        expect(Array.from(b)).toEqual(Array.from(a));
      }
    }
    await original.destroy(); await rendered.destroy();
  });
});
