import { PDFDocument } from 'pdf-lib';
import { randomUUID } from 'crypto';
import { createAdminSupabase } from '@/lib/supabase';
import { jsonOk, jsonError } from '@/lib/api';
import { dropboxImportInput } from '@/lib/contracts';

const MAX_BYTES = 25 * 1024 * 1024;
const ALLOWED = new Set([
  'application/pdf', 'image/jpeg', 'image/png', 'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);

/** Normalize any Dropbox link to a direct-download URL. */
function toDirectDownload(raw: string): string | null {
  let url: URL;
  try { url = new URL(raw); } catch { return null; }
  const host = url.hostname.toLowerCase();
  const okHost = /(^|\.)dropbox\.com$/.test(host) || host === 'dl.dropboxusercontent.com' || host === 'dropboxusercontent.com';
  if (!okHost) return null;
  url.searchParams.set('dl', '1');
  // rlkey (present on shared links) must be preserved — just leave searchParams otherwise intact
  return url.toString();
}

const MIME_BY_EXT: Record<string, string> = {
  pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
  doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = dropboxImportInput.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return jsonError(422, 'validation', 'Provide 1–10 Dropbox links');

  const admin = createAdminSupabase();
  const { data: order } = await admin.from('orders').select('id, shop_id, status').eq('id', id).maybeSingle();
  if (!order) return jsonError(404, 'order_not_found', 'Order not found');
  if (order.status !== 'draft') return jsonError(409, 'order_locked', 'Order already placed');

  const results: Array<{ link: string; ok: boolean; file_id?: string; page_count?: number; name?: string; error?: string }> = [];

  for (const link of parsed.data.links) {
    const direct = toDirectDownload(link);
    if (!direct) { results.push({ link, ok: false, error: 'Not a Dropbox link' }); continue; }
    try {
      const res = await fetch(direct, { redirect: 'follow', signal: AbortSignal.timeout(60_000) });
      if (!res.ok) throw new Error(`Dropbox returned ${res.status}`);
      const size = Number(res.headers.get('content-length') ?? 0);
      if (size > MAX_BYTES) throw new Error('File exceeds 25 MB');
      const buffer = Buffer.from(await res.arrayBuffer());
      if (buffer.length > MAX_BYTES) throw new Error('File exceeds 25 MB');

      // derive name + mime
      const disp = res.headers.get('content-disposition') ?? '';
      const nameMatch = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disp);
      let name = nameMatch ? decodeURIComponent(nameMatch[1]) : decodeURIComponent(new URL(link).pathname.split('/').pop() || 'dropbox-file');
      name = name.split('?')[0].slice(0, 200) || 'dropbox-file';
      const ext = name.split('.').pop()?.toLowerCase() ?? '';
      let mime = res.headers.get('content-type')?.split(';')[0] ?? '';
      if (!ALLOWED.has(mime)) mime = MIME_BY_EXT[ext] ?? mime;
      if (!ALLOWED.has(mime)) throw new Error('Unsupported file type');

      const fileId = randomUUID();
      const safeName = name.replace(/[^\w.\-() ]/g, '_').slice(-120);
      const path = `${order.shop_id}/${id}/${fileId}-${safeName}`;
      const { error: upErr } = await admin.storage.from('order-files').upload(path, buffer, { contentType: mime, upsert: false });
      if (upErr) throw new Error(upErr.message);

      let pages = 1;
      if (mime === 'application/pdf') {
        try { pages = (await PDFDocument.load(buffer, { ignoreEncryption: true })).getPageCount(); } catch { pages = 1; }
      }

      const { error: insErr } = await admin.from('order_files').insert({
        id: fileId, order_id: id, shop_id: order.shop_id, storage_path: path,
        original_name: name, mime, size_bytes: buffer.length, page_count: pages, source: 'dropbox',
      });
      if (insErr) throw new Error(insErr.message);
      results.push({ link, ok: true, file_id: fileId, page_count: pages, name });
    } catch (e) {
      results.push({ link, ok: false, error: e instanceof Error ? e.message : 'Import failed' });
    }
  }

  return jsonOk({ results });
}
