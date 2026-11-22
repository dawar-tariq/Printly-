import { z } from 'zod';
import { getStaffContext, jsonError, jsonOk } from '@/lib/api';
import { createAdminSupabase } from '@/lib/supabase';
import { isDefiniteDatabaseRejection } from '@/lib/database-error';
import { proofSubmissionError, readProofSubmission, removePhotoProof, uploadPhotoProof } from '@/lib/name-proof';
import { isGstinFormat } from '@/lib/shop-identity';

const input = z.object({ gstin: z.string().max(20).optional() });

export async function POST(req: Request) {
  const staff = await getStaffContext();
  if (!staff || staff.isAdmin || !staff.shopIds[0]) return jsonError(403, 'forbidden', 'Shop owner access required.');
  const shopId = staff.shopIds[0];
  const admin = createAdminSupabase();
  const { data: shop } = await admin.from('shops').select('owner_id').eq('id', shopId).maybeSingle();
  if (!shop || shop.owner_id !== staff.user.id) return jsonError(403, 'forbidden', 'Only the shop owner can submit name proof.');
  let submission: Awaited<ReturnType<typeof readProofSubmission>>;
  try { submission = await readProofSubmission(req); }
  catch (error) { return jsonError(422, 'validation', proofSubmissionError(error)); }
  const parsed = input.safeParse(submission.payload);
  if (!parsed.success) return jsonError(422, 'validation', 'Invalid GSTIN.');
  if (!submission.photo && !isGstinFormat(parsed.data.gstin ?? '')) {
    return jsonError(422, 'proof_required', 'Add a shop photo or a valid-format GSTIN.');
  }
  let photoPath: string | null = null;
  if (submission.photo) {
    try { photoPath = await uploadPhotoProof(admin, shopId, submission.photo); }
    catch { return jsonError(503, 'proof_upload', 'Could not upload your shop photo. Please try again.'); }
  }
  const unconfirmed = () => jsonError(503, 'proof_unconfirmed', 'We could not confirm whether your proof was submitted. Check its status before retrying or contact an administrator.');
  let result;
  try { result = await admin.rpc('resubmit_shop_name_proof', { p_shop_id: shopId, p_gstin: parsed.data.gstin || null, p_photo_path: photoPath }); }
  catch { return unconfirmed(); }
  const { data, error } = result;
  if (error || !data) {
    // A lost RPC response does not prove rollback; the new photo may already be
    // referenced by the submitted application and must not be deleted.
    if (!isDefiniteDatabaseRejection(error)) return unconfirmed();
    await removePhotoProof(admin, photoPath);
    if (error?.message.includes('PROOF_ALREADY_APPROVED')) return jsonError(409, 'already_approved', 'This shop has already been approved.');
    if (error?.message.includes('PROOF_NOT_REQUIRED')) return jsonError(409, 'proof_not_required', 'This shop does not need duplicate-name proof.');
    console.error('Name proof resubmission failed:', error?.code);
    return jsonError(500, 'db', 'Could not submit your proof. Please try again.');
  }
  if (data.old_photo_path !== null && typeof data.old_photo_path !== 'string') return unconfirmed();
  if (data.old_photo_path && data.old_photo_path !== photoPath) await removePhotoProof(admin, data.old_photo_path);
  return jsonOk({ ok: true });
}
