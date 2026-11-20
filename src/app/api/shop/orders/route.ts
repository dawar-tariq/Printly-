import { getStaffContext, jsonOk, jsonError } from '@/lib/api';

export async function GET(req: Request) {
  const staff = await getStaffContext();
  if (!staff) return jsonError(401, 'unauthorized', 'Sign in required');
  if (staff.shopIds.length === 0) return jsonError(403, 'no_shop', 'No shop linked to this account');

  const url = new URL(req.url);
  const lane = url.searchParams.get('lane') ?? 'board';
  const shopId = url.searchParams.get('shop_id') ?? staff.shopIds[0];
  if (!staff.shopIds.includes(shopId)) return jsonError(403, 'forbidden', 'Not your shop');

  let query = staff.admin
    .from('orders')
    .select('id, token, token_date, status, payment_status, payment_method, customer_name, customer_phone, subtotal_paise, total_paise, rush, eta_minutes, utr, created_at, ready_at, collected_at, items:order_items(count)')
    .eq('shop_id', shopId)
    .order('created_at', { ascending: false });

  const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);

  if (lane === 'confirm') {
    query = query.eq('status', 'draft').in('payment_status', ['submitted', 'pending']);
  } else if (lane === 'queued' || lane === 'printing' || lane === 'ready') {
    query = query.eq('status', lane);
  } else if (lane === 'completed') {
    query = query.eq('status', 'collected').gte('collected_at', startOfDay.toISOString());
  } else if (lane === 'board') {
    query = query.in('status', ['queued', 'printing', 'ready']).order('created_at', { ascending: true });
  } else {
    return jsonError(422, 'bad_lane', 'Unknown lane');
  }

  const { data, error } = await query.limit(100);
  if (error) return jsonError(500, 'db', error.message);
  return jsonOk({ orders: data ?? [] });
}
