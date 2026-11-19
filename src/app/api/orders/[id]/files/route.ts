import { randomUUID } from 'crypto';
import { createAdminSupabase } from '@/lib/supabase';
import { jsonOk, jsonError } from '@/lib/api';
import { signedUploadRequest } from '@/lib/contracts';

const ALLOWED = new Set([
  'application/pdf', 'image/jpeg', 'image/png',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);
const MAX_FILES = 10;

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = signedUploadRequest.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return jsonError(422, 'validation', parsed.error.issues[0]?.message ?? 'Invalid file');
  if (!ALLOWED.has(parsed.data.mime)) return jsonError(422, 'bad_type', 'Only PDF, Word or image (JPG/PNG) files are allowed');

  const admin = createAdminSupabase();
  const { data: order } = await admin.from('orders').select('id, shop_id, status').eq('id', id).maybeSingle();
  if (!order) return jsonError(404, 'order_not_found', 'Order not found');
  if (order.status !== 'draft') return jsonError(409, 'order_locked', 'Order already placed');

  const { count } = await admin.from('order_files').select('id', { count: 'exact', head: true }).eq('order_id', id);
  if ((count ?? 0) >= MAX_FILES) return jsonError(422, 'too_many', `Maximum ${MAX_FILES} files per order`);

  const fileId = randomUUID();
  const safeName = parsed.data.name.replace(/[^\w.\-() ]/g, '_').slice(-120);
  const path = `${order.shop_id}/${id}/${fileId}-${safeName}`;

  const { data, error } = await admin.storage.from('order-files').createSignedUploadUrl(path);
  if (error || !data) return jsonError(500, 'storage', error?.message ?? 'Could not create upload URL');

  return jsonOk({ file_id: fileId, path, token: data.token, signedUrl: data.signedUrl });
}
