import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { detectProofImage, readPhotoProof } from './name-proof';

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
});
