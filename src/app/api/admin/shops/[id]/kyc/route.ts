import { z } from 'zod';
import { getSessionProfile, jsonOk, jsonError } from '@/lib/api';
import { createAdminSupabase } from '@/lib/supabase';

const actionInput = z.object({
  action: z.enum(['approve', 'reject', 'request_changes', 'suspend', 'activate']),
  note: z.string().max(1000).optional(),
});

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSessionProfile();
  if (!session || session.profile?.role !== 'admin') return jsonError(403, 'forbidden', 'Admin only');

  const parsed = actionInput.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return jsonError(422, 'validation', 'Invalid action');

  const admin = createAdminSupabase();
  const { data: shop } = await admin.from('shops').select('id, owner_id, kyc_status').eq('id', id).maybeSingle();
  if (!shop) return jsonError(404, 'not_found', 'Shop not found');

  const { action, note } = parsed.data;
  const now = new Date().toISOString();
  let update: Record<string, unknown>;
  switch (action) {
    case 'approve':
      update = { kyc_status: 'approved', status: 'active', updated_at: now };
      break;
    case 'reject':
      update = { kyc_status: 'rejected', status: 'suspended', updated_at: now };
      break;
    case 'request_changes':
      update = { kyc_status: 'changes_requested', status: 'paused', updated_at: now };
      break;
    case 'suspend':
      update = { status: 'suspended', updated_at: now };
      break;
    case 'activate':
      update = { status: shop.kyc_status === 'approved' ? 'active' : 'paused', updated_at: now };
      break;
    default:
      return jsonError(422, 'validation', 'Invalid action');
  }

  const { error } = await admin.from('shops').update(update).eq('id', id);
  if (error) return jsonError(500, 'db', error.message);
  if (action === 'approve') {
    await admin.from('shop_staff').upsert({ shop_id: id, user_id: shop.owner_id, role: 'owner' }, { onConflict: 'shop_id,user_id' });
  }

  // Persist the review note + reviewer so the shop owner can see what was asked.
  if (note?.trim()) {
    await admin.from('shop_onboarding').upsert(
      { shop_id: id, review_note: note.trim(), reviewed_at: now, reviewed_by: session.user.id },
      { onConflict: 'shop_id' },
    );
  } else if (['approve', 'reject', 'request_changes'].includes(action)) {
    await admin.from('shop_onboarding').upsert(
      { shop_id: id, review_note: '', reviewed_at: now, reviewed_by: session.user.id },
      { onConflict: 'shop_id' },
    );
  }

  return jsonOk({ ok: true, action });
}
