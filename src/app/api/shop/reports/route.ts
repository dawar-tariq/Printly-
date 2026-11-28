import { getStaffContext, jsonOk, jsonError } from '@/lib/api';
import { createAdminSupabase } from '@/lib/supabase';
import { indiaDateKey, shopReportPeriod } from '@/lib/shop-report-period';

type Daily = { orders: number; revenue_paise: number };
type Snapshot = { orders_count: number; paid_orders_count: number; revenue_paise: number; service_counts: Record<string, number>; daily: Record<string, Daily> };
const safeCount = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

function validSnapshot(value: unknown, days: string[]): value is Snapshot {
  if (!object(value) || !safeCount(value.orders_count) || !safeCount(value.paid_orders_count) || !safeCount(value.revenue_paise)
      || value.paid_orders_count > value.orders_count || !object(value.service_counts) || !object(value.daily)) return false;
  if (!Object.values(value.service_counts).every(safeCount)) return false;
  let totalOrders = 0, totalRevenue = 0;
  for (const [day, raw] of Object.entries(value.daily)) {
    if (!days.includes(day) || !object(raw) || !safeCount(raw.orders) || !safeCount(raw.revenue_paise)) return false;
    totalOrders += raw.orders; totalRevenue += raw.revenue_paise;
  }
  return Number.isSafeInteger(totalOrders) && Number.isSafeInteger(totalRevenue)
    && totalOrders === value.orders_count && totalRevenue === value.revenue_paise;
}

type ReportOrder = { total_paise: number; payment_status: string; created_at: string; order_items: { service: string }[] | null };

export async function GET(req: Request) {
  const staff = await getStaffContext();
  if (!staff || staff.shopIds.length === 0) return jsonError(403, 'forbidden', 'No shop');
  const url = new URL(req.url);
  const shopId = url.searchParams.get('shop_id') ?? staff.shopIds[0];
  if (!staff.shopIds.includes(shopId)) return jsonError(403, 'forbidden', 'Not your shop');
  const range = url.searchParams.get('range') ?? 'week';
  const days = range === 'day' ? 1 : range === 'month' ? 30 : 7;
  const period = shopReportPeriod(days);
  const cutoff = new Date().toISOString();
  const admin = createAdminSupabase();

  // An aggregate in one PostgreSQL statement sees one snapshot, even when
  // payments or orders are changing. This also avoids PostgREST's page limit.
  const result = await admin.rpc('owner_shop_report', { p_shop: shopId, p_since: period.since, p_until: cutoff });
  let snapshot: unknown = result.data;
  if (result.error) {
    if (result.error.code !== 'PGRST202') {
      console.error('Could not load shop reports:', result.error.code);
      return jsonError(503, 'db', 'Could not load reports. Please try again.');
    }
    // Before migration 0024 is installed, one bounded query is still safe.
    // Never combine several pages that can observe different payment states.
    const { data, count, error } = await admin.from('orders')
      .select('total_paise, payment_status, created_at, order_items(service)', { count: 'exact' })
      .eq('shop_id', shopId).gte('created_at', period.since).lte('created_at', cutoff)
      .order('created_at', { ascending: true }).order('id', { ascending: true }).range(0, 999);
    if (error || count === null || !data) {
      console.error('Could not load shop reports:', error?.code);
      return jsonError(503, 'db', 'Could not load reports. Please try again.');
    }
    if (count > 1000) return jsonError(503, 'report_too_large', 'This period has too many orders to load safely. Choose a shorter period.');
    if (data.length !== count) return jsonError(503, 'report_incomplete', 'Could not load the complete report. Please try again.');
    const partial: Snapshot = { orders_count: count, paid_orders_count: 0, revenue_paise: 0, service_counts: Object.create(null) as Record<string, number>, daily: {} };
    for (const order of data as ReportOrder[]) {
      if (!safeCount(order.total_paise) || !indiaDateKey(order.created_at) || !Array.isArray(order.order_items)) {
        return jsonError(503, 'report_invalid', 'Could not load the complete report. Please try again.');
      }
      const paid = order.payment_status === 'confirmed' || order.payment_status === 'cod_collected';
      const date = indiaDateKey(order.created_at);
      const day = partial.daily[date] ?? { orders: 0, revenue_paise: 0 };
      day.orders += 1;
      if (paid) { partial.paid_orders_count += 1; partial.revenue_paise += order.total_paise; day.revenue_paise += order.total_paise; }
      partial.daily[date] = day;
      for (const item of order.order_items) {
        if (typeof item?.service !== 'string') return jsonError(503, 'report_invalid', 'Could not load the complete report. Please try again.');
        partial.service_counts[item.service] = (partial.service_counts[item.service] ?? 0) + 1;
      }
    }
    snapshot = partial;
  }
  if (!validSnapshot(snapshot, period.dates.map((date) => date.key))) return jsonError(503, 'report_invalid', 'Could not load the complete report. Please try again.');

  return jsonOk({
    range, days,
    orders_count: snapshot.orders_count,
    revenue_paise: snapshot.revenue_paise,
    paid_orders_count: snapshot.paid_orders_count,
    avg_order_paise: snapshot.paid_orders_count ? Math.round(snapshot.revenue_paise / snapshot.paid_orders_count) : 0,
    service_counts: snapshot.service_counts,
    series: period.dates.map((day) => ({ day: day.label, ...(snapshot.daily[day.key] ?? { revenue_paise: 0, orders: 0 }) })),
  }, { headers: { 'Cache-Control': 'private, no-store' } });
}
