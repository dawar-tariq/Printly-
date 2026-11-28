import { readJsonBody } from '@/lib/request-body';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { createAdminSupabase } from '@/lib/supabase';
import { jsonError, jsonOk } from '@/lib/api';
import { requestHasDraftAccess } from '@/lib/draft-access';
import { enforcePublicRateLimit, enforceUploadIssueLimit } from '@/lib/rate-limit';
import { FileValidationError, IMAGE_MIMES, inspectUploadedFile, MAX_FILE_BYTES, PDF_MIME } from '@/lib/upload-files';
import { cleanupFileObjects, discardFileObject, draftMutationError } from '@/lib/draft-mutation';

const revisionOf = (path: string) => createHash('sha256').update(path).digest('hex');
const editPathPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(pdf|png|jpg)$/i;

async function context(req: Request, id: string, fileId: string) {
  if (!requestHasDraftAccess(req, id)) return { error: jsonError(403, 'draft_session', 'Your order session expired. Please start a new order.') };
  const admin = createAdminSupabase();
  const { data: order } = await admin.from('orders').select('id, shop_id, status, payment_method').eq('id', id).maybeSingle();
  if (!order) return { error: jsonError(404, 'order_not_found', 'Order not found') };
  if (order.status !== 'draft' || order.payment_method) return { error: jsonError(409, 'order_locked', 'Files cannot be changed after checkout starts.') };
  const { data: file } = await admin.from('order_files').select('id, storage_path, mime, page_count, size_bytes').eq('id', fileId).eq('order_id', id).maybeSingle();
  if (!file) return { error: jsonError(404, 'not_found', 'File not found') };
  if (file.mime !== PDF_MIME && !IMAGE_MIMES.has(file.mime)) return { error: jsonError(415, 'unsupported', 'Only PDF, JPEG and PNG files can be edited.') };
  return { admin, order, file };
}

function validEditPath(path: string, shopId: string, orderId: string, fileId: string, mime?: string) {
  const prefix = `${shopId}/${orderId}/${fileId}-edit-`;
  if (!path.startsWith(prefix) || !editPathPattern.test(path.slice(prefix.length))) return false;
  if (!mime) return true;
  const extension = mime === PDF_MIME ? '.pdf' : mime === 'image/png' ? '.png' : '.jpg';
  return path.toLowerCase().endsWith(extension);
}

/** Create a new object first; do not change the order until it is validated. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string; fileId: string }> }) {
  const { id, fileId } = await params;
  const ctx = await context(req, id, fileId);
  if (ctx.error) return ctx.error;
  const parsed = z.object({ size: z.number().int().min(1).max(MAX_FILE_BYTES) }).safeParse(await readJsonBody(req));
  if (!parsed.success) return jsonError(422, 'validation', 'Edited file must be no larger than 25 MB.');
  const { admin, order, file } = ctx;
  // Edits create new Storage objects too, so they share the draft's issuance
  // allowance with original uploads and cannot be used to bypass it.
  const limited = await enforceUploadIssueLimit(req, id);
  if (limited) return limited;
  const ext = file.mime === PDF_MIME ? 'pdf' : file.mime === 'image/png' ? 'png' : 'jpg';
  const path = `${order.shop_id}/${id}/${fileId}-edit-${randomUUID()}.${ext}`;
  const { data, error } = await admin.storage.from('order-files').createSignedUploadUrl(path);
  if (error || !data) return jsonError(500, 'storage', 'Could not prepare the edited file. Please retry.');
  return jsonOk({ path, token: data.token, revision: revisionOf(file.storage_path) }, { headers: { 'Cache-Control': 'private, no-store' } });
}

export async function PUT(req: Request, { params }: { params: Promise<{ id: string; fileId: string }> }) {
  const { id, fileId } = await params;
  const ctx = await context(req, id, fileId);
  if (ctx.error) return ctx.error;
  const { admin, order, file } = ctx;
  const parsed = z.object({ path: z.string().max(500), revision: z.string().regex(/^[0-9a-f]{64}$/) }).safeParse(await readJsonBody(req));
  if (!parsed.success || !validEditPath(parsed.data.path, order.shop_id, id, fileId, file.mime)) return jsonError(422, 'validation', 'Invalid edited file.');
  const { path, revision } = parsed.data;
  // Retrying the same save after a lost response is harmless; also retry any
  // previous-object cleanup that the first response may not have reported.
  if (file.storage_path === path) {
    const cleaned = await cleanupFileObjects(admin, id, fileId);
    return jsonOk({ ok: true, page_count: file.page_count, size: file.size_bytes, cleanup_warning: !cleaned }, { headers: { 'Cache-Control': 'private, no-store' } });
  }
  if (revisionOf(file.storage_path) !== revision) return jsonError(409, 'stale_edit', 'The file changed while you were editing. Close and reopen it.');
  const limited = await enforcePublicRateLimit(req, 'file_processing');
  if (limited) return limited;
  const { data: blob, error: downloadError } = await admin.storage.from('order-files').download(path);
  if (downloadError || !blob) return jsonError(500, 'storage', 'Could not read the edited file. Please retry.');
  let info: { size: number; pages: number | null };
  try { info = await inspectUploadedFile(Buffer.from(await blob.arrayBuffer()), file.mime); }
  catch (err) {
    await discardFileObject(admin, id, fileId, path);
    return jsonError(422, 'invalid_file', err instanceof FileValidationError ? err.message : 'Edited file could not be read.');
  }
  if (file.page_count !== null && info.pages !== file.page_count) {
    await discardFileObject(admin, id, fileId, path);
    return jsonError(422, 'page_count_changed', 'Editing must keep every page. Please try again.');
  }

  // The database locks the order and compares the old path while atomically
  // swapping the file and tombstoning its previous object.
  const { error: updateError } = await admin.rpc('replace_draft_file', {
    p_order_id: id, p_file_id: fileId, p_previous_path: file.storage_path,
    p_new_path: path, p_size: info.size, p_pages: info.pages,
  });
  if (updateError) return draftMutationError(updateError);
  const cleaned = await cleanupFileObjects(admin, id, fileId);
  return jsonOk({ ok: true, page_count: info.pages, size: info.size, cleanup_warning: !cleaned }, { headers: { 'Cache-Control': 'private, no-store' } });
}

/** Discard an uncommitted object, including when checkout won a race. */
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string; fileId: string }> }) {
  const { id, fileId } = await params;
  if (!requestHasDraftAccess(req, id)) return jsonError(403, 'draft_session', 'Your order session expired. Please start a new order.');
  const admin = createAdminSupabase();
  const { data: order } = await admin.from('orders').select('id, shop_id').eq('id', id).maybeSingle();
  if (!order) return jsonError(404, 'order_not_found', 'Order not found');
  const { path } = (await readJsonBody(req) ?? {}) as { path?: unknown };
  if (typeof path !== 'string' || !validEditPath(path, order.shop_id, id, fileId)) return jsonError(422, 'validation', 'Invalid edited file.');
  const result = await discardFileObject(admin, id, fileId, path);
  if (result.error) return draftMutationError(result.error);
  if (!result.cleaned) return jsonError(503, 'storage', 'Could not discard the edited file. Please retry.');
  return jsonOk({ ok: true }, { headers: { 'Cache-Control': 'private, no-store' } });
}
