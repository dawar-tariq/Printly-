import { readJsonBody } from '@/lib/request-body';
import { z } from 'zod';
import { assertStaffOfShop, jsonOk, jsonError } from '@/lib/api';
import { createAdminSupabase } from '@/lib/supabase';

const patchInput = z.object({
  set_qty: z.number().min(0).max(1_000_000).optional(),
  adjust: z.number().min(-1_000_000).max(1_000_000).optional(),
  low_stock_threshold: z.number().min(0).max(1_000_000).optional(),
  name: z.string().min(1).max(80).optional(),
  unit: z.string().min(1).max(20).optional(),
});

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = patchInput.safeParse(await readJsonBody(req));
  if (!parsed.success) return jsonError(422, 'validation', 'Invalid patch');
  const admin = createAdminSupabase();
  const { data: item, error: readError } = await admin.from('inventory_items').select('*').eq('id', id).maybeSingle();
  if (readError) return jsonError(503, 'db', 'Could not load inventory. Please try again.');
  if (!item) return jsonError(404, 'not_found', 'Item not found');
  const staff = await assertStaffOfShop(item.shop_id);
  if (!staff) return jsonError(403, 'forbidden', 'Not your shop');

  if (parsed.data.set_qty !== undefined && parsed.data.adjust !== undefined) return jsonError(422, 'validation', 'Choose either a quantity or an adjustment.');
  const update: Record<string, unknown> = {};
  if (parsed.data.set_qty !== undefined) update.qty = parsed.data.set_qty;
  if (parsed.data.adjust !== undefined) {
    const nextQuantity = Math.max(0, Number(item.qty) + parsed.data.adjust);
    if (!Number.isFinite(nextQuantity) || nextQuantity > 1_000_000) return jsonError(422, 'validation', 'Quantity cannot exceed 1,000,000.');
    update.qty = nextQuantity;
  }
  if (parsed.data.low_stock_threshold !== undefined) update.low_stock_threshold = parsed.data.low_stock_threshold;
  if (parsed.data.name) update.name = parsed.data.name;
  if (parsed.data.unit) update.unit = parsed.data.unit;

  // Prevent two phones adjusting the same stale quantity from silently
  // overwriting one another. A conflict is safe to refresh and retry.
  let write = admin.from('inventory_items').update(update).eq('id', id).eq('shop_id', item.shop_id);
  if (parsed.data.adjust !== undefined || parsed.data.set_qty !== undefined) write = write.eq('qty', item.qty);
  const { data: saved, error } = await write.select('id').maybeSingle();
  if (error) {
    console.error('Could not update inventory:', error.code);
    return jsonError(503, 'db', 'Could not update inventory. Please try again.');
  }
  if (!saved) return jsonError(409, 'stock_changed', 'Stock changed on another device. Refresh before adjusting again.');
  return jsonOk({ ok: true });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const admin = createAdminSupabase();
  const { data: item, error: readError } = await admin.from('inventory_items').select('shop_id').eq('id', id).maybeSingle();
  if (readError) return jsonError(503, 'db', 'Could not load inventory. Please try again.');
  if (!item) return jsonError(404, 'not_found', 'Item not found');
  const staff = await assertStaffOfShop(item.shop_id);
  if (!staff) return jsonError(403, 'forbidden', 'Not your shop');
  const { error } = await admin.from('inventory_items').delete().eq('id', id);
  if (error) {
    console.error('Could not delete inventory:', error.code);
    return jsonError(503, 'db', 'Could not delete inventory. Please try again.');
  }
  return jsonOk({ ok: true });
}
