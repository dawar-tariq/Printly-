import 'server-only';
import PDFDocument from 'pdfkit';
import SVGtoPDF from 'svg-to-pdfkit';
import { renderAsync } from '@resvg/resvg-js';
import { standeeFonts } from './fonts';
import { A4_HEIGHT_MM, A4_WIDTH_MM } from './svg';

export const A4_WIDTH_PT = A4_WIDTH_MM / 25.4 * 72;
export const A4_HEIGHT_PT = A4_HEIGHT_MM / 25.4 * 72;
export const PNG_WIDTH = Math.round(A4_WIDTH_MM / 25.4 * 300);
export const PNG_HEIGHT = Math.round(A4_HEIGHT_MM / 25.4 * 300);

/** Add the PNG pHYs chunk so print applications know that the image is 300 dpi. */
function withResolution(png: Buffer, dpi: number): Buffer {
  const pixelsPerMetre = Math.round(dpi / 0.0254);
  const chunk = Buffer.alloc(21);
  chunk.writeUInt32BE(9, 0);
  chunk.write('pHYs', 4, 'ascii');
  chunk.writeUInt32BE(pixelsPerMetre, 8);
  chunk.writeUInt32BE(pixelsPerMetre, 12);
  chunk[16] = 1; // units are metres
  let crc = 0xffffffff;
  for (const byte of chunk.subarray(4, 17)) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  chunk.writeUInt32BE((crc ^ 0xffffffff) >>> 0, 17);

  // Insert after IHDR and discard an existing pHYs if the renderer adds one.
  const parts: Buffer[] = [png.subarray(0, 33), chunk];
  for (let offset = 33; offset < png.length;) {
    const length = png.readUInt32BE(offset);
    const end = offset + 12 + length;
    if (end > png.length) throw new Error('Invalid PNG produced by the renderer.');
    if (png.toString('ascii', offset + 4, offset + 8) !== 'pHYs') parts.push(png.subarray(offset, end));
    offset = end;
  }
  return Buffer.concat(parts);
}

/** Render the same A4 SVG to either a light preview or an exact 300-dpi PNG. */
export async function renderStandeePng(svg: string, highResolution = false): Promise<Buffer> {
  const width = highResolution ? PNG_WIDTH : 840;
  const height = highResolution ? PNG_HEIGHT : 1188;
  const rasterSvg = svg.replace('width="210mm" height="297mm"', `width="${width}px" height="${height}px"`);
  const image = await renderAsync(rasterSvg, {
    fitTo: { mode: 'original' },
    font: { fontFiles: standeeFonts().map((asset) => asset.path), loadSystemFonts: false, defaultFontFamily: 'Noto Sans' },
    background: '#ffffff',
  });
  if (image.width !== width || image.height !== height) throw new Error('Unexpected standee image dimensions.');
  const png = image.asPng();
  return highResolution ? withResolution(png, 300) : png;
}

/** Render vector artwork to a single exact-A4 PDF with bundled fonts embedded. */
export async function renderStandeePdf(svg: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: [A4_WIDTH_PT, A4_HEIGHT_PT], margin: 0, compress: true,
      info: { Title: 'Printly QR standee', Creator: 'Printly' },
    });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    try {
      for (const asset of standeeFonts()) {
        doc.registerFont(asset.weight === 'bold' ? `${asset.family}-Bold` : asset.family, asset.bytes);
      }
      SVGtoPDF(doc as unknown as Parameters<typeof SVGtoPDF>[0], svg, 0, 0, {
        width: A4_WIDTH_PT,
        height: A4_HEIGHT_PT,
        fontCallback: (family, bold) => `${family}${bold ? '-Bold' : ''}`,
        warningCallback: (warning) => { throw new Error(`Standee PDF rendering failed: ${warning}`); },
      });
      doc.end();
    } catch (error) {
      doc.destroy();
      reject(error);
    }
  });
}
