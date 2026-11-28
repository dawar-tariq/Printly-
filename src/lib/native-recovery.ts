import 'server-only';
import { getStaffContext, jsonError, jsonOk } from '@/lib/api';

/** Restricted access to already-started/placed orders, with complete pagination. */
export async function GET(request: Request) {
  const staff = await getStaffContext({ allowExpired: true });
  if (!staff || staff.isAdmin || !staff.shopIds.length) return jsonError(403, 'forbidden', 'Shop sign-in required.');
  const params = new URL(request.url).searchParams;
  const shopId = params.get('shop_id') ?? staff.shopIds[0];
  if (!staff.shopIds.includes(shopId)) return jsonError(403, 'forbidden', 'Not your shop.');
  const requestedPage = Number(params.get('page') ?? '1');
  const page = Number.isSafeInteger(requestedPage) ? Math.max(1, Math.min(100_000, requestedPage)) : 1;
  const pageSize = 30;
  const { data, error, count } = await staff.admin.from('orders')
    .select('id, token, status, payment_status, payment_method, customer_name, customer_phone, total_paise, utr, created_at', { count: 'exact' })
    .eq('shop_id', shopId)
    .or('status.in.(queued,printing,ready),and(status.eq.draft,payment_method.eq.upi)')
    .order('created_at', { ascending: false }).order('id', { ascending: false })
    .range((page - 1) * pageSize, page * pageSize - 1);
  if (error || count === null || !Number.isSafeInteger(count) || count < 0 || !Array.isArray(data)) {
    return jsonError(503, 'recovery_unavailable', 'Could not load open orders. Please retry.');
  }
  const expected = Math.min(pageSize, Math.max(0, count - (page - 1) * pageSize));
  if (data.length !== expected) return jsonError(503, 'recovery_incomplete', 'Could not load the complete page of open orders. Please retry.');
  return jsonOk({ orders: data, pagination: { page, pages: Math.max(1, Math.ceil(count / pageSize)), count } },
    { headers: { 'Cache-Control': 'private, no-store' } });
}
