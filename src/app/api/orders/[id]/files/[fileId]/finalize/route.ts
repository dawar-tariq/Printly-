import { createAdminSupabase } from '@/lib/supabase';
import { jsonOk, jsonError } from '@/lib/api';
import { requestHasDraftAccess } from '@/lib/draft-access';
import { inspectUploadedFile, FileValidationError, MAX_ORDER_FILES } from '@/lib/upload-files';
import { discardFileObject, draftMutationError } from '@/lib/draft-mutation';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(req: Request, { params }: { params: Promise<{ id: string; fileId: string }> }) {
  const { id, fileId } = await params;
  if (!requestHasDraftAccess(req, id)) return jsonError(403, 'draft_session', 'Your order session expired. Please start a new order.');
  const { path, original_name, mime } = (await req.json().catch(() => ({}))) as { path?: string; original_name?: string; mime?: string };
  if (typeof path !== 'string' || typeof original_name !== 'string' || !original_name.trim() || typeof mime !== 'string' || !UUID.test(fileId)) return jsonError(422, 'validation', 'Invalid file details');

  const admin = createAdminSupabase();
  const { data: order } = await admin.from('orders').select('id, shop_id, status, payment_method').eq('id', id).maybeSingle();
  if (!order) return jsonError(404, 'order_not_found', 'Order not found');
  if (order.status !== 'draft' || order.payment_method) return jsonError(409, 'order_locked', 'Files cannot be changed after checkout starts.');
  if (!path.startsWith(`${order.shop_id}/${id}/${fileId}-`) || path.slice(`${order.shop_id}/${id}/`.length).includes('/')) return jsonError(422, 'bad_path', 'Path does not belong to this file');

  // A retry after a lost response is safe and never attaches the same upload twice.
  const { data: existing } = await admin.from('order_files').select('id, storage_path, page_count').eq('id', fileId).eq('order_id', id).maybeSingle();
  if (existing) {
    if (existing.storage_path !== path) return jsonError(409, 'file_exists', 'A different file is already using this ID.');
    return jsonOk({ file_id: existing.id, page_count: existing.page_count });
  }
  const { count, error: countError } = await admin.from('order_files').select('id', { count: 'exact', head: true }).eq('order_id', id);
  if (countError) return jsonError(500, 'db', 'Could not check the number of files.');
  if ((count ?? 0) >= MAX_ORDER_FILES) return jsonError(422, 'too_many', `Maximum ${MAX_ORDER_FILES} files per order`);

  const { data: blob, error } = await admin.storage.from('order-files').download(path);
  if (error || !blob) return jsonError(500, 'storage', 'Could not read the uploaded file. Please retry.');
  let info: { size: number; pages: number | null };
  try { info = await inspectUploadedFile(Buffer.from(await blob.arrayBuffer()), mime); }
  catch (err) {
    // A concurrent finalize may have attached this path; the database first
    // makes sure it is unreferenced before storage cleanup is allowed.
    await discardFileObject(admin, id, fileId, path);
    return jsonError(422, 'invalid_file', err instanceof FileValidationError ? err.message : 'File could not be read.');
  }

  const { data: row, error: insErr } = await admin.from('order_files').insert({
    id: fileId, order_id: id, shop_id: order.shop_id, storage_path: path,
    original_name: original_name.trim().slice(0, 200), mime, size_bytes: info.size,
    page_count: info.pages, source: 'upload',
  }).select('id, page_count').single();
  if (insErr || !row) {
    // Concurrent retries of the same finalize may have succeeded already.
    const { data: saved } = await admin.from('order_files').select('id, storage_path, page_count').eq('id', fileId).eq('order_id', id).maybeSingle();
    if (saved?.storage_path === path) return jsonOk({ file_id: saved.id, page_count: saved.page_count });
    if (!saved) await discardFileObject(admin, id, fileId, path);
    return draftMutationError(insErr);
  }
  return jsonOk({ file_id: row.id, page_count: row.page_count });
}
