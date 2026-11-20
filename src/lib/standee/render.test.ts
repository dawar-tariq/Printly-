import { describe, expect, it } from 'vitest';
import { PNG } from 'pngjs';
import jsQR from 'jsqr';
import QRCode from 'qrcode';
import { PDFDocument } from 'pdf-lib';
import { createCanvas, DOMMatrix, ImageData, Path2D } from '@napi-rs/canvas';
import { standeeSvg, QR_BOX } from './svg';
import { A4_HEIGHT_PT, A4_WIDTH_PT, PNG_HEIGHT, PNG_WIDTH, renderStandeePdf, renderStandeePng } from './render';
import type { StandeeInfo } from './shared';

const shopA: StandeeInfo = { shop_name: 'Kashmir Print Hub', owner_name: 'Amaan Farooq', short_code: 'AB1234', order_url: 'https://printly.example/s/p-ab1234/order', status: 'active', kyc_status: 'approved' };
const shopB: StandeeInfo = { shop_name: 'Kashmir Print Hub', owner_name: 'दिव्या शर्मा', short_code: 'CD5678', order_url: 'https://printly.example/s/p-cd5678/order', status: 'active', kyc_status: 'approved' };

function decode(pixels: Uint8Array | Uint8ClampedArray, width: number, height: number, grayscale = false) {
  const rgba = new Uint8ClampedArray(pixels);
  if (grayscale) {
    for (let i = 0; i < rgba.length; i += 4) {
      const lightness = Math.round(rgba[i] * 0.299 + rgba[i + 1] * 0.587 + rgba[i + 2] * 0.114);
      rgba[i] = rgba[i + 1] = rgba[i + 2] = lightness;
    }
  }
  return jsQR(rgba, width, height)?.data;
}

function resolution(png: Buffer) {
  for (let offset = 8; offset < png.length;) {
    const length = png.readUInt32BE(offset);
    const type = png.toString('ascii', offset + 4, offset + 8);
    if (type === 'pHYs') return [png.readUInt32BE(offset + 8), png.readUInt32BE(offset + 12), png[offset + 16]];
    offset += length + 12;
  }
  return null;
}

async function rasterPdf(pdf: Buffer) {
  // PDF.js + a real canvas rasterize the generated PDF, not the original SVG.
  Object.assign(globalThis, { DOMMatrix, ImageData, Path2D });
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const document = await pdfjs.getDocument({ data: new Uint8Array(pdf), isEvalSupported: false }).promise;
  const page = await document.getPage(1);
  const viewport = page.getViewport({ scale: 2 }); // print-like 144 dpi
  const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
  const context = canvas.getContext('2d');
  await page.render({ canvasContext: context as unknown as CanvasRenderingContext2D, viewport }).promise;
  const image = context.getImageData(0, 0, canvas.width, canvas.height);
  await document.destroy();
  return image;
}

describe('A4 standee artwork and exports', () => {
  it('generates distinct, decodable QR previews for shops with identical names', async () => {
    for (const [info, theme] of [[shopA, 'orange'], [shopB, 'deep']] as const) {
      const svg = standeeSvg(info, theme);
      const png = PNG.sync.read(await renderStandeePng(svg));
      expect([png.width, png.height]).toEqual([840, 1188]);
      expect(decode(png.data, png.width, png.height)).toBe(info.order_url);
      expect(decode(png.data, png.width, png.height, true)).toBe(info.order_url);
      // Sample every module and the complete quiet zone: pure black on pure white,
      // with no logo, frame, or other artwork over the QR or its safety margin.
      const qr = QRCode.create(info.order_url, { errorCorrectionLevel: 'H' }).modules;
      const quiet = QR_BOX.quietModules;
      const unit = QR_BOX.size / (qr.size + 2 * quiet);
      let mismatches = 0;
      for (let row = -quiet; row < qr.size + quiet; row++) {
        for (let col = -quiet; col < qr.size + quiet; col++) {
          const x = Math.floor((QR_BOX.x + (col + quiet + 0.5) * unit) * 4);
          const y = Math.floor((QR_BOX.y + (row + quiet + 0.5) * unit) * 4);
          const expected = row >= 0 && col >= 0 && row < qr.size && col < qr.size && qr.get(row, col) ? 0 : 255;
          const index = (y * png.width + x) * 4;
          if (png.data[index] !== expected || png.data[index + 1] !== expected || png.data[index + 2] !== expected || png.data[index + 3] !== 255) mismatches++;
        }
      }
      expect(mismatches).toBe(0);
      expect(QR_BOX.quietModules).toBeGreaterThanOrEqual(4);
      expect(svg).toContain(`width="${QR_BOX.size}" height="${QR_BOX.size}" fill="#ffffff"`);
    }
  });

  it('exports an A4, 300-dpi PNG with a scannable grayscale QR', async () => {
    const pngBytes = await renderStandeePng(standeeSvg(shopA, 'orange'), true);
    const png = PNG.sync.read(pngBytes);
    expect([png.width, png.height]).toEqual([2480, 3508]);
    expect([png.width, png.height]).toEqual([PNG_WIDTH, PNG_HEIGHT]);
    expect(resolution(pngBytes)).toEqual([11811, 11811, 1]);
    expect(decode(png.data, png.width, png.height, true)).toBe(shopA.order_url);
  });

  it('exports a single exact-A4 vector PDF with embedded fonts and a decodable QR', async () => {
    for (const info of [shopA, shopB]) {
      const bytes = await renderStandeePdf(standeeSvg(info, 'orange'));
      const pdf = await PDFDocument.load(bytes);
      expect(pdf.getPageCount()).toBe(1);
      expect(pdf.getPage(0).getWidth()).toBeCloseTo(A4_WIDTH_PT, 3);
      expect(pdf.getPage(0).getHeight()).toBeCloseTo(A4_HEIGHT_PT, 3);
      expect(bytes.toString('latin1')).toContain('/FontFile2');
      const image = await rasterPdf(bytes);
      expect(decode(image.data, image.width, image.height)).toBe(info.order_url);
      expect(decode(image.data, image.width, image.height, true)).toBe(info.order_url);
    }
  }, 30_000);

  it('fits long names, shapes Arabic/Devanagari and rejects missing glyphs without injecting markup', async () => {
    const svg = standeeSvg({ ...shopA, shop_name: 'The Kashmir University International Fine Print and Copy Centre', owner_name: 'محمد علی खान' }, 'orange');
    expect(svg).not.toContain('محمد'); // dynamic names are correctly shaped glyph outlines
    expect((await renderStandeePng(svg)).length).toBeGreaterThan(1000);
    const hostile = standeeSvg({ ...shopA, shop_name: 'ABC <script> & Sons' }, 'orange');
    expect(hostile).not.toContain('<script>');
    expect(() => standeeSvg({ ...shopA, shop_name: 'Print 📷' }, 'orange')).toThrow(/cannot render/i);
    expect(() => standeeSvg({ ...shopA, shop_name: 'A'.repeat(161) }, 'orange')).toThrow(/too long to fit/i);
  });
});
