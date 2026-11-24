import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { codeFromPublicId } from './shop-identity';

// Only public directory/checkout details belong in this response. In
// particular, GSTIN, ownership and review details stay private.
const PUBLIC_FIELDS = 'id, slug, short_code, name, address, city, phone, upi_id, status, is_open, eta_minutes, rating_avg, rating_count';

/** Code URLs are canonical; old name-based links continue to work as aliases. */
export async function findPublicShop(supabase: SupabaseClient, identifier: string) {
  const code = codeFromPublicId(identifier);
  if (code) {
    const result = await supabase.from('shops').select(PUBLIC_FIELDS).eq('short_code', code).maybeSingle();
    if (result.error || result.data) return result;
  }
  return supabase.from('shops').select(PUBLIC_FIELDS).eq('slug', identifier).maybeSingle();
}
