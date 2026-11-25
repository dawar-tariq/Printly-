import 'server-only';

import { z } from 'zod';
import { assertStaffOfShop, jsonError, jsonOk } from '@/lib/api';
import { createAdminSupabase } from '@/lib/supabase';
import { readJsonBody } from '@/lib/request-body';

const quantity = z.number().finite().min(0).max(1_000_000);
const expectedItem = z.object({
  qty: z.number().finite(), name: z.string().max(1000), category: z.string().max(100),
  unit: z.string().max(1000), low_stock_threshold: z.number().finite(),
}).strict();
const updateInput = z.object({
  expected: expectedItem,
  set_qty: quantity.optional(),
  name: z.string().trim().min(1).max(80).optional(),
  unit: z.string().trim().min(1).max(20).optional(),
  low_stock_threshold: quantity.optional(),
}).strict().refine((value) => value.set_qty !== undefined || value.name !== undefined || value.unit !== undefined || value.low_stock_threshold !== undefined);
const deleteInput = z.object({ expected: expectedItem }).strict();
type Context = { params: Promise<{ id: string }> };

/** Compare the item the operator saw in the same atomic update. */
export async function PATCH(request: Request, context: Context) {
  const { id } = await context.params;
  const parsed = updateInput.safeParse(await readJsonBody(request));
  if (!parsed.success) return jsonError(422, 'validation', 'Invalid inventory change.');
  const admin = createAdminSupabase();
  const { data: item, error: readError } = await admin.from('inventory_items').select('shop_id').eq('id', id).maybeSingle();
  if (readError) return jsonError(503, 'db', 'Could not load inventory. Please try again.');
  if (!item) return jsonError(404, 'not_found', 'Item not found.');
  if (!await assertStaffOfShop(item.shop_id)) return jsonError(403, 'forbidden', 'Not your shop.');
  const { expected, ...fields } = parsed.data;
  const update: Record<string, unknown> = { ...fields };
  if (fields.set_qty !== undefined) { update.qty = fields.set_qty; delete update.set_qty; }
  let query = admin.from('inventory_items').update(update).eq('id', id).eq('shop_id', item.shop_id);
  for (const [field, value] of Object.entries(expected)) query = query.eq(field, value);
  const { data, error } = await query.select('id').maybeSingle();
  if (error) return jsonError(503, 'update_unconfirmed', 'Could not confirm the stock change. Refresh before retrying.');
  if (!data) return jsonError(409, 'stock_changed', 'Stock changed on another device. Refresh before changing it again.');
  return jsonOk({ ok: true }, { headers: { 'Cache-Control': 'private, no-store' } });
}

/** Refuse to remove an item if it changed since the operator saw it. */
export async function DELETE(request: Request, context: Context) {
  const { id } = await context.params;
  const parsed = deleteInput.safeParse(await readJsonBody(request));
  if (!parsed.success) return jsonError(422, 'validation', 'Refresh the item before removing it.');
  const admin = createAdminSupabase();
  const { data: item, error: readError } = await admin.from('inventory_items').select('shop_id').eq('id', id).maybeSingle();
  if (readError) return jsonError(503, 'db', 'Could not load inventory. Please try again.');
  if (!item) return jsonError(404, 'not_found', 'Item not found.');
  if (!await assertStaffOfShop(item.shop_id)) return jsonError(403, 'forbidden', 'Not your shop.');
  let query = admin.from('inventory_items').delete().eq('id', id).eq('shop_id', item.shop_id);
  for (const [field, value] of Object.entries(parsed.data.expected)) query = query.eq(field, value);
  const { data, error } = await query.select('id').maybeSingle();
  if (error) return jsonError(503, 'update_unconfirmed', 'Could not confirm removal. Refresh before retrying.');
  if (!data) return jsonError(409, 'stock_changed', 'Stock changed on another device. Refresh before removing it.');
  return jsonOk({ ok: true }, { headers: { 'Cache-Control': 'private, no-store' } });
}
