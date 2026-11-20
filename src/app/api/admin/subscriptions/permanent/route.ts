import { z } from 'zod';
import { getSessionProfile, jsonError, jsonOk } from '@/lib/api';
import { createAdminSupabase } from '@/lib/supabase';
import { subscriptionMutationError } from '@/lib/subscription-server';

const input = z.object({ shop_id: z.string().uuid(), enabled: z.boolean(), note: z.string().trim().max(500).default('') });
export async function POST(req: Request) {
  const session = await getSessionProfile();
  if (!session || session.profile?.role !== 'admin') return jsonError(403, 'forbidden', 'Admin only.');
  const parsed = input.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return jsonError(422, 'validation', 'Invalid subscription action.');
  const admin = createAdminSupabase();
  const { data, error } = await admin.rpc('set_shop_permanent_subscription', {
    p_shop_id: parsed.data.shop_id, p_actor: session.user.id, p_enabled: parsed.data.enabled, p_note: parsed.data.note,
  });
  if (error) return subscriptionMutationError(error);
  return jsonOk({ ok: true, subscription: data }, { headers: { 'Cache-Control': 'private, no-store' } });
}
