import { createAdminSupabase } from '@/lib/supabase';
import { jsonOk, jsonError } from '@/lib/api';
import { itemsReplaceInput } from '@/lib/contracts';
import { requestHasDraftAccess } from '@/lib/draft-access';
import { WORD_MIMES } from '@/lib/upload-files';
import { draftMutationError } from '@/lib/draft-mutation';

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!requestHasDraftAccess(req, id)) return jsonError(403, 'draft_session', 'Your order session expired. Please start a new order.');
  const parsed = itemsReplaceInput.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return jsonError(422, 'validation', parsed.error.issues[0]?.message ?? 'Invalid items');

  const admin = createAdminSupabase();
  const { data: order } = await admin.from('orders').select('id, status, payment_method').eq('id', id).maybeSingle();
  if (!order) return jsonError(404, 'order_not_found', 'Order not found');
  if (order.status !== 'draft' || order.payment_method) return jsonError(409, 'order_locked', 'Options cannot be changed after checkout starts.');

  if (parsed.data.items.some((item) => !item.file_id)) return jsonError(422, 'invalid_file', 'Each item must be linked to a file in this order.');
  const fileIds = [...new Set(parsed.data.items.map((item) => item.file_id).filter((fileId): fileId is string => !!fileId))];
  if (fileIds.length) {
    const { data: files, error } = await admin.from('order_files').select('id, mime, page_count').eq('order_id', id).in('id', fileIds);
    if (error) return jsonError(500, 'db', 'Could not verify your files.');
    const fileMap = new Map((files ?? []).map((file) => [file.id, file]));
    for (const item of parsed.data.items) {
      if (!item.file_id) continue;
      const file = fileMap.get(item.file_id);
      if (!file) return jsonError(422, 'invalid_file', 'A selected file is missing from this order.');
      if (item.service === 'bind') {
        if (item.pages !== 1) return jsonError(422, 'invalid_pages', 'Binding is priced per set.');
      } else if (!WORD_MIMES.has(file.mime) && (!file.page_count || item.pages !== file.page_count)) {
        return jsonError(422, 'invalid_pages', 'The page count does not match the uploaded file. Please re-upload it.');
      }
    }
  }

  const rows = parsed.data.items.map((i) => ({
    order_id: id, file_id: i.file_id ?? null, service: i.service,
    paper_size: i.paper_size ?? 'A4', color: i.color ?? 'bw', sides: i.sides ?? 'single',
    paper_gsm: i.paper_gsm ?? 80, option: i.option ?? null,
    binding: i.service === 'bind' ? (i.option ?? 'none') : 'none', lamination: i.service === 'laminate',
    copies: i.copies, pages: i.pages, unit_price_paise: 0, line_total_paise: 0,
  }));
  // The database repeats the file/count checks while holding the order lock,
  // then replaces all lines in one transaction.
  const { data: count, error } = await admin.rpc('replace_draft_items', { p_order_id: id, p_rows: rows });
  if (error) return draftMutationError(error);
  return jsonOk({ ok: true, count: count ?? rows.length }, { headers: { 'Cache-Control': 'private, no-store' } });
}
