import 'server-only';
import { randomUUID } from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';

export const PROOF_BUCKET = 'shop-name-proofs';
export const MAX_PROOF_BYTES = 3 * 1024 * 1024;
export type PhotoProof = { bytes: Buffer; mime: 'image/jpeg' | 'image/png' | 'image/webp'; extension: 'jpg' | 'png' | 'webp' };

/** Check file signatures, not just the filename or the browser-provided MIME. */
export function detectProofImage(bytes: Uint8Array): Pick<PhotoProof, 'mime' | 'extension'> | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { mime: 'image/jpeg', extension: 'jpg' };
  if (bytes.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((b, i) => bytes[i] === b)) return { mime: 'image/png', extension: 'png' };
  if (bytes.length >= 12 && Buffer.from(bytes.subarray(0, 4)).toString('ascii') === 'RIFF' && Buffer.from(bytes.subarray(8, 12)).toString('ascii') === 'WEBP') return { mime: 'image/webp', extension: 'webp' };
  return null;
}

export async function readPhotoProof(entry: FormDataEntryValue | null): Promise<PhotoProof | null> {
  if (!entry) return null;
  if (typeof entry === 'string' || typeof entry.arrayBuffer !== 'function') throw new Error('Select a JPEG, PNG or WebP shop photo.');
  if (entry.size === 0 || entry.size > MAX_PROOF_BYTES) throw new Error('Shop photo must be smaller than 3 MB.');
  const bytes = Buffer.from(await entry.arrayBuffer());
  const type = detectProofImage(bytes);
  if (!type || entry.type !== type.mime) throw new Error('Select a valid JPEG, PNG or WebP shop photo.');
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
  if ((req.headers.get('content-type') ?? '').toLowerCase().includes('multipart/form-data')) {
    const form = await req.formData();
    const value = form.get('payload');
    if (typeof value !== 'string') throw new Error('Invalid form data.');
    let payload: unknown;
    try { payload = JSON.parse(value); } catch { throw new Error('Invalid form data.'); }
    return { payload, photo: await readPhotoProof(form.get('proof')) };
  }
  return { payload: await req.json(), photo: null };
}
