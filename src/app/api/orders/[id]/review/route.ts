import { createAdminSupabase } from '@/lib/supabase';
import { jsonOk, jsonError } from '@/lib/api';
import { reviewInput } from '@/lib/contracts';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = reviewInput.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return jsonError(422, 'validation', 'Invalid review');
  const admin = createAdminSupabase();
  const { data: order } = await admin.from('orders').select('id, shop_id, status').eq('id', id).maybeSingle();
  if (!order) return jsonError(404, 'order_not_found', 'Order not found');
  if (order.status !== 'collected') return jsonError(409, 'not_collected', 'You can rate once the order is collected');

  const { error } = await admin.from('reviews').insert({
    order_id: id, shop_id: order.shop_id, rating: parsed.data.rating, comment: parsed.data.comment ?? '',
  });
  if (error) {
    if (error.code === '23505') return jsonError(409, 'already_reviewed', 'This order was already rated');
    return jsonError(500, 'db', error.message);
  }
  const { data: agg } = await admin.from('reviews').select('rating').eq('shop_id', order.shop_id);
  if (agg && agg.length) {
    const avg = agg.reduce((a, r) => a + r.rating, 0) / agg.length;
    await admin.from('shops').update({ rating_avg: Math.round(avg * 10) / 10, rating_count: agg.length }).eq('id', order.shop_id);
  }
  return jsonOk({ ok: true });
}
