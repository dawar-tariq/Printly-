import { NextResponse } from 'next/server';
import { createAdminSupabase } from '@/lib/supabase';
import { jsonError, jsonOk } from '@/lib/api';
import { requestHasDraftAccess } from '@/lib/draft-access';
import { IMAGE_MIMES, PDF_MIME } from '@/lib/upload-files';
import { cleanupFileObjects, draftMutationError } from '@/lib/draft-mutation';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function getDraft(id: string) {
  const admin = createAdminSupabase();
  const { data: order } = await admin.from('orders').select('id, shop_id, status, payment_method').eq('id', id).maybeSingle();
  return { admin, order };
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string; fileId: string }> }) {
  const { id, fileId } = await params;
  if (!requestHasDraftAccess(req, id)) return jsonError(403, 'draft_session', 'Your order session expired. Please start a new order.');
  const { admin, order } = await getDraft(id);
  if (!order) return jsonError(404, 'order_not_found', 'Order not found');
  if (order.status !== 'draft' || order.payment_method) return jsonError(409, 'order_locked', 'The order is no longer editable.');
  const { data: file } = await admin.from('order_files').select('storage_path, mime').eq('id', fileId).eq('order_id', id).maybeSingle();
  if (!file) return jsonError(404, 'not_found', 'File not found');
  if (file.mime !== PDF_MIME && !IMAGE_MIMES.has(file.mime)) return jsonError(415, 'unsupported', 'Preview is available for PDF, JPEG and PNG files.');
  const { data, error } = await admin.storage.from('order-files').createSignedUrl(file.storage_path, 60);
  if (error || !data) return jsonError(500, 'storage', 'Could not open this file. Please try again.');
  const response = NextResponse.redirect(data.signedUrl, 302);
  response.headers.set('Cache-Control', 'private, no-store, max-age=0');
  response.headers.set('Referrer-Policy', 'no-referrer');
  response.headers.set('X-Content-Type-Options', 'nosniff');
  return response;
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string; fileId: string }> }) {
  const { id, fileId } = await params;
  if (!requestHasDraftAccess(req, id)) return jsonError(403, 'draft_session', 'Your order session expired. Please start a new order.');
  const body = await req.json().catch(() => ({})) as { path?: unknown };
  if (!UUID.test(fileId) || (body.path !== undefined && (typeof body.path !== 'string' || body.path.length > 500))) return jsonError(422, 'validation', 'Invalid file details.');
  const admin = createAdminSupabase();
  // First detach and tombstone the path transactionally; no delayed finalize
  // can attach it while storage cleanup is in progress.
  const { error } = await admin.rpc('remove_draft_file', { p_order_id: id, p_file_id: fileId, p_path: body.path ?? null });
  if (error) return draftMutationError(error);
  if (!await cleanupFileObjects(admin, id, fileId)) return jsonError(503, 'storage', 'The file was removed from the order, but its storage copy could not be removed. Please retry removal.');
  return jsonOk({ ok: true }, { headers: { 'Cache-Control': 'private, no-store' } });
}
