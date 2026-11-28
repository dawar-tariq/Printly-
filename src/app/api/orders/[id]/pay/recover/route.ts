import { z } from 'zod';
import { jsonError } from '@/lib/api';
import { createAdminSupabase } from '@/lib/supabase';
import { readJsonBody } from '@/lib/request-body';
import { requestHasDraftAccess } from '@/lib/draft-access';
import { recoverStartedCheckout } from '@/lib/checkout-recovery';

const input = z.object({ method: z.enum(['upi', 'cod']), quote_token: z.string().regex(/^[0-9a-f]{64}$/) }).strict();

/** Read-only recovery after a reload; this route can never start a checkout. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!requestHasDraftAccess(req, id)) return jsonError(403, 'draft_session', 'This order session expired. If you paid, contact the shop with your tracking link and payment reference.');
  const parsed = input.safeParse(await readJsonBody(req));
  if (!parsed.success) return jsonError(422, 'validation', 'Could not check the previous checkout.');
  try {
    const admin = createAdminSupabase();
    const { data: order, error } = await admin.from('orders')
      .select('status, payment_method, payment_status, checkout_quote_token, total_paise').eq('id', id).maybeSingle();
    if (error) return jsonError(503, 'db', 'Could not check the previous checkout. Please retry.');
    if (!order) return jsonError(404, 'order_not_found', 'Order not found. Contact the shop if you already paid.');
    const recovered = await recoverStartedCheckout(admin, id, order, parsed.data);
    if (recovered) return recovered;
    // An earlier request can still be in flight. Do not claim that it failed
    // or start another checkout merely because it isn't visible yet.
    return jsonError(409, 'checkout_unconfirmed', 'Checkout is not confirmed yet. Wait and check again; if you paid, contact the shop before paying again.');
  } catch {
    return jsonError(503, 'db', 'Could not check the previous checkout. Please retry.');
  }
}
