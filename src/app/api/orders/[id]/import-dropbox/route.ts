import { readJsonBody } from '@/lib/request-body';
import { randomUUID } from 'node:crypto';
import { createAdminSupabase } from '@/lib/supabase';
import { enforceDraftRateLimit, enforcePublicRateLimit } from '@/lib/rate-limit';
import { jsonOk, jsonError } from '@/lib/api';
import { dropboxImportInput } from '@/lib/contracts';
import { requestHasDraftAccess } from '@/lib/draft-access';
import { ALLOWED_FILE_MIMES, FileValidationError, inspectUploadedFile, MAX_FILE_BYTES, MAX_ORDER_FILES } from '@/lib/upload-files';
import { discardFileObject } from '@/lib/draft-mutation';

class DropboxImportError extends Error {}

function isDropboxUrl(url: URL) {
  const host = url.hostname.toLowerCase();
  return url.protocol === 'https:' && !url.username && !url.password && (!url.port || url.port === '443') &&
    (/(^|\.)dropbox\.com$/.test(host) || /(^|\.)dropboxusercontent\.com$/.test(host) || host === 'content.dropboxapi.com');
}

/** Check each redirect, not just the original URL, before requesting it. */
async function fetchDropbox(raw: string) {
  let url = new URL(raw);
  if (!isDropboxUrl(url)) throw new DropboxImportError('Not a Dropbox link');
  url.searchParams.set('dl', '1');
  for (let i = 0; i < 6; i++) {
    const response = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(60_000) });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) throw new DropboxImportError('Dropbox returned an invalid redirect');
      url = new URL(location, url);
      if (!isDropboxUrl(url)) throw new DropboxImportError('Dropbox link redirected to an unsupported site');
      continue;
    }
    if (!response.ok) throw new DropboxImportError(`Dropbox returned ${response.status}`);
    return response;
  }
  throw new DropboxImportError('Too many Dropbox redirects');
}

async function readLimited(response: Response) {
  const declared = Number(response.headers.get('content-length') ?? 0);
  if (declared > MAX_FILE_BYTES) throw new DropboxImportError('File exceeds 25 MB');
  if (!response.body) throw new DropboxImportError('Dropbox returned an empty file');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > MAX_FILE_BYTES) { await reader.cancel().catch(() => {}); throw new DropboxImportError('File exceeds 25 MB'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), size);
}

const MIME_BY_EXT: Record<string, string> = {
  pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
  doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!requestHasDraftAccess(req, id)) return jsonError(403, 'draft_session', 'Your order session expired. Please start a new order.');
  const limited = await enforcePublicRateLimit(req, 'dropbox_import');
  if (limited) return limited;
  const parsed = dropboxImportInput.safeParse(await readJsonBody(req));
  if (!parsed.success) return jsonError(422, 'validation', 'Provide 1–10 Dropbox links');
  const admin = createAdminSupabase();
  const { data: order } = await admin.from('orders').select('id, shop_id, status, payment_method').eq('id', id).maybeSingle();
  if (!order) return jsonError(404, 'order_not_found', 'Order not found');
  if (order.status !== 'draft' || order.payment_method) return jsonError(409, 'order_locked', 'Files cannot be changed after checkout starts.');
  const { count, error: countError } = await admin.from('order_files').select('id', { count: 'exact', head: true }).eq('order_id', id);
  if (countError) return jsonError(500, 'db', 'Could not check the number of files.');
  const draftLimited = await enforceDraftRateLimit(id, 'draft_dropbox_import');
  if (draftLimited) return draftLimited;
  let fileCount = count ?? 0;
  const results: Array<{ link: string; ok: boolean; file_id?: string; page_count?: number | null; name?: string; mime?: string; size?: number; error?: string }> = [];
  for (const link of parsed.data.links) {
    if (fileCount >= MAX_ORDER_FILES) { results.push({ link, ok: false, error: `Maximum ${MAX_ORDER_FILES} files per order` }); continue; }
    let uploaded: { path: string; fileId: string; name: string; mime: string; size: number; pageCount: number | null } | null = null;
    try {
      const res = await fetchDropbox(link);
      const buffer = await readLimited(res);
      const disp = res.headers.get('content-disposition') ?? '';
      const nameMatch = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disp);
      let name = nameMatch ? decodeURIComponent(nameMatch[1]) : decodeURIComponent(new URL(link).pathname.split('/').pop() || 'dropbox-file');
      name = name.split('?')[0].slice(0, 200) || 'dropbox-file';
      const ext = name.split('.').pop()?.toLowerCase() ?? '';
      let mime = res.headers.get('content-type')?.split(';')[0] ?? '';
      if (!ALLOWED_FILE_MIMES.has(mime)) mime = MIME_BY_EXT[ext] ?? mime;
      const info = await inspectUploadedFile(buffer, mime);
      const fileId = randomUUID();
      const safeName = name.replace(/[^\w.\-() ]/g, '_').slice(-120) || 'file';
      const path = `${order.shop_id}/${id}/${fileId}-${safeName}`;
      // Keep the candidate even when an upload request loses its response; it
      // may have created an object and needs guarded cleanup.
      uploaded = { path, fileId, name, mime, size: info.size, pageCount: info.pages };
      const { error: upErr } = await admin.storage.from('order-files').upload(path, buffer, { contentType: mime, upsert: false });
      if (upErr) throw new DropboxImportError('Could not upload the Dropbox file. Please retry.');
      const { error: insErr } = await admin.from('order_files').insert({
        id: fileId, order_id: id, shop_id: order.shop_id, storage_path: path,
        original_name: name, mime, size_bytes: info.size, page_count: info.pages, source: 'dropbox',
      });
      if (insErr) throw new DropboxImportError('Could not finish importing the Dropbox file.');
      uploaded = null;
      fileCount++;
      results.push({ link, ok: true, file_id: fileId, page_count: info.pages, name, mime, size: info.size });
    } catch (e) {
      if (uploaded) {
        // An insert can commit even if its response is lost. Recover the row
        // before cleanup; never delete a path referenced by an order.
        let saved: { storage_path?: string } | null = null;
        try {
          const lookup = await admin.from('order_files').select('id, storage_path')
            .eq('id', uploaded.fileId).eq('order_id', id).maybeSingle();
          saved = lookup.data;
        } catch (lookupError) { console.error('Could not check an imported file:', lookupError); }
        if (saved?.storage_path === uploaded.path) {
          fileCount++;
          results.push({ link, ok: true, file_id: uploaded.fileId, page_count: uploaded.pageCount, name: uploaded.name, mime: uploaded.mime, size: uploaded.size });
          continue;
        }
        try {
          const discarded = await discardFileObject(admin, id, uploaded.fileId, uploaded.path);
          if (discarded.error || !discarded.cleaned) throw new Error(discarded.error?.message ?? 'storage cleanup failed');
        } catch (cleanupError) {
          console.error('Could not safely clean up a Dropbox import:', cleanupError);
          results.push({ link, ok: false, error: 'The import result could not be confirmed or cleaned up. Please contact the shop before retrying.' });
          continue;
        }
      }
      const message = e instanceof DropboxImportError || e instanceof FileValidationError
        ? e.message : 'Could not import the Dropbox file. Please try again.';
      results.push({ link, ok: false, error: message });
    }
  }
  return jsonOk({ results }, { headers: { 'Cache-Control': 'private, no-store' } });
}
