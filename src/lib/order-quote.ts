import { createAdminSupabase } from '@/lib/supabase';
import type { RateRow } from '@/lib/pricing';

/** Shared loader: order + items + shop rates + platform GST/rush settings. */
export async function loadOrderWithRates(orderId: string) {
  const admin = createAdminSupabase();
  const { data: order } = await admin
    .from('orders')
    .select('*, shops!inner(id, name, slug, upi_id, eta_minutes, commission_bps, rush_surcharge_bps, status)')
    .eq('id', orderId)
    .maybeSingle();
  if (!order) return null;
  const [{ data: items }, { data: card }, { data: settings }] = await Promise.all([
    admin.from('order_items').select('*').eq('order_id', orderId).order('id'),
    admin.from('rate_card').select('service, paper_size, color, sides, paper_gsm, option, unit, price_paise').eq('shop_id', order.shop_id),
    admin.from('platform_settings').select('key, value').in('key', ['gst_bps', 'rush_bps']),
  ]);
  const settingMap = Object.fromEntries((settings ?? []).map((s) => [s.key, s.value as unknown]));
  return {
    admin,
    order,
    items: items ?? [],
    card: (card ?? []) as RateRow[],
    gstBps: typeof settingMap.gst_bps === 'number' ? settingMap.gst_bps : 1800,
    rushBps: typeof settingMap.rush_bps === 'number' ? settingMap.rush_bps : 1000,
  };
}
