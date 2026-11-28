import { readJsonBody } from '@/lib/request-body';
import { z } from 'zod';
import { getSessionProfile, jsonError, jsonOk } from '@/lib/api';
import { createAdminSupabase } from '@/lib/supabase';
import { subscriptionMutationError } from '@/lib/subscription-server';

const input = z.object({ purchase_id: z.string().uuid(), action: z.enum(['approve', 'reject']), note: z.string().trim().max(500).default('') });
export async function POST(req: Request) {
  const session = await getSessionProfile();
  if (!session || session.profile?.role !== 'admin') return jsonError(403, 'forbidden', 'Admin only.');
  const parsed = input.safeParse(await readJsonBody(req));
  if (!parsed.success) return jsonError(422, 'validation', 'Invalid review.');
  const admin = createAdminSupabase();
  const { data, error } = await admin.rpc('review_subscription_purchase', {
    p_purchase_id: parsed.data.purchase_id, p_actor: session.user.id, p_action: parsed.data.action, p_note: parsed.data.note,
  });
  if (error) return subscriptionMutationError(error);
  return jsonOk({ ok: true, purchase: data }, { headers: { 'Cache-Control': 'private, no-store' } });
}
