import { z } from 'zod';
import { getSessionProfile, jsonError, jsonOk } from '@/lib/api';
import { readJsonBody } from '@/lib/request-body';
import { createAdminSupabase } from '@/lib/supabase';
import { subscriptionMutationError } from '@/lib/subscription-server';

const input = z.object({ shop_id: z.string().uuid() }).strict();
export async function POST(request: Request) {
  const session = await getSessionProfile();
  if (!session || session.profile?.role !== 'admin') return jsonError(403, 'forbidden', 'Admin only.');
  const parsed = input.safeParse(await readJsonBody(request));
  if (!parsed.success) return jsonError(422, 'validation', 'Choose a valid shop.');
  const { data, error } = await createAdminSupabase().rpc('grant_shop_pilot', { p_shop_id: parsed.data.shop_id, p_actor: session.user.id });
  if (error) return subscriptionMutationError(error);
  if (!data) return jsonError(503, 'db', 'Could not grant pilot access.');
  return jsonOk({ ok: true, pilot: data }, { headers: { 'Cache-Control': 'private, no-store' } });
}
