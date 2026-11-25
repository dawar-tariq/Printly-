import 'server-only';
import { getStaffContext, jsonError, jsonOk } from '@/lib/api';
import { createAdminSupabase } from '@/lib/supabase';

/** Native settings must not mistake a failed services/onboarding query for empty data. */
export async function GET() {
  const staff = await getStaffContext();
  if (!staff || staff.isAdmin || !staff.shopIds.length) return jsonError(403, 'no_shop', 'No active shop linked to this account.');
  const admin = createAdminSupabase();
  const shop = await admin.from('shops')
    .select('id, owner_id, slug, short_code, name, address, city, phone, gstin, upi_id, kyc_status, status, is_open, rush_surcharge_bps, eta_minutes, rating_avg, rating_count, created_at')
    .eq('id', staff.shopIds[0]).single();
  if (shop.error || !shop.data) return jsonError(503, 'db', 'Could not load your shop. Please retry.');
  const [services, onboarding] = await Promise.all([
    admin.from('shop_services').select('service, enabled, display_order').eq('shop_id', shop.data.id).order('display_order'),
    admin.from('shop_onboarding').select('duplicate_name, name_proof_type, name_proof_gstin, review_note').eq('shop_id', shop.data.id).maybeSingle(),
  ]);
  if (services.error || onboarding.error || !Array.isArray(services.data)) return jsonError(503, 'db', 'Could not load the complete shop settings. Please retry.');
  return jsonOk({ shop: shop.data, services: services.data, onboarding: onboarding.data ?? null, is_owner: shop.data.owner_id === staff.user.id },
    { headers: { 'Cache-Control': 'private, no-store' } });
}
