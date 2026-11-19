import { z } from 'zod';
import { getSessionProfile, jsonOk, jsonError } from '@/lib/api';
import { createAdminSupabase } from '@/lib/supabase';

const actionInput = z.object({ action: z.enum(['approve', 'reject', 'request_changes']), note: z.string().max(500).optional() });

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSessionProfile();
  if (!session || session.profile?.role !== 'admin') return jsonError(403, 'forbidden', 'Admin only');

  const parsed = actionInput.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return jsonError(422, 'validation', 'Invalid action');

  const admin = createAdminSupabase();
  const { data: shop } = await admin.from('shops').select('id, owner_id').eq('id', id).maybeSingle();
  if (!shop) return jsonError(404, 'not_found', 'Shop not found');

  const { action } = parsed.data;
  const update =
    action === 'approve'
      ? { kyc_status: 'approved', status: 'active', updated_at: new Date().toISOString() }
      : action === 'reject'
        ? { kyc_status: 'rejected', status: 'suspended', updated_at: new Date().toISOString() }
        : { kyc_status: 'changes_requested', status: 'paused', updated_at: new Date().toISOString() };

  const { error } = await admin.from('shops').update(update).eq('id', id);
  if (error) return jsonError(500, 'db', error.message);
  if (action === 'approve') {
    await admin.from('shop_staff').upsert({ shop_id: id, user_id: shop.owner_id, role: 'owner' }, { onConflict: 'shop_id,user_id' });
  }
  return jsonOk({ ok: true, action });
}
