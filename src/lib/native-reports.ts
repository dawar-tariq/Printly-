import 'server-only';
import { getStaffContext, jsonError, jsonOk } from '@/lib/api';
import { createAdminSupabase } from '@/lib/supabase';
import { indiaDateKey, shopReportPeriod } from '@/lib/shop-report-period';

type ReportOrder = { total_paise: number; payment_status: string; created_at: string; order_items: { service: string }[] };
type Day = { orders: number; revenue_paise: number };
const safeCount = (n: unknown): n is number => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0;

/**
 * A single bounded query is used until an aggregate RPC is separately reviewed
 * and installed. It must not silently truncate a financial report. Revenue is
 * for paid orders CREATED in the period, not a payment-date ledger.
 */
export async function GET(req: Request) {
  const staff = await getStaffContext();
  if (!staff || staff.isAdmin || !staff.shopIds.length) return jsonError(403, 'forbidden', 'Shop sign-in required.');
  const params = new URL(req.url).searchParams;
  const shopId = params.get('shop_id') ?? staff.shopIds[0];
  if (!staff.shopIds.includes(shopId)) return jsonError(403, 'forbidden', 'Not your shop.');
  const range = params.get('range') ?? 'week';
  if (!['day', 'week', 'month'].includes(range)) return jsonError(422, 'validation', 'Choose a valid report period.');
  const days = range === 'day' ? 1 : range === 'month' ? 30 : 7;
  const period = shopReportPeriod(days);
  const cutoff = new Date().toISOString();
  const admin = createAdminSupabase();
  const { data, count, error } = await admin.from('orders')
    .select('total_paise, payment_status, created_at, order_items(service)', { count: 'exact' })
    .eq('shop_id', shopId).gte('created_at', period.since).lte('created_at', cutoff)
    .order('created_at', { ascending: true }).order('id', { ascending: true }).range(0, 999);
  if (error || count === null || !Array.isArray(data)) return jsonError(503, 'db', 'Could not load reports. Please try again.');
  if (count > 1000) return jsonError(503, 'report_too_large', 'This period has too many orders to load safely. Choose a shorter period.');
  if (data.length !== count) return jsonError(503, 'report_incomplete', 'Could not load the complete report. Please try again.');
  const serviceCounts: Record<string, number> = Object.create(null);
  const daily: Record<string, Day> = Object.create(null);
  let paid = 0, revenue = 0;
  const validDays = new Set(period.dates.map((d) => d.key));
  for (const order of data as ReportOrder[]) {
    const date = typeof order.created_at === 'string' ? indiaDateKey(order.created_at) : '';
    if (!safeCount(order.total_paise) || !validDays.has(date) || typeof order.payment_status !== 'string' || !Array.isArray(order.order_items)) {
      return jsonError(503, 'report_invalid', 'Could not load the complete report. Please try again.');
    }
    const day = daily[date] ?? { orders: 0, revenue_paise: 0 };
    day.orders += 1;
    if (order.payment_status === 'confirmed' || order.payment_status === 'cod_collected') {
      paid += 1; revenue += order.total_paise; day.revenue_paise += order.total_paise;
    }
    daily[date] = day;
    for (const item of order.order_items) {
      if (typeof item?.service !== 'string') return jsonError(503, 'report_invalid', 'Could not load the complete report. Please try again.');
      serviceCounts[item.service] = (serviceCounts[item.service] ?? 0) + 1;
    }
  }
  if (!safeCount(revenue)) return jsonError(503, 'report_invalid', 'Could not load the complete report. Please try again.');
  return jsonOk({
    range, days, orders_count: count, paid_orders_count: paid, revenue_paise: revenue,
    avg_order_paise: paid ? Math.round(revenue / paid) : 0, service_counts: serviceCounts,
    series: period.dates.map((day) => ({ day: day.label, ...(daily[day.key] ?? { orders: 0, revenue_paise: 0 }) })),
  }, { headers: { 'Cache-Control': 'private, no-store' } });
}
