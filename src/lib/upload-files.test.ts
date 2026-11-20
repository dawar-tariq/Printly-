import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { createCanvas } from '@napi-rs/canvas';
import { inspectUploadedFile, MAX_FILE_BYTES } from './upload-files';

describe('uploaded file validation and counts', () => {
  it('counts the actual PDF pages and rejects unreadable or empty PDFs', async () => {
    const pdf = await PDFDocument.create(); pdf.addPage(); pdf.addPage(); pdf.addPage();
    const bytes = Buffer.from(await pdf.save());
    expect(await inspectUploadedFile(bytes, 'application/pdf')).toEqual({ size: bytes.length, pages: 3 });
    await expect(inspectUploadedFile(Buffer.from('%PDF-not-a-document'), 'application/pdf')).rejects.toThrow(/could not be read/i);
    await expect(inspectUploadedFile(Buffer.from('<html>not a pdf</html>'), 'application/pdf')).rejects.toThrow(/not a valid pdf/i);
    const empty = await PDFDocument.create();
    await expect(inspectUploadedFile(Buffer.from(await empty.save({ addDefaultPage: false })), 'application/pdf')).rejects.toThrow(/1–2000 pages/i);
  });
  it('counts images as one and never guesses a Word document page count', async () => {
    const canvas = createCanvas(20, 10);
    const png = canvas.toBuffer('image/png');
    const jpeg = canvas.toBuffer('image/jpeg');
    expect((await inspectUploadedFile(png, 'image/png')).pages).toBe(1);
    expect((await inspectUploadedFile(jpeg, 'image/jpeg')).pages).toBe(1);
    const huge = Buffer.from(png); huge.writeUInt32BE(10000, 16); huge.writeUInt32BE(10000, 20);
    await expect(inspectUploadedFile(huge, 'image/png')).rejects.toThrow(/40 megapixels/i);
    await expect(inspectUploadedFile(png, 'image/jpeg')).rejects.toThrow(/does not match/i);
    await expect(inspectUploadedFile(png.subarray(0, Math.floor(png.length / 2)), 'image/png')).rejects.toThrow(/could not be read/i);
    await expect(inspectUploadedFile(jpeg.subarray(0, jpeg.length - 3), 'image/jpeg')).rejects.toThrow(/could not be read/i);
    expect((await inspectUploadedFile(Buffer.from('504b0304010203', 'hex'), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')).pages).toBeNull();
    expect((await inspectUploadedFile(Buffer.from('d0cf11e0a1b11ae10102', 'hex'), 'application/msword')).pages).toBeNull();
    await expect(inspectUploadedFile(Buffer.from('not an image'), 'image/png')).rejects.toThrow(/valid JPEG or PNG/i);
    await expect(inspectUploadedFile(Buffer.alloc(0), 'image/png')).rejects.toThrow(/non-empty/i);
    await expect(inspectUploadedFile(Buffer.alloc(MAX_FILE_BYTES + 1), 'image/png')).rejects.toThrow(/25 MB/i);
    await expect(inspectUploadedFile(Buffer.from('hello'), 'text/html')).rejects.toThrow(/supported/i);
  });
});
