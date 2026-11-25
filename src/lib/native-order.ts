import 'server-only';
import { assertStaffOfShop, jsonError, jsonOk } from '@/lib/api';
import { createAdminSupabase } from '@/lib/supabase';

type Context = { params: Promise<{ id: string }> };

/** Do not turn failed item/file reads into an apparently empty order. */
export async function GET(_req: Request, { params }: Context) {
  const { id } = await params;
  const admin = createAdminSupabase();
  const result = await admin.from('orders')
    .select('id, shop_id, token, status, payment_status, payment_method, customer_name, customer_phone, customer_email, notes, subtotal_paise, tax_paise, total_paise, rush, eta_minutes, utr, created_at, shops(id, name, slug)')
    .eq('id', id).maybeSingle();
  if (result.error) return jsonError(503, 'db', 'Could not load the order. Please retry.');
  if (!result.data) return jsonError(404, 'order_not_found', 'Order not found.');
  const order = result.data;
  if (!await assertStaffOfShop(order.shop_id, { recoveryOrderId: id })) return jsonError(403, 'forbidden', 'Not your shop.');
  const [items, files, events, payment] = await Promise.all([
    admin.from('order_items').select('*').eq('order_id', id).order('id'),
    admin.from('order_files').select('id, original_name, mime, size_bytes, page_count, source, created_at').eq('order_id', id),
    admin.from('order_status_events').select('from_status, to_status, note, created_at, by').eq('order_id', id).order('created_at'),
    admin.from('payments').select('provider, amount_paise, status, utr, confirmed_at').eq('order_id', id).maybeSingle(),
  ]);
  if (items.error || files.error || events.error || payment.error || !Array.isArray(items.data) || !Array.isArray(files.data) || !Array.isArray(events.data)) {
    return jsonError(503, 'db', 'Could not load the complete order. Please retry.');
  }
  return jsonOk({ order, items: items.data, files: files.data, events: events.data, payment: payment.data },
    { headers: { 'Cache-Control': 'private, no-store' } });
}
