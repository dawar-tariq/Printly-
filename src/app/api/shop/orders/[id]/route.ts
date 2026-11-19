import { assertStaffOfShop, jsonOk, jsonError } from '@/lib/api';
import { createAdminSupabase } from '@/lib/supabase';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const admin = createAdminSupabase();
  const { data: order } = await admin.from('orders').select('*, shops(id, name, slug)').eq('id', id).maybeSingle();
  if (!order) return jsonError(404, 'order_not_found', 'Order not found');
  const staff = await assertStaffOfShop(order.shop_id);
  if (!staff) return jsonError(403, 'forbidden', 'Not your shop');

  const [{ data: items }, { data: files }, { data: events }, { data: payment }] = await Promise.all([
    admin.from('order_items').select('*').eq('order_id', id).order('id'),
    admin.from('order_files').select('id, original_name, mime, size_bytes, page_count, source, created_at').eq('order_id', id),
    admin.from('order_status_events').select('from_status, to_status, note, created_at, by').eq('order_id', id).order('created_at'),
    admin.from('payments').select('provider, amount_paise, status, utr, confirmed_at').eq('order_id', id).maybeSingle(),
  ]);
  return jsonOk({ order, items: items ?? [], files: files ?? [], events: events ?? [], payment: payment ?? null });
}
