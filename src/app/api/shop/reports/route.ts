import { getStaffContext, jsonOk, jsonError } from '@/lib/api';
import { createAdminSupabase } from '@/lib/supabase';

export async function GET(req: Request) {
  const staff = await getStaffContext();
  if (!staff || staff.shopIds.length === 0) return jsonError(403, 'forbidden', 'No shop');
  const url = new URL(req.url);
  const shopId = url.searchParams.get('shop_id') ?? staff.shopIds[0];
  if (!staff.shopIds.includes(shopId)) return jsonError(403, 'forbidden', 'Not your shop');
  const range = url.searchParams.get('range') ?? 'week';
  const days = range === 'day' ? 1 : range === 'month' ? 30 : 7;
  const since = new Date(); since.setDate(since.getDate() - (days - 1)); since.setHours(0, 0, 0, 0);

  const admin = createAdminSupabase();
  const { data: orders, error } = await admin
    .from('orders')
    .select('id, total_paise, payment_status, status, created_at, order_items(service, line_total_paise)')
    .eq('shop_id', shopId)
    .gte('created_at', since.toISOString());
  if (error) {
    console.error('Could not load shop reports:', error.code);
    return jsonError(503, 'db', 'Could not load reports. Please try again.');
  }

  const paid = (orders ?? []).filter((o) => o.payment_status === 'confirmed' || o.payment_status === 'cod_collected');
  const revenue = paid.reduce((a, o) => a + (o.total_paise ?? 0), 0);
  const count = orders?.length ?? 0;

  const serviceAgg = new Map<string, number>();
  for (const o of orders ?? []) {
    for (const it of (o as unknown as { order_items: { service: string; line_total_paise: number }[] }).order_items ?? []) {
      serviceAgg.set(it.service, (serviceAgg.get(it.service) ?? 0) + 1);
    }
  }
  const series: { day: string; revenue_paise: number; orders: number }[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i); d.setHours(0, 0, 0, 0);
    const key = d.toISOString().slice(0, 10);
    const dayOrders = (orders ?? []).filter((o) => o.created_at.slice(0, 10) === key);
    const dayRevenue = dayOrders
      .filter((o) => o.payment_status === 'confirmed' || o.payment_status === 'cod_collected')
      .reduce((a, o) => a + (o.total_paise ?? 0), 0);
    series.push({ day: d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }), revenue_paise: dayRevenue, orders: dayOrders.length });
  }

  return jsonOk({
    range, days,
    orders_count: count,
    revenue_paise: revenue,
    paid_orders_count: paid.length,
    avg_order_paise: paid.length ? Math.round(revenue / paid.length) : 0,
    service_counts: Object.fromEntries(serviceAgg),
    series,
  });
}
