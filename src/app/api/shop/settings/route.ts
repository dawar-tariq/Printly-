import { getStaffContext, jsonOk, jsonError } from '@/lib/api';
import { createAdminSupabase } from '@/lib/supabase';
import { settingsInput } from '@/lib/contracts';
import { isDefiniteDatabaseRejection } from '@/lib/database-error';
import { proofSubmissionError, readProofSubmission, removePhotoProof, uploadPhotoProof } from '@/lib/name-proof';

async function shopIdFor(req: Request) {
  const staff = await getStaffContext();
  if (!staff || staff.isAdmin || staff.shopIds.length === 0) return null;
  const shopId = new URL(req.url).searchParams.get('shop_id') ?? staff.shopIds[0];
  return staff.shopIds.includes(shopId) ? shopId : null;
}

export async function PUT(req: Request) {
  const shopId = await shopIdFor(req);
  if (!shopId) return jsonError(403, 'forbidden', 'Not your shop');
  let submission: Awaited<ReturnType<typeof readProofSubmission>>;
  try { submission = await readProofSubmission(req); }
  catch (error) { return jsonError(422, 'validation', proofSubmissionError(error)); }
  const parsed = settingsInput.safeParse(submission.payload);
  if (!parsed.success) return jsonError(422, 'validation', parsed.error.issues[0]?.message ?? 'Invalid settings');
  const { services, ...fields } = parsed.data;
  const admin = createAdminSupabase();
  let photoPath: string | null = null;
  if (submission.photo) {
    try { photoPath = await uploadPhotoProof(admin, shopId, submission.photo); }
    catch { return jsonError(503, 'proof_upload', 'Could not upload your shop photo. Please try again.'); }
  }

  const unconfirmed = () => jsonError(503, 'update_unconfirmed', 'We could not confirm whether your shop details were saved. Check them before retrying or contact an administrator.');
  let result;
  try {
    result = await admin.rpc('update_shop_identity', {
      p_shop_id: shopId, p_fields: fields, p_photo_path: photoPath,
    });
  } catch { return unconfirmed(); }
  const { data: identity, error } = result;
  if (error || !identity) {
    // A gateway/network error may hide a committed update that references this
    // photo. Only delete the new object after a definite database rejection.
    if (!isDefiniteDatabaseRejection(error)) return unconfirmed();
    await removePhotoProof(admin, photoPath);
    if (error?.message.includes('DUPLICATE_NAME_PROOF_REQUIRED')) {
      return jsonError(409, 'duplicate_name_requires_proof', 'This name is already in use. Add a shop photo or a valid-format GSTIN for review.');
    }
    console.error('Shop profile update failed:', error?.message);
    return jsonError(500, 'db', 'Could not save your shop details. Please try again.');
  }
  if (typeof identity.duplicate_name !== 'boolean' || typeof identity.name_changed !== 'boolean' ||
      (identity.old_photo_path !== null && typeof identity.old_photo_path !== 'string')) return unconfirmed();
  if (!identity.duplicate_name) await removePhotoProof(admin, photoPath);
  if (identity.name_changed && identity.old_photo_path && identity.old_photo_path !== photoPath) {
    await removePhotoProof(admin, identity.old_photo_path);
  }

  if (services) {
    for (const service of services) {
      const { error: serviceError } = await admin.from('shop_services').upsert(
        { shop_id: shopId, service: service.service, enabled: service.enabled },
        { onConflict: 'shop_id,service' },
      );
      if (serviceError) return jsonError(500, 'db', 'Shop details saved, but services could not be updated. Please try again.');
    }
  }
  return jsonOk({ ok: true, duplicate_name: identity.duplicate_name });
}
