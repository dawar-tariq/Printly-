import { z } from 'zod';
import { getStaffContext, jsonOk, jsonError } from '@/lib/api';
import { createAdminSupabase } from '@/lib/supabase';
import { readJsonBody } from '@/lib/request-body';

const input = z.object({ is_open: z.boolean() }).strict();

/** This is independent of admin approval and subscription entitlement. */
export async function PUT(req: Request) {
  const staff = await getStaffContext({ allowExpired: true });
  if (!staff || staff.isAdmin || staff.membershipError || !staff.shopIds.length) return jsonError(403, 'forbidden', 'Only the shop owner can change availability.');
  const parsed = input.safeParse(await readJsonBody(req));
  if (!parsed.success) return jsonError(422, 'validation', 'Choose open or closed.');
  try {
    const { data, error } = await createAdminSupabase().rpc('set_shop_open', {
      p_shop_id: staff.shopIds[0], p_actor_id: staff.user.id, p_is_open: parsed.data.is_open,
    });
    if (error?.message?.includes('SHOP_OWNER_REQUIRED')) return jsonError(403, 'forbidden', 'Only the shop owner can change availability.');
    if (!error && typeof data === 'boolean') return jsonOk({ is_open: data }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch { /* The write may have committed even if the response was lost. */ }
  return jsonError(503, 'update_unconfirmed', 'Could not confirm the change. Refresh the shop status before trying again.');
}
