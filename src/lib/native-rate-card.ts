import 'server-only';
import { z } from 'zod';
import { assertStaffOfShop, getStaffContext, jsonError, jsonOk } from '@/lib/api';
import { createAdminSupabase } from '@/lib/supabase';
import { rateCardRowInput } from '@/lib/contracts';
import { readJsonBody } from '@/lib/request-body';

const fields = ['service', 'paper_size', 'color', 'sides', 'paper_gsm', 'option', 'unit', 'price_paise'] as const;
const changeInput = z.object({ expected: rateCardRowInput, price_paise: z.number().int().min(0).max(1_000_000) }).strict();
type Context = { params: Promise<{ id: string }> };

/** Include stable row IDs, and fail closed if a backend page limit truncates the list. */
export async function GET(req: Request) {
  const staff = await getStaffContext();
  if (!staff || staff.isAdmin || !staff.shopIds.length) return jsonError(403, 'forbidden', 'Shop sign-in required.');
  const shopId = new URL(req.url).searchParams.get('shop_id') ?? staff.shopIds[0];
  if (!staff.shopIds.includes(shopId)) return jsonError(403, 'forbidden', 'Not your shop.');
  const { data, count, error } = await createAdminSupabase().from('rate_card')
    .select('id, service, paper_size, color, sides, paper_gsm, option, unit, price_paise', { count: 'exact' })
    .eq('shop_id', shopId).order('service').order('id').limit(120);
  if (error || count === null || !Array.isArray(data) || data.length !== count) {
    return jsonError(503, 'incomplete', 'Could not load the complete rate card. Please retry.');
  }
  return jsonOk({ rows: data }, { headers: { 'Cache-Control': 'private, no-store' } });
}

/**
 * Only change one existing price. Match every dimension and previous price in
 * the UPDATE so a stale native screen cannot overwrite a concurrent edit or a
 * full web replacement. Adding/removing/changing dimensions is deliberately
 * not implemented until an atomic compare-and-replace backend exists.
 */
export async function PATCH(req: Request, { params }: Context) {
  const { id } = await params;
  const parsed = changeInput.safeParse(await readJsonBody(req));
  if (!parsed.success) return jsonError(422, 'validation', 'Invalid rate change. Refresh and try again.');
  const admin = createAdminSupabase();
  const { data: row, error: lookupError } = await admin.from('rate_card').select('shop_id').eq('id', id).maybeSingle();
  if (lookupError) return jsonError(503, 'db', 'Could not load this rate. Please retry.');
  if (!row) return jsonError(404, 'not_found', 'This rate no longer exists. Refresh the rate card.');
  if (!await assertStaffOfShop(row.shop_id)) return jsonError(403, 'forbidden', 'Not your shop.');
  let update = admin.from('rate_card').update({ price_paise: parsed.data.price_paise }).eq('id', id).eq('shop_id', row.shop_id);
  for (const field of fields) {
    const value = parsed.data.expected[field];
    update = value === null ? update.is(field, null) : update.eq(field, value);
  }
  const { data, error } = await update.select('id').maybeSingle();
  if (error) return jsonError(503, 'update_unconfirmed', 'Could not confirm the rate change. Refresh before retrying.');
  if (!data) return jsonError(409, 'rate_changed', 'This rate changed on another device. Refresh and review it before retrying.');
  return jsonOk({ ok: true }, { headers: { 'Cache-Control': 'private, no-store' } });
}
