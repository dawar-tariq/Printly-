import { readJsonBody } from '@/lib/request-body';
import { createAdminSupabase } from '@/lib/supabase';
import { enforcePublicRateLimit } from '@/lib/rate-limit';
import { jsonOk, jsonError } from '@/lib/api';
import { reviewInput } from '@/lib/contracts';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const limited = await enforcePublicRateLimit(req, 'order_feedback');
  if (limited) return limited;
  const parsed = reviewInput.safeParse(await readJsonBody(req));
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
    console.error('Could not save an order review:', error.message);
    return jsonError(503, 'db', 'Could not submit your rating. Please try again.');
  }
  // The database updates the aggregate transactionally from all reviews.
  // Do not fetch a capped PostgREST page and overwrite it with a stale total.
  return jsonOk({ ok: true });
}
