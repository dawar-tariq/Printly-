import { getStaffContext, jsonError, jsonOk } from '@/lib/api';

/** Lightweight live status for an already-open shop workspace. */
export async function GET(req: Request) {
  const staff = await getStaffContext({ allowExpired: true });
  if (!staff || staff.isAdmin || staff.membershipError || !staff.shopIds.length) return jsonError(403, 'forbidden', 'Shop sign-in required.');
  if (staff.subscriptionError) return jsonError(503, 'db', 'Could not check subscription status. Please retry.');
  const shopId = new URL(req.url).searchParams.get('shop_id') ?? staff.shopIds[0];
  if (!staff.shopIds.includes(shopId)) return jsonError(403, 'forbidden', 'Not your shop.');
  const { data: plan, error } = await staff.admin.from('subscription_plan').select('warning_days').eq('id', true).maybeSingle();
  if (error || !plan) return jsonError(503, 'db', 'Could not check subscription status. Please retry.');
  return jsonOk({ subscription: staff.subscriptions.find((item) => item.shop_id === shopId) ?? null, warning_days: plan.warning_days }, { headers: { 'Cache-Control': 'private, no-store' } });
}
