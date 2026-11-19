import { z } from 'zod';
import { getSessionProfile, jsonOk, jsonError } from '@/lib/api';
import { createAdminSupabase } from '@/lib/supabase';

const patchInput = z.object({ action: z.enum(['paid', 'failed', 'processing']), utr: z.string().max(40).optional() });

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSessionProfile();
  if (!session || session.profile?.role !== 'admin') return jsonError(403, 'forbidden', 'Admin only');
  const parsed = patchInput.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return jsonError(422, 'validation', 'Invalid action');

  const admin = createAdminSupabase();
  const update: Record<string, unknown> = { status: parsed.data.action };
  if (parsed.data.action === 'paid') {
    update.paid_at = new Date().toISOString();
    if (parsed.data.utr) update.utr = parsed.data.utr;
  }
  const { error } = await admin.from('payouts').update(update).eq('id', id);
  if (error) return jsonError(500, 'db', error.message);
  return jsonOk({ ok: true });
}
