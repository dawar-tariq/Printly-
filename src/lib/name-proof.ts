import 'server-only';
import { randomUUID } from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { MAX_JSON_BODY_BYTES, RequestBodyTooLarge, readBodyBytes, readJsonBody } from '@/lib/request-body';

export const PROOF_BUCKET = 'shop-name-proofs';
export const MAX_PROOF_BYTES = 3 * 1024 * 1024;
export type PhotoProof = { bytes: Buffer; mime: 'image/jpeg' | 'image/png' | 'image/webp'; extension: 'jpg' | 'png' | 'webp' };

class ProofValidationError extends Error {}

/** Return only our own validation messages, never unexpected parser diagnostics. */
export function proofSubmissionError(error: unknown): string {
  return error instanceof ProofValidationError || error instanceof RequestBodyTooLarge ? error.message : 'Invalid form data.';
}

/** Check file signatures, not just the filename or the browser-provided MIME. */
export function detectProofImage(bytes: Uint8Array): Pick<PhotoProof, 'mime' | 'extension'> | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { mime: 'image/jpeg', extension: 'jpg' };
  if (bytes.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((b, i) => bytes[i] === b)) return { mime: 'image/png', extension: 'png' };
  if (bytes.length >= 12 && Buffer.from(bytes.subarray(0, 4)).toString('ascii') === 'RIFF' && Buffer.from(bytes.subarray(8, 12)).toString('ascii') === 'WEBP') return { mime: 'image/webp', extension: 'webp' };
  return null;
}

export async function readPhotoProof(entry: FormDataEntryValue | null): Promise<PhotoProof | null> {
  if (!entry) return null;
  if (typeof entry === 'string' || typeof entry.arrayBuffer !== 'function') throw new ProofValidationError('Select a JPEG, PNG or WebP shop photo.');
  if (entry.size === 0 || entry.size > MAX_PROOF_BYTES) throw new ProofValidationError('Shop photo must be smaller than 3 MB.');
  const bytes = Buffer.from(await entry.arrayBuffer());
  const type = detectProofImage(bytes);
  if (!type || entry.type !== type.mime) throw new ProofValidationError('Select a valid JPEG, PNG or WebP shop photo.');
  return { bytes, ...type };
}

export async function uploadPhotoProof(admin: SupabaseClient, shopId: string, photo: PhotoProof): Promise<string> {
  const path = `${shopId}/${randomUUID()}.${photo.extension}`;
  const { error } = await admin.storage.from(PROOF_BUCKET).upload(path, photo.bytes, { contentType: photo.mime, upsert: false });
  if (error) throw new Error('Could not upload your shop photo. Please try again.');
  return path;
}

export async function removePhotoProof(admin: SupabaseClient, path: string | null | undefined) {
  if (!path) return;
  const { error } = await admin.storage.from(PROOF_BUCKET).remove([path]);
  if (error) console.error('Unable to remove an unused name-proof photo:', error.message);
}

/** Supports existing JSON clients and multipart forms with an optional photo. */
export async function readProofSubmission(req: Request): Promise<{ payload: unknown; photo: PhotoProof | null }> {
  const contentType = req.headers.get('content-type') ?? '';
  if (contentType.toLowerCase().includes('multipart/form-data')) {
    // Do not let formData() buffer an unbounded body before checking the photo.
    const bytes = await readBodyBytes(req, MAX_PROOF_BYTES + MAX_JSON_BODY_BYTES);
    const form = await new Response(bytes as BodyInit, { headers: { 'content-type': contentType } }).formData();
    const value = form.get('payload');
    if (typeof value !== 'string' || new TextEncoder().encode(value).byteLength > MAX_JSON_BODY_BYTES) throw new ProofValidationError('Invalid form data.');
    let payload: unknown;
    try { payload = JSON.parse(value); } catch { throw new ProofValidationError('Invalid form data.'); }
    return { payload, photo: await readPhotoProof(form.get('proof')) };
  }
  return { payload: await readJsonBody(req), photo: null };
}
