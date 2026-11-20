import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { codeFromPublicId } from './shop-identity';

const PUBLIC_FIELDS = 'id, slug, short_code, name, address, city, phone, upi_id, kyc_status, status, eta_minutes, rating_avg, rating_count, gstin';

/** Code URLs are canonical; old name-based links continue to work as aliases. */
export async function findPublicShop(supabase: SupabaseClient, identifier: string) {
  const code = codeFromPublicId(identifier);
  if (code) {
    const result = await supabase.from('shops').select(PUBLIC_FIELDS).eq('short_code', code).maybeSingle();
    if (result.error || result.data) return result;
  }
  return supabase.from('shops').select(PUBLIC_FIELDS).eq('slug', identifier).maybeSingle();
}
