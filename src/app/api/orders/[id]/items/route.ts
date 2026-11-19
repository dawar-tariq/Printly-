import { createAdminSupabase } from '@/lib/supabase';
import { jsonOk, jsonError } from '@/lib/api';
import { itemsReplaceInput } from '@/lib/contracts';

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = itemsReplaceInput.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return jsonError(422, 'validation', parsed.error.issues[0]?.message ?? 'Invalid items');

  const admin = createAdminSupabase();
  const { data: order } = await admin.from('orders').select('id, status').eq('id', id).maybeSingle();
  if (!order) return jsonError(404, 'order_not_found', 'Order not found');
  if (order.status !== 'draft') return jsonError(409, 'order_locked', 'Order already placed');

  const rows = parsed.data.items.map((i) => ({
    order_id: id,
    file_id: i.file_id ?? null,
    service: i.service,
    paper_size: i.paper_size ?? 'A4',
    color: i.color ?? 'bw',
    sides: i.sides ?? 'single',
    paper_gsm: i.paper_gsm ?? 80,
    option: i.option ?? null,
    binding: i.service === 'bind' ? (i.option ?? 'none') : 'none',
    lamination: i.service === 'laminate',
    copies: i.copies,
    pages: i.pages,
    unit_price_paise: 0, // filled by quote/pay recomputation
    line_total_paise: 0,
  }));

  const { error: delErr } = await admin.from('order_items').delete().eq('order_id', id);
  if (delErr) return jsonError(500, 'db', delErr.message);
  if (rows.length > 0) {
    const { error: insErr } = await admin.from('order_items').insert(rows);
    if (insErr) return jsonError(500, 'db', insErr.message);
  }
  return jsonOk({ ok: true, count: rows.length });
}
