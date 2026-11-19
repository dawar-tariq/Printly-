import { PDFDocument } from 'pdf-lib';
import { createAdminSupabase } from '@/lib/supabase';
import { jsonOk, jsonError } from '@/lib/api';

async function pageCountOf(buffer: Buffer, mime: string): Promise<number> {
  if (mime === 'application/pdf') {
    const doc = await PDFDocument.load(buffer, { ignoreEncryption: true });
    return doc.getPageCount();
  }
  if (mime.startsWith('image/')) return 1;
  return 1; // Word docs: counted as 1 until printed; shop can adjust on device
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string; fileId: string }> }) {
  const { id, fileId } = await params;
  const { path, original_name, mime, size_bytes, source } = (await req.json().catch(() => ({}))) as {
    path?: string; original_name?: string; mime?: string; size_bytes?: number; source?: string;
  };
  if (!path || !original_name || !mime) return jsonError(422, 'validation', 'path, original_name, mime required');

  const admin = createAdminSupabase();
  const { data: order } = await admin.from('orders').select('id, shop_id, status').eq('id', id).maybeSingle();
  if (!order) return jsonError(404, 'order_not_found', 'Order not found');
  if (order.status !== 'draft') return jsonError(409, 'order_locked', 'Order already placed');
  if (!path.startsWith(`${order.shop_id}/${id}/`)) return jsonError(422, 'bad_path', 'Path does not belong to this order');

  const { data: blob, error } = await admin.storage.from('order-files').download(path);
  if (error || !blob) return jsonError(500, 'storage', error?.message ?? 'Download failed');
  const buffer = Buffer.from(await blob.arrayBuffer());

  let pages = 1;
  try {
    pages = await pageCountOf(buffer, mime);
  } catch {
    pages = 1; // unreadable/encrypted PDF — shop can correct at the counter
  }

  const { data: row, error: insErr } = await admin.from('order_files').insert({
    id: fileId, order_id: id, shop_id: order.shop_id, storage_path: path,
    original_name: original_name.slice(0, 200), mime, size_bytes: size_bytes ?? buffer.length,
    page_count: pages, source: source === 'dropbox' ? 'dropbox' : 'upload',
  }).select('id, page_count').single();
  if (insErr) return jsonError(500, 'db', insErr.message);

  return jsonOk({ file_id: row.id, page_count: row.page_count });
}
