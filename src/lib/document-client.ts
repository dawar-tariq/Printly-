'use client';

import type { PDFDocumentProxy } from 'pdfjs-dist';
import { degrees, PDFDocument } from 'pdf-lib';
import { cropBoxFromViewport, EMPTY_EDIT, hasPageEdit, isImage, isPdf, MAX_DOCUMENT_BYTES, MAX_IMAGE_PIXELS, type PageEdit } from '@/lib/document-shared';

export type LoadedDocument =
  | { kind: 'pdf'; pdf: PDFDocumentProxy; blob: Blob; pageCount: number; destroy: () => void }
  | { kind: 'image'; image: ImageBitmap | HTMLImageElement; blob: Blob; pageCount: 1; destroy: () => void };

export async function loadDocument(url: string, mime: string, signal?: AbortSignal): Promise<LoadedDocument> {
  const response = await fetch(url, { cache: 'no-store', signal, referrerPolicy: 'no-referrer' });
  if (!response.ok) {
    const result = await response.json().catch(() => null);
    throw new Error(result?.error?.message ?? 'Could not load the file. Please try again.');
  }
  const blob = await response.blob();
  if (!blob.size || blob.size > MAX_DOCUMENT_BYTES) throw new Error('The file is empty or larger than 25 MB.');
  if (isPdf(mime)) {
    const pdfjs = await import('pdfjs-dist');
    pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
    const task = pdfjs.getDocument({
      data: new Uint8Array(await blob.arrayBuffer()),
      isEvalSupported: false, useSystemFonts: true,
      cMapUrl: '/pdfjs/cmaps/', cMapPacked: true, standardFontDataUrl: '/pdfjs/standard_fonts/',
    });
    const pdf = await task.promise;
    return { kind: 'pdf', pdf, blob, pageCount: pdf.numPages, destroy: () => { void pdf.destroy(); } };
  }
  if (isImage(mime)) {
    let image: ImageBitmap | HTMLImageElement;
    let objectUrl: string | null = null;
    if (typeof createImageBitmap === 'function') {
      image = await createImageBitmap(blob, { imageOrientation: 'from-image' });
    } else {
      objectUrl = URL.createObjectURL(blob);
      const element = new Image();
      element.src = objectUrl;
      try { await element.decode(); } catch { URL.revokeObjectURL(objectUrl); throw new Error('The image could not be read.'); }
      image = element;
    }
    if (!image.width || !image.height || image.width * image.height > MAX_IMAGE_PIXELS) {
      if ('close' in image) image.close();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      throw new Error('The image is too large to edit on this device (maximum 40 megapixels).');
    }
    return { kind: 'image', image, blob, pageCount: 1, destroy: () => { if ('close' in image) image.close(); if (objectUrl) URL.revokeObjectURL(objectUrl); } };
  }
  throw new Error('Preview is available for PDF, JPEG and PNG files.');
}

function imageSize(image: ImageBitmap | HTMLImageElement) {
  return { width: image.width, height: image.height };
}

/** Draw an image in its clockwise orientation; the canvas may already be scaled/translated. */
function drawRotatedImage(context: CanvasRenderingContext2D, image: ImageBitmap | HTMLImageElement, rotation: PageEdit['rotation']) {
  const { width, height } = imageSize(image);
  context.save();
  if (rotation === 90) { context.translate(height, 0); context.rotate(Math.PI / 2); }
  if (rotation === 180) { context.translate(width, height); context.rotate(Math.PI); }
  if (rotation === 270) { context.translate(0, width); context.rotate(-Math.PI / 2); }
  context.drawImage(image, 0, 0);
  context.restore();
}

