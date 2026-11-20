import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { jsonError } from '@/lib/api';
import { subscriptionState, type ShopSubscription } from '@/lib/subscription';

/** null means the entitlement could not be checked; callers must fail closed. */
export async function shopHasSubscription(admin: SupabaseClient, shopId: string): Promise<boolean | null> {
  const { data, error } = await admin.from('shop_subscriptions').select('shop_id, term, started_at, expires_at, is_permanent')
    .eq('shop_id', shopId).maybeSingle();
  if (error) return null;
  return subscriptionState(data as ShopSubscription | null).active;
}

export function subscriptionMutationError(error: { message?: string } | null | undefined) {
  const message = error?.message ?? '';
  if (message.includes('OWNER_REQUIRED')) return jsonError(403, 'owner_required', 'Only the shop owner can purchase or report a subscription payment.');
  if (message.includes('ADMIN_REQUIRED')) return jsonError(403, 'forbidden', 'Admin only.');
  if (message.includes('SUBSCRIPTION_NOT_CONFIGURED')) return jsonError(409, 'not_configured', 'This term is not available yet. Please contact Printly.');
  if (message.includes('PERMANENT_ACCESS')) return jsonError(409, 'permanent', 'This shop already has permanent access and does not need to purchase.');
  if (message.includes('INVALID_REFERENCE')) return jsonError(422, 'invalid_reference', 'Enter a valid UPI transaction reference (6–40 letters, digits or hyphens).');
  if (message.includes('DUPLICATE_REFERENCE')) return jsonError(409, 'duplicate_reference', 'This payment reference has already been submitted. Contact Printly if you need help.');
  if (message.includes('PURCHASE_NOT_FOUND') || message.includes('SHOP_NOT_FOUND')) return jsonError(404, 'not_found', 'Subscription request not found.');
  if (message.includes('BAD_PURCHASE_STATE')) return jsonError(409, 'purchase_state', 'This request has already changed. Refresh before continuing.');
  if (message.includes('SETTINGS_CHANGED')) return jsonError(409, 'settings_changed', 'The plan was changed by another admin. Reload the saved values before making your changes again.');
  if (message.includes('INVALID_PLAN')) return jsonError(422, 'validation', 'Invalid subscription settings.');
  if (message.includes('REASON_REQUIRED')) return jsonError(422, 'reason_required', 'Add a reason so the shop owner can understand the decision.');
  if (message.includes('INVALID_TERM') || message.includes('INVALID_REVIEW')) return jsonError(422, 'validation', 'Invalid subscription request.');
  console.error('Subscription operation failed:', message);
  return jsonError(503, 'db', 'Could not update the subscription. Please try again.');
}
