export type CropMargins = { left: number; top: number; right: number; bottom: number };
export type PageEdit = { rotation: 0 | 90 | 180 | 270; margins: CropMargins };
export const EMPTY_EDIT: PageEdit = { rotation: 0, margins: { left: 0, top: 0, right: 0, bottom: 0 } };
export const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024;
export const MAX_DOCUMENT_PAGES = 2000;
export const MAX_IMAGE_PIXELS = 40_000_000;

export const isPdf = (mime: string) => mime === 'application/pdf';
export const isImage = (mime: string) => mime === 'image/jpeg' || mime === 'image/png';
export const isPreviewable = (mime: string) => isPdf(mime) || isImage(mime);
export const isWord = (mime: string) => mime === 'application/msword' || mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/** Some mobile file pickers omit the MIME type. Only fall back for known extensions. */
export function fileMime(name: string, mime: string) {
  if (isPreviewable(mime) || isWord(mime)) return mime;
  const ext = name.split('.').pop()?.toLowerCase();
  return ({ pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' } as Record<string, string>)[ext ?? ''] ?? mime;
}

export function hasPageEdit(edit: PageEdit) {
  return edit.rotation !== 0 || Object.values(edit.margins).some((value) => value !== 0);
}

export function clampMargin(margins: CropMargins, edge: keyof CropMargins, value: number): CropMargins {
  const opposite: Record<keyof CropMargins, keyof CropMargins> = { left: 'right', right: 'left', top: 'bottom', bottom: 'top' };
  // Leave at least 5% of the page visible in either dimension.
  return { ...margins, [edge]: Math.max(0, Math.min(95 - margins[opposite[edge]], Math.round(value) || 0)) };
}

/** Convert the visible, rotated PDF.js viewport selection to PDF user-space. */
export function cropBoxFromViewport(viewport: { width: number; height: number; convertToPdfPoint(x: number, y: number): number[] }, margins: CropMargins) {
  const a = viewport.convertToPdfPoint(viewport.width * margins.left / 100, viewport.height * margins.top / 100);
  const b = viewport.convertToPdfPoint(viewport.width * (100 - margins.right) / 100, viewport.height * (100 - margins.bottom) / 100);
  const x = Math.min(a[0], b[0]);
  const y = Math.min(a[1], b[1]);
  const width = Math.abs(b[0] - a[0]);
  const height = Math.abs(b[1] - a[1]);
  if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) throw new Error('The crop area is invalid.');
  return { x, y, width, height };
}
