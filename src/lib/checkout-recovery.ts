import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { jsonError, jsonOk } from '@/lib/api';
import { buildUpiIntent } from '@/lib/upi';

export type CheckoutIdentity = { method: 'upi' | 'cod'; quote_token: string };
export type RecoveryOrder = {
  status: string; payment_method: string | null; payment_status: string | null;
  checkout_quote_token: string | null; total_paise: number;
};

/**
 * Return an already-started checkout, or null if no checkout has started.
 * This never starts a payment. Callers must first verify the draft capability.
 */
export async function recoverStartedCheckout(admin: SupabaseClient, id: string, order: RecoveryOrder, identity: CheckoutIdentity): Promise<Response | null> {
  if (order.status === 'draft' && !order.payment_method) return null;
  if (order.payment_method !== identity.method || order.checkout_quote_token !== identity.quote_token) {
    return jsonError(409, 'order_locked', 'Order already entered checkout.');
  }
  const noStore = { headers: { 'Cache-Control': 'private, no-store' } };
  if (identity.method === 'cod' || order.status !== 'draft' || order.payment_status !== 'pending') {
    return jsonOk({ mode: 'placed', total_paise: order.total_paise }, noStore);
  }
  const { data: payment, error } = await admin.from('payments').select('status, raw').eq('order_id', id).maybeSingle();
  const raw = payment?.raw as { checkout_upi_id?: unknown; checkout_shop_name?: unknown } | undefined;
  if (error || payment?.status !== 'created' || typeof raw?.checkout_upi_id !== 'string' || typeof raw.checkout_shop_name !== 'string') {
    return jsonError(409, 'order_locked', 'Checkout has started. Please contact the shop before paying again.');
  }
  const intent = buildUpiIntent({ upiId: raw.checkout_upi_id, payeeName: raw.checkout_shop_name, amountPaise: order.total_paise, note: `Printly ${id.slice(0, 8)}` });
  return jsonOk({ mode: 'upi', ...intent, shop_name: raw.checkout_shop_name, total_paise: order.total_paise }, noStore);
}