export async function renderDocumentPage(doc: LoadedDocument, pageNumber: number, edit: PageEdit = EMPTY_EDIT, maxSide = 1400, maxScale = 2) {
  const canvas = document.createElement('canvas');
  if (doc.kind === 'pdf') {
    const page = await doc.pdf.getPage(pageNumber);
    const rotation = (page.rotate + edit.rotation) % 360;
    const base = page.getViewport({ scale: 1, rotation });
    const scale = Math.min(maxScale, maxSide / Math.max(base.width, base.height));
    const viewport = page.getViewport({ scale, rotation });
    canvas.width = Math.max(1, Math.ceil(viewport.width));
    canvas.height = Math.max(1, Math.ceil(viewport.height));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('This device could not display the file.');
    context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: context, viewport, background: 'white' }).promise;
    return canvas;
  }
  const { width, height } = imageSize(doc.image);
  const rotatedWidth = edit.rotation % 180 ? height : width;
  const rotatedHeight = edit.rotation % 180 ? width : height;
  const scale = Math.min(1, maxSide / Math.max(rotatedWidth, rotatedHeight));
  canvas.width = Math.max(1, Math.round(rotatedWidth * scale));
  canvas.height = Math.max(1, Math.round(rotatedHeight * scale));
  const context = canvas.getContext('2d');
  if (!context) throw new Error('This device could not display the file.');
  context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height);
  context.scale(canvas.width / rotatedWidth, canvas.height / rotatedHeight);
  drawRotatedImage(context, doc.image, edit.rotation);
  return canvas;
}

function canvasBlob(canvas: HTMLCanvasElement, mime: string) {
  return new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('Could not save the image.')), mime, 0.96));
}

/** Save cropped PDFs as vector PDF pages; only edited image files are re-encoded. */
export async function applyDocumentEdits(doc: LoadedDocument, edits: Record<number, PageEdit>, mime: string) {
  if (doc.kind === 'pdf') {
    const pdf = await PDFDocument.load(await doc.blob.arrayBuffer());
    for (const [rawNumber, edit] of Object.entries(edits)) {
      if (!hasPageEdit(edit)) continue;
      const pageNumber = Number(rawNumber);
      if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > pdf.getPageCount()) throw new Error('Invalid page number.');
      const renderedPage = await doc.pdf.getPage(pageNumber);
      const viewport = renderedPage.getViewport({ scale: 1, rotation: (renderedPage.rotate + edit.rotation) % 360 });
      const page = pdf.getPage(pageNumber - 1);
      if (Object.values(edit.margins).some((value) => value !== 0)) {
        const crop = cropBoxFromViewport(viewport, edit.margins);
        page.setCropBox(crop.x, crop.y, crop.width, crop.height);
      }
      if (edit.rotation) page.setRotation(degrees((page.getRotation().angle + edit.rotation + 360) % 360));
    }
    const bytes = await pdf.save();
    if (bytes.byteLength > MAX_DOCUMENT_BYTES) throw new Error('Edited file exceeds 25 MB. Try a smaller original file.');
    return new Blob([new Uint8Array(bytes)], { type: 'application/pdf' });
  }
  const edit = edits[1] ?? EMPTY_EDIT;
  const { width, height } = imageSize(doc.image);
  const rotatedWidth = edit.rotation % 180 ? height : width;
  const rotatedHeight = edit.rotation % 180 ? width : height;
  const left = Math.round(rotatedWidth * edit.margins.left / 100);
  const top = Math.round(rotatedHeight * edit.margins.top / 100);
  const right = Math.round(rotatedWidth * edit.margins.right / 100);
  const bottom = Math.round(rotatedHeight * edit.margins.bottom / 100);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, rotatedWidth - left - right);
  canvas.height = Math.max(1, rotatedHeight - top - bottom);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('This device could not edit the image.');
  if (mime === 'image/jpeg') { context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height); }
  context.translate(-left, -top);
  drawRotatedImage(context, doc.image, edit.rotation);
  const output = await canvasBlob(canvas, mime);
  canvas.width = 1; canvas.height = 1;
  if (output.size > MAX_DOCUMENT_BYTES) throw new Error('Edited file exceeds 25 MB. Try a smaller original file.');
  return output;
}
