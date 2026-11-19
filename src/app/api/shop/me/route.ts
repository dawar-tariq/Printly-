import { getStaffContext, jsonOk, jsonError } from '@/lib/api';
import { createAdminSupabase } from '@/lib/supabase';

export async function GET() {
  const staff = await getStaffContext();
  if (!staff || staff.shopIds.length === 0) return jsonError(403, 'no_shop', 'No shop linked to this account');
  const admin = createAdminSupabase();
  const { data: shop, error } = await admin
    .from('shops')
    .select('id, owner_id, slug, short_code, name, address, city, phone, gstin, upi_id, kyc_status, status, commission_bps, rush_surcharge_bps, eta_minutes, rating_avg, rating_count, created_at')
    .eq('id', staff.shopIds[0]).single();
  if (error || !shop) return jsonError(500, 'db', error?.message ?? 'Shop not found');
  const { data: services } = await admin.from('shop_services').select('service, enabled, display_order').eq('shop_id', shop.id).order('display_order');
  return jsonOk({ shop, services: services ?? [], isAdmin: staff.isAdmin });
}
