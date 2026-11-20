import { createAdminSupabase } from '@/lib/supabase';
import { jsonOk, jsonError } from '@/lib/api';
import { paymentSubmittedInput } from '@/lib/contracts';
import { requestHasDraftAccess } from '@/lib/draft-access';
import { draftMutationError } from '@/lib/draft-mutation';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!requestHasDraftAccess(req, id)) return jsonError(403, 'draft_session', 'Your order session expired. Please contact the shop about this payment.');
  const parsed = paymentSubmittedInput.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return jsonError(422, 'validation', 'Invalid input');

  const admin = createAdminSupabase();
  const { error } = await admin.rpc('submit_upi_payment', { p_order_id: id, p_utr: parsed.data.utr?.trim() || null });
  if (error) return draftMutationError(error);
  return jsonOk({ ok: true }, { headers: { 'Cache-Control': 'private, no-store' } });
}
