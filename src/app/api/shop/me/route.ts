import { getStaffContext, jsonOk, jsonError } from '@/lib/api';
import { createAdminSupabase } from '@/lib/supabase';

export async function GET() {
  const staff = await getStaffContext();
  if (!staff || staff.shopIds.length === 0) return jsonError(403, 'no_shop', 'No shop linked to this account');
  const admin = createAdminSupabase();
  const { data: shop, error } = await admin
    .from('shops')
    .select('id, owner_id, slug, short_code, name, address, city, phone, gstin, upi_id, kyc_status, status, is_open, rush_surcharge_bps, eta_minutes, rating_avg, rating_count, created_at')
    .eq('id', staff.shopIds[0]).single();
  if (error || !shop) {
    console.error('Could not load the signed-in shop:', error?.code);
    return jsonError(503, 'db', 'Could not load your shop. Please try again.');
  }
  const [{ data: services }, { data: onboarding }] = await Promise.all([
    admin.from('shop_services').select('service, enabled, display_order').eq('shop_id', shop.id).order('display_order'),
    admin.from('shop_onboarding').select('duplicate_name, name_proof_type, name_proof_gstin, review_note').eq('shop_id', shop.id).maybeSingle(),
  ]);
  return jsonOk({ shop, services: services ?? [], onboarding: onboarding ?? null, is_owner: shop.owner_id === staff.user.id });
}
