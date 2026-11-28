import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import type { SupabaseClient } from '@supabase/supabase-js';
import { detectProofImage, proofSubmissionError, readPhotoProof, readProofSubmission, uploadPhotoProof } from './name-proof';

describe('private proof photo validation', () => {
  it('accepts supported signatures and rejects spoofed files', async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
    expect(detectProofImage(png)?.mime).toBe('image/png');
    expect(detectProofImage(new Uint8Array([0xff, 0xd8, 0xff]))?.mime).toBe('image/jpeg');
    expect(detectProofImage(new TextEncoder().encode('not an image'))).toBeNull();
    await expect(readPhotoProof(new File(['not an image'], 'shop.jpg', { type: 'image/jpeg' }))).rejects.toThrow('valid JPEG');
    await expect(readPhotoProof(new File([png], 'shop.png', { type: 'image/png' }))).resolves.toMatchObject({ mime: 'image/png' });
  });
  it('rejects oversized evidence before reading it', async () => {
    const file = new File([new Uint8Array(3 * 1024 * 1024 + 1)], 'shop.png', { type: 'image/png' });
    await expect(readPhotoProof(file)).rejects.toThrow('3 MB');
  });
  it('shows known validation messages but hides unexpected parser diagnostics', async () => {
    let validationError: unknown;
    try { await readPhotoProof(new File(['not an image'], 'shop.jpg', { type: 'image/jpeg' })); }
    catch (error) { validationError = error; }
    expect(proofSubmissionError(validationError)).toMatch(/valid JPEG/);
    expect(proofSubmissionError(new Error('sensitive parser diagnostic'))).toBe('Invalid form data.');
  });
  it('attempts to remove an unreferenced photo if its upload response is lost', async () => {
    const remove = vi.fn().mockResolvedValue({ error: null });
    const admin = { storage: { from: () => ({ upload: vi.fn().mockRejectedValue(new Error('network lost')), remove }) } } as unknown as SupabaseClient;
    await expect(uploadPhotoProof(admin, 'shop-id', { bytes: Buffer.from([1]), mime: 'image/png', extension: 'png' })).rejects.toThrow('Could not upload');
    expect(remove).toHaveBeenCalledOnce();
    expect(remove.mock.calls[0][0][0]).toMatch(/^shop-id\/.+\.png$/);
  });
  it('caps the complete multipart body even when no length is declared', async () => {
    const form = new FormData();
    form.append('payload', '{}');
    form.append('proof', new File([new Uint8Array(3 * 1024 * 1024 + 128 * 1024)], 'shop.png', { type: 'image/png' }));
    const req = new Request('https://printly.test/api/shop/signup', { method: 'POST', body: form });
    await expect(readProofSubmission(req)).rejects.toThrow('Request body is too large');
  });
});
