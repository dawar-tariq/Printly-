import { assertStaffOfShop, getStaffContext, jsonOk, jsonError } from '@/lib/api';
import { createAdminSupabase } from '@/lib/supabase';
import { settingsInput } from '@/lib/contracts';

async function shopIdFor(req: Request) {
  const staff = await getStaffContext();
  if (!staff || staff.shopIds.length === 0) return null;
  const url = new URL(req.url);
  const shopId = url.searchParams.get('shop_id') ?? staff.shopIds[0];
  return staff.shopIds.includes(shopId) || staff.isAdmin ? shopId : null;
}

export async function PUT(req: Request) {
  const shopId = await shopIdFor(req);
  if (!shopId) return jsonError(403, 'forbidden', 'No shop');
  const assert = await assertStaffOfShop(shopId);
  if (!assert) return jsonError(403, 'forbidden', 'Not your shop');

  const parsed = settingsInput.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return jsonError(422, 'validation', parsed.error.issues[0]?.message ?? 'Invalid settings');
  const { services, ...fields } = parsed.data;
  const admin = createAdminSupabase();

  if (Object.keys(fields).length > 0) {
    const update: Record<string, unknown> = { ...fields, updated_at: new Date().toISOString() };
    const { error } = await admin.from('shops').update(update).eq('id', shopId);
    if (error) return jsonError(500, 'db', error.message);
  }
  if (services) {
    for (const s of services) {
      await admin.from('shop_services').upsert(
        { shop_id: shopId, service: s.service, enabled: s.enabled },
        { onConflict: 'shop_id,service' },
      );
    }
  }
  return jsonOk({ ok: true });
}
