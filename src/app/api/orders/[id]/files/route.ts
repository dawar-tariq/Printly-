import { randomUUID } from 'node:crypto';
import { createAdminSupabase } from '@/lib/supabase';
import { jsonOk, jsonError } from '@/lib/api';
import { signedUploadRequest } from '@/lib/contracts';
import { requestHasDraftAccess } from '@/lib/draft-access';
import { ALLOWED_FILE_MIMES, MAX_ORDER_FILES } from '@/lib/upload-files';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!requestHasDraftAccess(req, id)) return jsonError(403, 'draft_session', 'Your order session expired. Please start a new order.');
  const parsed = signedUploadRequest.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return jsonError(422, 'validation', parsed.error.issues[0]?.message ?? 'Invalid file');
  if (!ALLOWED_FILE_MIMES.has(parsed.data.mime)) return jsonError(422, 'bad_type', 'Only PDF, Word or image (JPG/PNG) files are allowed');

  const admin = createAdminSupabase();
  const { data: order } = await admin.from('orders').select('id, shop_id, status, payment_method').eq('id', id).maybeSingle();
  if (!order) return jsonError(404, 'order_not_found', 'Order not found');
  if (order.status !== 'draft' || order.payment_method) return jsonError(409, 'order_locked', 'Files cannot be changed after checkout starts.');

  const { count, error: countError } = await admin.from('order_files').select('id', { count: 'exact', head: true }).eq('order_id', id);
  if (countError) return jsonError(500, 'db', 'Could not check the number of files.');
  if ((count ?? 0) >= MAX_ORDER_FILES) return jsonError(422, 'too_many', `Maximum ${MAX_ORDER_FILES} files per order`);

  const fileId = randomUUID();
  const safeName = parsed.data.name.replace(/[^\w.\-() ]/g, '_').slice(-120) || 'file';
  const path = `${order.shop_id}/${id}/${fileId}-${safeName}`;
  const { data, error } = await admin.storage.from('order-files').createSignedUploadUrl(path);
  if (error || !data) return jsonError(500, 'storage', error?.message ?? 'Could not create upload URL');
  return jsonOk({ file_id: fileId, path, token: data.token }, { headers: { 'Cache-Control': 'private, no-store' } });
}
