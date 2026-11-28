import 'server-only';
import { PDFDocument } from 'pdf-lib';
import sharp from 'sharp';
import { MAX_IMAGE_PIXELS } from '@/lib/document-shared';

export const MAX_FILE_BYTES = 25 * 1024 * 1024;
export const MAX_ORDER_FILES = 10;
export const MAX_FILE_PAGES = 2000;
export const PDF_MIME = 'application/pdf';
export const IMAGE_MIMES = new Set(['image/jpeg', 'image/png']);
export const WORD_MIMES = new Set(['application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document']);
export const ALLOWED_FILE_MIMES = new Set([PDF_MIME, ...IMAGE_MIMES, ...WORD_MIMES]);

export class FileValidationError extends Error {}

/** Do not trust a claimed size or page count from the browser. Word page counts
 * depend on Word's layout/fonts and are deliberately entered by the customer. */
export async function inspectUploadedFile(bytes: Buffer, mime: string): Promise<{ size: number; pages: number | null }> {
  if (!ALLOWED_FILE_MIMES.has(mime)) throw new FileValidationError('Only PDF, Word, JPEG and PNG files are supported.');
  if (bytes.length === 0 || bytes.length > MAX_FILE_BYTES) throw new FileValidationError('File must be non-empty and no larger than 25 MB.');
  const begins = (hex: string) => bytes.subarray(0, hex.length / 2).equals(Buffer.from(hex, 'hex'));
  if (mime === PDF_MIME) {
    if (bytes.subarray(0, 1024).indexOf('%PDF-') < 0) throw new FileValidationError('This file is not a valid PDF.');
    let pages: number;
    try { pages = (await PDFDocument.load(bytes)).getPageCount(); }
    catch { throw new FileValidationError('PDF could not be read. Remove its password or repair it and upload it again.'); }
    if (pages < 1 || pages > MAX_FILE_PAGES) throw new FileValidationError(`PDF must have 1–${MAX_FILE_PAGES} pages.`);
    return { size: bytes.length, pages };
  }
  if (IMAGE_MIMES.has(mime)) {
    let metadata: { width?: number; height?: number; format?: string };
    // Reading only dimensions is cheap and does not allocate a decoded image.
    try { metadata = await sharp(bytes, { failOn: 'warning', limitInputPixels: false }).metadata(); }
    catch { throw new FileValidationError('The image could not be read. Please upload a valid JPEG or PNG.'); }
    if ((mime === 'image/png' && metadata.format !== 'png') || (mime === 'image/jpeg' && metadata.format !== 'jpeg') || !metadata.width || !metadata.height) throw new FileValidationError('The image type does not match the file contents.');
    if (metadata.width * metadata.height > MAX_IMAGE_PIXELS) throw new FileValidationError('The image is too large to preview (maximum 40 megapixels).');
    // Headers alone can look valid on truncated/corrupt images. Force a full
    // decode with libvips, bounded by the same pixel limit as the browser.
    try { await sharp(bytes, { failOn: 'warning', limitInputPixels: MAX_IMAGE_PIXELS }).stats(); }
    catch { throw new FileValidationError('The image could not be read. Please upload a valid JPEG or PNG.'); }
  }
  if (mime === 'application/msword' && !begins('d0cf11e0a1b11ae1')) throw new FileValidationError('This file is not a valid Word document.');
  if (mime.endsWith('wordprocessingml.document') && !begins('504b0304')) throw new FileValidationError('This file is not a valid Word document.');
  return { size: bytes.length, pages: IMAGE_MIMES.has(mime) ? 1 : null };
}
