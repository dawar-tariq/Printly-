import { assertStaffOfShop, getSessionProfile, jsonOk, jsonError } from '@/lib/api';
import { createAdminSupabase } from '@/lib/supabase';
import { statusTransitionInput } from '@/lib/contracts';

const ALLOWED: Record<string, string[]> = {
  queued: ['printing', 'cancelled'],
  printing: ['ready', 'queued'],
  ready: ['collected'],
};

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = statusTransitionInput.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return jsonError(422, 'validation', 'Invalid target status');

  const admin = createAdminSupabase();
  const { data: order } = await admin.from('orders').select('id, shop_id, status, payment_status, payment_method').eq('id', id).maybeSingle();
  if (!order) return jsonError(404, 'order_not_found', 'Order not found');
  const staff = await assertStaffOfShop(order.shop_id, { recoveryOrderId: id });
  if (!staff) return jsonError(403, 'forbidden', 'Not your shop');

  const session = await getSessionProfile();
  const to = parsed.data.to;
  const allowed = ALLOWED[order.status] ?? [];
  if (!allowed.includes(to)) return jsonError(409, 'bad_transition', `Cannot move ${order.status} → ${to}`);

  const now = new Date().toISOString();
  const update: Record<string, unknown> = { status: to, updated_at: now };
  if (to === 'ready') update.ready_at = now;
  if (to === 'collected') {
    update.collected_at = now;
    if (order.payment_status === 'cod_pending') update.payment_status = 'cod_collected';
  }

  const { data: updated, error } = await admin.from('orders').update(update).eq('id', id).eq('status', order.status).select('id, status, payment_status').single();
  if (error) return jsonError(409, 'conflict', 'Order state changed — refresh and try again');

  if (to === 'collected' && order.payment_status === 'cod_pending') {
    await admin.from('payments').update({ status: 'cod_collected', confirmed_at: now, updated_at: now }).eq('order_id', id);
  }
  await admin.from('order_status_events').insert({
    order_id: id, from_status: order.status, to_status: to, by: session?.user.id ?? null, note: parsed.data.note ?? null,
  });
  return jsonOk({ order: updated });
}
