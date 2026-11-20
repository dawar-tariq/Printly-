import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
vi.mock('server-only', () => ({}));
import { findPublicShop } from './public-shop';

function client(shops: Array<{ id: string; slug: string; short_code: string }>) {
  return {
    from: () => ({ select: () => ({ eq: (field: 'slug' | 'short_code', value: string) => ({
      maybeSingle: async () => ({ data: shops.find((shop) => shop[field] === value) ?? null, error: null }),
    }) }) }),
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
});
