import { readJsonBody } from '@/lib/request-body';
import { z } from 'zod';
import { getSessionProfile, jsonOk, jsonError } from '@/lib/api';
import { createAdminSupabase } from '@/lib/supabase';

const actionInput = z.object({
  action: z.enum(['approve', 'reject', 'request_changes', 'suspend', 'activate']),
  note: z.string().max(1000).optional(),
  proof_reviewed: z.boolean().optional(),
});

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSessionProfile();
  if (!session || session.profile?.role !== 'admin') return jsonError(403, 'forbidden', 'Admin only');

  const parsed = actionInput.safeParse(await readJsonBody(req));
  if (!parsed.success) return jsonError(422, 'validation', 'Invalid action');

  const admin = createAdminSupabase();
  const { data: shop } = await admin.from('shops').select('id, owner_id, kyc_status, updated_at').eq('id', id).maybeSingle();
  if (!shop) return jsonError(404, 'not_found', 'Shop not found');

  const { action, note, proof_reviewed } = parsed.data;
  if (action === 'approve') {
    const { data: onboarding, error: proofError } = await admin.from('shop_onboarding')
      .select('duplicate_name, name_proof_gstin, name_proof_photo_path').eq('shop_id', id).maybeSingle();
    if (proofError) return jsonError(500, 'db', 'Could not check the name proof.');
    if (onboarding?.duplicate_name) {
      if (!onboarding.name_proof_gstin && !onboarding.name_proof_photo_path) return jsonError(409, 'proof_missing', 'Duplicate-name proof is missing. Request changes before approving.');
      if (!proof_reviewed) return jsonError(409, 'proof_review_required', 'Review and confirm the duplicate-name proof on the shop detail page before approving.');
    }
  }
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

  const { data: updated, error } = await admin.from('shops').update(update).eq('id', id).eq('updated_at', shop.updated_at).select('id').maybeSingle();
  if (error) {
    console.error('Could not update shop review:', error.code);
    return jsonError(503, 'db', 'Could not update the shop review. Please try again.');
  }
  if (!updated) return jsonError(409, 'shop_changed', 'The shop changed during review. Refresh the page and review it again.');
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
