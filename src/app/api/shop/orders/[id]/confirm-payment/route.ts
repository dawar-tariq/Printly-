import { NextResponse } from 'next/server';
import { readJsonBody } from '@/lib/request-body';
import { assertStaffOfShop, jsonOk, jsonError } from '@/lib/api';
import { createAdminSupabase } from '@/lib/supabase';
import { confirmPaymentInput } from '@/lib/contracts';
import { draftMutationError } from '@/lib/draft-mutation';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = confirmPaymentInput.safeParse(await readJsonBody(req));
  if (!parsed.success) return jsonError(422, 'validation', 'Invalid action');
  if (parsed.data.action === 'confirm' && parsed.data.verification_confirmed !== true) return jsonError(422, 'verification_required', 'Independently verify the transfer in your receiving account before confirming.');

  const admin = createAdminSupabase();
  const { data: order } = await admin.from('orders').select('id, shop_id').eq('id', id).maybeSingle();
  if (!order) return jsonError(404, 'order_not_found', 'Order not found');
  const staff = await assertStaffOfShop(order.shop_id, { recoveryOrderId: id });
  if (!staff) return jsonError(403, 'forbidden', 'Not your shop');

  // One transaction checks the state and records the decision, payment, token
  // and event. A competing customer retry cannot undo a shop confirmation.
  const { data, error } = await admin.rpc('decide_shop_upi_payment_checked', {
    p_order_id: id, p_shop_id: order.shop_id, p_action: parsed.data.action,
    p_actor: staff.user.id, p_utr: parsed.data.utr?.trim() || null,
    p_acknowledge_duplicate: parsed.data.duplicate_acknowledged === true,
  });
  if (error) return draftMutationError(error);
  if (data?.outcome === 'possible_duplicate') return NextResponse.json({
    error: { code: 'possible_duplicate', message: 'This reference also appears on another order in your shop. Check the actual transfers before proceeding.' },
    duplicate_count: data.duplicate_count, duplicates: data.duplicates,
  }, { status: 409, headers: { 'Cache-Control': 'private, no-store' } });
  return jsonOk({ ok: true, ...data });
}
