import { getStaffContext, jsonError, jsonOk } from '@/lib/api';

/** Limited access while expired: only open orders or UPI checkout already started. */
export async function GET(req: Request) {
  const staff = await getStaffContext({ allowExpired: true });
  if (!staff || staff.isAdmin || !staff.shopIds.length) return jsonError(403, 'forbidden', 'Shop sign-in required.');
  const params = new URL(req.url).searchParams;
  const shopId = params.get('shop_id') ?? staff.shopIds[0];
  const requestedPage = Number(params.get('page') ?? '1');
  const page = Number.isSafeInteger(requestedPage) ? Math.max(1, Math.min(100000, requestedPage)) : 1;
  const pageSize = 30;
  if (!staff.shopIds.includes(shopId)) return jsonError(403, 'forbidden', 'Not your shop.');
  const { data, error, count } = await staff.admin.from('orders')
    .select('id, token, status, payment_status, payment_method, customer_name, customer_phone, total_paise, utr, created_at', { count: 'exact' })
    .eq('shop_id', shopId)
    .or('status.in.(queued,printing,ready),and(status.eq.draft,payment_method.eq.upi)')
    .order('created_at', { ascending: false }).range((page - 1) * pageSize, page * pageSize - 1);
  if (error) return jsonError(503, 'db', 'Could not load open orders. Please retry.');
  return jsonOk({ orders: data ?? [], pagination: { page, pages: Math.max(1, Math.ceil((count ?? 0) / pageSize)), count: count ?? 0 } }, { headers: { 'Cache-Control': 'private, no-store' } });
}
