import { readJsonBody } from '@/lib/request-body';
import { assertStaffOfShop, jsonOk, jsonError } from '@/lib/api';
import { createAdminSupabase } from '@/lib/supabase';
import { confirmPaymentInput } from '@/lib/contracts';
import { draftMutationError } from '@/lib/draft-mutation';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = confirmPaymentInput.safeParse(await readJsonBody(req));
  if (!parsed.success) return jsonError(422, 'validation', 'Invalid action');

  const admin = createAdminSupabase();
  const { data: order } = await admin.from('orders').select('id, shop_id').eq('id', id).maybeSingle();
  if (!order) return jsonError(404, 'order_not_found', 'Order not found');
  const staff = await assertStaffOfShop(order.shop_id, { recoveryOrderId: id });
  if (!staff) return jsonError(403, 'forbidden', 'Not your shop');

  // One transaction checks the state and records the decision, payment, token
  // and event. A competing customer retry cannot undo a shop confirmation.
  const { data, error } = await admin.rpc('decide_shop_upi_payment', {
    p_order_id: id, p_shop_id: order.shop_id, p_action: parsed.data.action,
    p_actor: staff.user.id, p_utr: parsed.data.utr?.trim() || null,
  });
  if (error) return draftMutationError(error);
  return jsonOk({ ok: true, ...data });
}
