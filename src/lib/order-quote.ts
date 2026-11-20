import { createAdminSupabase } from '@/lib/supabase';
import type { RateRow } from '@/lib/pricing';

export type RateSnapshot = RateRow & { id: string };

/** Settings may be JSON numbers or older JSON strings written by the admin UI. */
export function settingBps(value: unknown, fallback: number): number {
  const numeric = typeof value === 'number' ? value : typeof value === 'string' && /^\d{1,4}$/.test(value) ? Number(value) : NaN;
  return Number.isInteger(numeric) && numeric >= 0 && numeric <= 5000 ? numeric : fallback;
}

/** Shared loader: order + items + shop rates + platform GST/rush settings. */
export async function loadOrderWithRates(orderId: string) {
  const admin = createAdminSupabase();
  const { data: order, error: orderError } = await admin
    .from('orders')
    .select('*, shops!inner(id, name, slug, upi_id, eta_minutes, rush_surcharge_bps, status)')
    .eq('id', orderId)
    .maybeSingle();
  if (orderError) throw new Error('Could not load the order.');
  if (!order) return null;
  const [itemResult, cardResult, settingsResult] = await Promise.all([
    admin.from('order_items').select('*').eq('order_id', orderId).order('id'),
    // Stable order makes pricing and the database snapshot comparison deterministic.
    admin.from('rate_card').select('id, service, paper_size, color, sides, paper_gsm, option, unit, price_paise').eq('shop_id', order.shop_id).order('id'),
    admin.from('platform_settings').select('key, value').in('key', ['gst_bps', 'rush_bps']),
  ]);
  if (itemResult.error || cardResult.error || settingsResult.error) throw new Error('Could not load order pricing.');
  const settingMap = Object.fromEntries((settingsResult.data ?? []).map((s) => [s.key, s.value as unknown]));
  return {
    admin,
    order,
    items: itemResult.data ?? [],
    card: (cardResult.data ?? []) as RateSnapshot[],
    gstBps: settingBps(settingMap.gst_bps, 1800),
    rushBps: settingBps(settingMap.rush_bps, 1000),
  };
}
