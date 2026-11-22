import { readJsonBody } from '@/lib/request-body';
import { createAdminSupabase, createServerSupabase } from '@/lib/supabase';
import { enforcePublicRateLimit } from '@/lib/rate-limit';
import { jsonOk, jsonError } from '@/lib/api';
import { disputeInput } from '@/lib/contracts';

export async function POST(req: Request) {
  const limited = await enforcePublicRateLimit(req, 'order_feedback');
  if (limited) return limited;
  const parsed = disputeInput.safeParse(await readJsonBody(req));
  if (!parsed.success) return jsonError(422, 'validation', 'Invalid dispute');
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  const admin = createAdminSupabase();
  const { data: order } = await admin.from('orders').select('id').eq('id', parsed.data.order_id).maybeSingle();
  if (!order) return jsonError(404, 'order_not_found', 'Order not found');

  const { data, error } = await admin.from('disputes').insert({
    order_id: parsed.data.order_id,
    raised_by: user?.id ?? null,
    type: parsed.data.type,
    description: parsed.data.description,
  }).select('id').single();
  if (error) {
    if (error.code === '23505') return jsonError(409, 'report_already_open', 'A report for this order is already open. Please contact the shop about it.');
    console.error('Could not save an order dispute:', error.message);
    return jsonError(503, 'db', 'Could not submit your report. Please try again.');
  }
  return jsonOk({ ok: true, dispute_id: data.id });
}
