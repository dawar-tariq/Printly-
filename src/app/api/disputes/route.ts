import { createAdminSupabase, createServerSupabase } from '@/lib/supabase';
import { jsonOk, jsonError } from '@/lib/api';
import { disputeInput } from '@/lib/contracts';

export async function POST(req: Request) {
  const parsed = disputeInput.safeParse(await req.json().catch(() => ({})));
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
  if (error) return jsonError(500, 'db', error.message);
  return jsonOk({ ok: true, dispute_id: data.id });
}
