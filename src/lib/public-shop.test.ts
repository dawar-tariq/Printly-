import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
vi.mock('server-only', () => ({}));
import { findPublicShop } from './public-shop';

function client(shops: Array<{ id: string; slug: string; short_code: string }>, onSelect?: (fields: string) => void) {
  return {
    from: () => ({ select: (fields: string) => {
      onSelect?.(fields);
      return { eq: (field: 'slug' | 'short_code', value: string) => ({
        maybeSingle: async () => ({ data: shops.find((shop) => shop[field] === value) ?? null, error: null }),
      }) };
    } }),
  } as unknown as SupabaseClient;
}

describe('public shop lookup', () => {
  const shops = [
    { id: 'a', slug: 'bright-prints', short_code: 'AB234567' },
    { id: 'b', slug: 'bright-prints-2', short_code: 'CD234567' },
  ];
  it('keeps same-name shops on distinct code URLs', async () => {
    expect((await findPublicShop(client(shops), 'p-ab234567')).data?.id).toBe('a');
    expect((await findPublicShop(client(shops), 'p-cd234567')).data?.id).toBe('b');
  });
  it('keeps old name-based links working', async () => {
    expect((await findPublicShop(client(shops), 'bright-prints')).data?.id).toBe('a');
    expect((await findPublicShop(client(shops), 'bright-prints-2')).data?.id).toBe('b');
    expect((await findPublicShop(client(shops), 'not-a-shop')).data).toBeNull();
  });
  it('never requests private ownership, registration or commission fields for the public directory', async () => {
    const selected = vi.fn();
    await findPublicShop(client(shops, selected), 'p-ab234567');
    const fields = selected.mock.calls[0][0].split(',').map((field: string) => field.trim());
    expect(fields).toContain('short_code');
    for (const privateField of ['owner_id', 'gstin', 'kyc_status', 'commission_bps', 'rush_surcharge_bps', 'created_at', 'updated_at']) {
      expect(fields).not.toContain(privateField);
    }
  });
});
