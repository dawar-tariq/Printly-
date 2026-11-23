'use client';

import { renderDocumentPage, type LoadedDocument } from '@/lib/document-client';

// Raster previews keep this workflow usable on mobile without a PDF browser plug-in.
// Bound memory use; longer PDFs can be opened in the browser's native PDF viewer.
export const MAX_RASTER_PRINT_PAGES = 20;
const PAPER: Record<string, [number, number]> = { A4: [210, 297], A3: [297, 420], A5: [148, 210], Legal: [215.9, 355.6] };
export type PrintOrientation = 'portrait' | 'landscape';

export async function suggestedOrientation(doc: LoadedDocument): Promise<PrintOrientation> {
  if (doc.kind === 'image') return doc.image.width > doc.image.height ? 'landscape' : 'portrait';
  const page = await doc.pdf.getPage(1);
  const view = page.getViewport({ scale: 1 });
  return view.width > view.height ? 'landscape' : 'portrait';
}

export async function printDocument(doc: LoadedDocument, requestedPaper: string, orientation: PrintOrientation, sides: 'single' | 'duplex' = 'single') {
  if (doc.pageCount > MAX_RASTER_PRINT_PAGES) throw new Error(`For more than ${MAX_RASTER_PRINT_PAGES} pages, open the PDF in your browser's PDF viewer and use its Print command.`);
  const paper = Object.hasOwn(PAPER, requestedPaper) ? requestedPaper : 'A4';
  const [short, long] = PAPER[paper];
  const [width, height] = orientation === 'landscape' ? [long, short] : [short, long];
  const frame = document.createElement('iframe');
  frame.setAttribute('title', 'Print document');
  frame.setAttribute('aria-hidden', 'true');
  frame.style.cssText = 'position:fixed;width:1px;height:1px;left:-10000px;top:0;border:0;';
  document.body.appendChild(frame);
  const target = frame.contentDocument;
  const win = frame.contentWindow;
  if (!target || !win) { frame.remove(); throw new Error('Could not open the browser print dialog.'); }
  const urls: string[] = [];
  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    frame.remove();
    urls.forEach((url) => URL.revokeObjectURL(url));
  };
  try {
    target.open();
    target.write('<!doctype html><html><head><meta charset="utf-8"><title>Print document</title></head><body></body></html>');
    target.close();
    const style = target.createElement('style');
    // Values here are from a fixed allowlist, never from file contents or user input.
    style.textContent = `@page { size: ${paper} ${orientation}; margin: 8mm; } html,body { margin:0; padding:0; background:#fff; } .page { width:${width - 16}mm; height:${height - 16}mm; max-width:100%; display:flex; align-items:center; justify-content:center; break-after:page; page-break-after:always; overflow:hidden; } .page:last-child { break-after:auto; page-break-after:auto; } img,canvas { display:block; max-width:100%; max-height:100%; width:auto; height:auto; object-fit:contain; }`;
    target.head.appendChild(style);
    for (let page = 1; page <= doc.pageCount; page++) {
      const sheet = target.createElement('div');
      sheet.className = 'page';
      if (doc.kind === 'image') {
        const url = URL.createObjectURL(doc.blob);
        urls.push(url);
        const image = target.createElement('img');
        image.src = url;
        sheet.appendChild(image);
        target.body.appendChild(sheet);
        await image.decode();
      } else {
        // At most 144 dpi, preserving the edited page's crop and rotation.
        const canvas = await renderDocumentPage(doc, page, undefined, 1900, 2);
        sheet.appendChild(canvas);
        target.body.appendChild(sheet);
      }
    }
    if (sides === 'duplex' && doc.pageCount % 2 !== 0) {
      // Ensure the raster print document has a blank reverse after the odd
      // last page. The operator must still select duplex, one page per side,
      // and verify that the browser/printer actually honours the blank page.
      const blank = target.createElement('div');
      blank.className = 'page';
      blank.setAttribute('data-duplex-blank', 'true');
      target.body.appendChild(blank);
    }
    // A browser may return from print() before its dialog is closed. Keep the
    // frame and images around until afterprint (with a longer fallback timeout).
    win.addEventListener('afterprint', () => window.setTimeout(cleanup, 5000), { once: true });
    window.setTimeout(cleanup, 120_000);
    win.focus();
    win.print();
  } catch (err) {
    cleanup();
    throw err;
  }
}
