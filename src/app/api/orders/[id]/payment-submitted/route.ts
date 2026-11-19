import { createAdminSupabase } from '@/lib/supabase';
import { jsonOk, jsonError } from '@/lib/api';
import { paymentSubmittedInput } from '@/lib/contracts';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = paymentSubmittedInput.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return jsonError(422, 'validation', 'Invalid input');

  const admin = createAdminSupabase();
  const { data: order } = await admin.from('orders').select('id, status, payment_status, payment_method, shop_id').eq('id', id).maybeSingle();
  if (!order) return jsonError(404, 'order_not_found', 'Order not found');
  if (order.status !== 'draft') return jsonError(409, 'order_locked', 'Order already placed');
  if (order.payment_method !== 'upi') return jsonError(409, 'wrong_method', 'Not a UPI order');

  const utr = parsed.data.utr?.trim() || null;
  await admin.from('orders').update({ payment_status: 'submitted', utr, updated_at: new Date().toISOString() }).eq('id', id);
  await admin.from('payments').update({ status: 'submitted', utr, updated_at: new Date().toISOString() }).eq('order_id', id);
  await admin.from('order_status_events').insert({
    order_id: id, from_status: 'draft', to_status: 'draft',
    note: `Customer marked UPI payment done${utr ? ` (UTR ${utr})` : ''}`,
  });
  return jsonOk({ ok: true });
}
