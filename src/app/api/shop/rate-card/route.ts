import { assertStaffOfShop, jsonOk, jsonError } from '@/lib/api';
import { createAdminSupabase } from '@/lib/supabase';
import { getStaffContext } from '@/lib/api';
import { rateCardPutInput } from '@/lib/contracts';

async function shopIdFor(req: Request) {
  const staff = await getStaffContext();
  if (!staff || staff.shopIds.length === 0) return null;
  const url = new URL(req.url);
  const shopId = url.searchParams.get('shop_id') ?? staff.shopIds[0];
  return staff.shopIds.includes(shopId) || staff.isAdmin ? shopId : null;
}

export async function GET(req: Request) {
  const shopId = await shopIdFor(req);
  if (!shopId) return jsonError(403, 'forbidden', 'No shop');
  const admin = createAdminSupabase();
  const { data, error } = await admin.from('rate_card')
    .select('service, paper_size, color, sides, paper_gsm, option, unit, price_paise')
    .eq('shop_id', shopId).order('service').order('price_paise');
  if (error) return jsonError(500, 'db', error.message);
  return jsonOk({ rows: data ?? [] });
}

export async function PUT(req: Request) {
  const staff = await getStaffContext();
  if (!staff) return jsonError(401, 'unauthorized', 'Sign in required');
  const parsed = rateCardPutInput.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return jsonError(422, 'validation', parsed.error.issues[0]?.message ?? 'Invalid rate card');

  const url = new URL(req.url);
  const shopId = url.searchParams.get('shop_id') ?? staff.shopIds[0];
  if (!shopId) return jsonError(403, 'forbidden', 'No shop');
  const assert = await assertStaffOfShop(shopId);
  if (!assert) return jsonError(403, 'forbidden', 'Not your shop');

  const admin = createAdminSupabase();
  const { error: delErr } = await admin.from('rate_card').delete().eq('shop_id', shopId);
  if (delErr) return jsonError(500, 'db', delErr.message);
  const rows = parsed.data.rows.map((r) => ({ ...r, shop_id: shopId }));
  const { error: insErr } = await admin.from('rate_card').insert(rows);
  if (insErr) return jsonError(500, 'db', insErr.message);
  return jsonOk({ ok: true, count: rows.length });
}
