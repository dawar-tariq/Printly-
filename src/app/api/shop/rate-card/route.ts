import { assertStaffOfShop, jsonOk, jsonError } from '@/lib/api';
import { createAdminSupabase } from '@/lib/supabase';
import { getStaffContext } from '@/lib/api';
import { rateCardPutInput } from '@/lib/contracts';

async function shopIdFor(req: Request) {
  const staff = await getStaffContext();
  if (!staff || staff.shopIds.length === 0) return null;
  const url = new URL(req.url);
  const shopId = url.searchParams.get('shop_id') ?? staff.shopIds[0];
  return staff.shopIds.includes(shopId) ? shopId : null;
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
  const { data: count, error } = await admin.rpc('replace_shop_rate_card', { p_shop_id: shopId, p_rows: parsed.data.rows });
  if (error?.code === '23505') return jsonError(422, 'duplicate_rate', 'There are duplicate rate options. Please remove the duplicate and try again.');
  if (error) {
    console.error('Could not replace rate card:', error.message);
    return jsonError(503, 'db', 'Could not save the rate card. Please retry.');
  }
  return jsonOk({ ok: true, count: count ?? parsed.data.rows.length });
}
