import 'server-only';
import { getStaffContext, jsonError, jsonOk } from '@/lib/api';

/** Review details are visible only to the owner of a linked shop, including
 * owners whose subscription has not started. Never trust a caller-supplied ID. */
export async function GET() {
  const staff = await getStaffContext({ allowExpired: true });
  if (!staff || staff.isAdmin) return jsonError(403, 'forbidden', 'Shop sign-in required.');
  if (staff.membershipError || staff.subscriptionError) return jsonError(503, 'db', 'Could not check shop access. Please try again.');
  if (!staff.shopIds.length) return jsonOk({ application: null }, { headers: { 'Cache-Control': 'private, no-store' } });
  const shop = await staff.admin.from('shops').select('id, owner_id, kyc_status, status').eq('id', staff.shopIds[0]).maybeSingle();
  if (shop.error || !shop.data) return jsonError(503, 'db', 'Could not check your application. Please try again.');
  if (shop.data.owner_id !== staff.user.id) return jsonOk({ application: null }, { headers: { 'Cache-Control': 'private, no-store' } });
  const onboarding = await staff.admin.from('shop_onboarding').select('review_note').eq('shop_id', shop.data.id).maybeSingle();
  if (onboarding.error) return jsonError(503, 'db', 'Could not check your application. Please try again.');
  return jsonOk({ application: { shop_id: shop.data.id, status: shop.data.kyc_status, shop_status: shop.data.status,
    review_note: onboarding.data?.review_note ?? '', can_access_dashboard: staff.activeShopIds.includes(shop.data.id) } },
  { headers: { 'Cache-Control': 'private, no-store' } });
}
