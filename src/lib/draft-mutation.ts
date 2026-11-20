import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { jsonError } from '@/lib/api';

/** Keep database internals out of customer-facing errors. */
export function draftMutationError(error: { message?: string } | null | undefined) {
  const message = error?.message ?? '';
  if (message.includes('ORDER_NOT_FOUND')) return jsonError(404, 'order_not_found', 'Order not found.');
  if (message.includes('FILE_NOT_FOUND')) return jsonError(404, 'not_found', 'File not found.');
  if (message.includes('ORDER_LOCKED')) return jsonError(409, 'order_locked', 'The order is no longer editable.');
  if (message.includes('ORDER_CHANGED') || message.includes('PRICING_CHANGED')) return jsonError(409, 'quote_changed', 'The order or price changed. Please review the updated total before placing the order.');
  if (message.includes('FILE_IN_USE')) return jsonError(409, 'file_in_use', 'This is the current file and cannot be discarded.');
  if (message.includes('FILE_REMOVED')) return jsonError(409, 'file_removed', 'This upload was removed. Please upload it again.');
  if (message.includes('STALE_EDIT')) return jsonError(409, 'stale_edit', 'The file changed while you were editing. Close and reopen it.');
  if (message.includes('TOO_MANY_FILES')) return jsonError(422, 'too_many', 'Maximum 10 files per order.');
  if (message.includes('INVALID_FILE') || message.includes('FILE_REQUIRED')) return jsonError(422, 'invalid_file', 'A selected file is missing from this order.');
  if (message.includes('INVALID_PAGES')) return jsonError(422, 'invalid_pages', 'The page count does not match the selected file.');
  if (message.includes('INVALID_PATH')) return jsonError(422, 'bad_path', 'That file path does not belong to this order.');
  if (message.includes('UPI_MISSING')) return jsonError(409, 'upi_missing', 'This shop has not set up UPI collection yet — choose Cash on collection.');
  if (message.includes('WRONG_SHOP')) return jsonError(403, 'forbidden', 'Not your shop.');
  if (message.includes('WRONG_METHOD')) return jsonError(409, 'wrong_method', 'This is not a UPI order.');
  if (message.includes('BAD_PAYMENT_STATE')) return jsonError(409, 'bad_state', 'The payment status changed or is not awaiting this action. Refresh and try again.');
  if (message.includes('PAYMENT_MISSING')) return jsonError(409, 'payment_missing', 'Payment details are missing. Please contact the shop.');
  if (message.includes('SHOP_UNAVAILABLE')) return jsonError(409, 'shop_unavailable', 'This shop is not accepting orders right now.');
  if (message.includes('EMPTY_ORDER')) return jsonError(422, 'empty_order', 'Add at least one item.');
  if (message.includes('TOKEN_LIMIT_REACHED')) return jsonError(503, 'token_limit', 'The shop cannot issue another token today. Please contact the shop.');
  console.error('Draft database operation failed:', message);
  return jsonError(503, 'db', 'Could not update the order. Please try again.');
}

/**
 * Remove only paths previously made ineligible for attachment by the database.
 * Keep a tombstone when cleanup fails, allowing a later retry. A tombstone is
 * retained after success too, so a delayed finalize cannot resurrect the path.
 */
export async function cleanupFileObjects(admin: SupabaseClient, orderId: string, fileId: string): Promise<boolean> {
  const { data, error } = await admin.from('order_file_tombstones').select('storage_path')
    .eq('order_id', orderId).eq('file_id', fileId).is('cleaned_at', null);
  if (error) { console.error('Could not find file cleanup records:', error.message); return false; }
  const paths = (data ?? []).map((row) => row.storage_path as string);
  if (!paths.length) return true;
  const { error: storageError } = await admin.storage.from('order-files').remove(paths);
  if (storageError) { console.error('Could not remove file objects:', storageError.message); return false; }
  const { error: updateError } = await admin.from('order_file_tombstones').update({ cleaned_at: new Date().toISOString() })
    .eq('order_id', orderId).eq('file_id', fileId).in('storage_path', paths).is('cleaned_at', null);
  if (updateError) { console.error('Could not record file cleanup:', updateError.message); return false; }
  return true;
}

export async function discardFileObject(admin: SupabaseClient, orderId: string, fileId: string, path: string) {
  const { error } = await admin.rpc('discard_order_file_object', { p_order_id: orderId, p_file_id: fileId, p_path: path });
  if (error) return { error, cleaned: false };
  return { error: null, cleaned: await cleanupFileObjects(admin, orderId, fileId) };
}
