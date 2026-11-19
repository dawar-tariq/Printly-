import { assertStaffOfShop, getSessionProfile, jsonOk, jsonError } from '@/lib/api';
import { createAdminSupabase } from '@/lib/supabase';
import { confirmPaymentInput } from '@/lib/contracts';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = confirmPaymentInput.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return jsonError(422, 'validation', 'Invalid action');

  const admin = createAdminSupabase();
  const { data: order } = await admin
    .from('orders')
    .select('id, shop_id, status, payment_status, payment_method, shops(eta_minutes)').eq('id', id).maybeSingle();
  if (!order) return jsonError(404, 'order_not_found', 'Order not found');
  const staff = await assertStaffOfShop(order.shop_id);
  if (!staff) return jsonError(403, 'forbidden', 'Not your shop');
  const session = await getSessionProfile();
  const now = new Date().toISOString();

  if (parsed.data.action === 'reject') {
    await admin.from('orders').update({ payment_status: 'rejected', updated_at: now }).eq('id', id);
    await admin.from('payments').update({ status: 'rejected', updated_at: now }).eq('order_id', id);
    await admin.from('order_status_events').insert({
      order_id: id, from_status: 'draft', to_status: 'draft', by: session?.user.id ?? null,
      note: 'Shop could not verify the UPI payment',
    });
    return jsonOk({ ok: true, outcome: 'rejected' });
  }

  // confirm — only from submitted
  if (order.payment_status !== 'submitted') {
    return jsonError(409, 'bad_state', `Order is ${order.payment_status}, not awaiting confirmation`);
  }
  const { data: token, error: tokErr } = await admin.rpc('next_token', { p_shop_id: order.shop_id });
  if (tokErr) return jsonError(500, 'token', tokErr.message);
  const eta = (order as unknown as { shops: { eta_minutes: number } }).shops?.eta_minutes ?? 20;

  const { error } = await admin.from('orders').update({
    status: 'queued', payment_status: 'confirmed', token, eta_minutes: eta, updated_at: now,
    ...(parsed.data.utr ? { utr: parsed.data.utr } : {}),
  }).eq('id', id).eq('payment_status', 'submitted');
  if (error) return jsonError(409, 'conflict', 'Order state changed — refresh and try again');

  await admin.from('payments').update({
    status: 'confirmed', confirmed_by: session?.user.id ?? null, confirmed_at: now,
    ...(parsed.data.utr ? { utr: parsed.data.utr } : {}), updated_at: now,
  }).eq('order_id', id);
  await admin.from('order_status_events').insert({
    order_id: id, from_status: 'draft', to_status: 'queued', by: session?.user.id ?? null,
    note: `Payment confirmed by shop — token ${token} assigned`,
  });
  return jsonOk({ ok: true, outcome: 'confirmed', token });
}
