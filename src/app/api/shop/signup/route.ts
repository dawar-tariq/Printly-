import { randomBytes, randomUUID } from 'crypto';
import { jsonOk, jsonError } from '@/lib/api';
import { enforcePublicRateLimit } from '@/lib/rate-limit';
import { isDefiniteDatabaseRejection } from '@/lib/database-error';
import { createAdminSupabase } from '@/lib/supabase';
import { shopSignupInput } from '@/lib/contracts';
import { isGstinFormat, normalizeGstin, publicShopPath } from '@/lib/shop-identity';
import { proofSubmissionError, readProofSubmission, removePhotoProof, uploadPhotoProof } from '@/lib/name-proof';

const SHORT_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function shortCode(len = 8) {
  return Array.from(randomBytes(len), (b) => SHORT_CODE_ALPHABET[b % SHORT_CODE_ALPHABET.length]).join('');
}

const DEFAULT_RATES: Array<[string, string | null, string | null, string | null, number | null, string | null, string, number]> = [
  ['print', 'A4', 'bw', 'single', 80, null, 'page', 200],
  ['print', 'A4', 'bw', 'duplex', 80, null, 'page', 150],
  ['print', 'A4', 'color', 'single', 80, null, 'page', 1000],
  ['print', 'A4', 'color', 'duplex', 80, null, 'page', 800],
  ['print', 'A3', 'bw', 'single', 90, null, 'page', 400],
  ['print', 'A3', 'color', 'single', 90, null, 'page', 2000],
  ['photocopy', 'A4', 'bw', null, null, null, 'page', 150],
  ['photocopy', 'A4', 'color', null, null, null, 'page', 800],
  ['scan', 'A4', 'color', null, null, null, 'page', 500],
  ['scan', 'A4', 'bw', null, null, null, 'page', 300],
  ['bind', null, null, null, null, 'staple', 'job', 1000],
  ['bind', null, null, null, null, 'spiral', 'job', 3000],
  ['bind', null, null, null, null, 'hard', 'job', 5000],
  ['laminate', 'A4', null, null, null, null, 'sheet', 1000],
  ['laminate', 'A3', null, null, null, null, 'sheet', 2000],
];


export async function POST(req: Request) {
  const limited = await enforcePublicRateLimit(req, 'signup');
  if (limited) return limited;
  let submission: Awaited<ReturnType<typeof readProofSubmission>>;
  try { submission = await readProofSubmission(req); }
  catch (error) { return jsonError(422, 'validation', proofSubmissionError(error)); }
  const parsed = shopSignupInput.safeParse(submission.payload);
  if (!parsed.success) return jsonError(422, 'validation', parsed.error.issues[0]?.message ?? 'Invalid input');
  const d = parsed.data;
  const admin = createAdminSupabase();
  const shopName = d.shop_name.trim();
  const gstin = normalizeGstin(d.gstin || (d.registration_type === 'gstin' ? d.registration_number ?? '' : ''));

  // Friendly early check, before creating an account; the locked database
  // function repeats this check atomically to handle simultaneous signups.
  const { data: duplicate, error: checkError } = await admin.rpc('shop_name_exists', { p_name: shopName, p_exclude: null });
  if (checkError) return jsonError(503, 'name_check', 'Could not check the shop name. Please try again.');
  if (duplicate && !submission.photo && !isGstinFormat(gstin)) {
    return jsonError(409, 'duplicate_name_requires_proof', 'This name is already in use. Add a shop photo or a valid-format GSTIN for review.');
  }

  const { data: created, error: signUpErr } = await admin.auth.admin.createUser({
    email: d.email.trim(), password: d.password, email_confirm: true, user_metadata: { full_name: d.owner_name.trim() },
  });
  if (signUpErr || !created.user) {
    console.error('Could not create a shop account:', signUpErr?.code);
    return jsonError(422, 'signup', 'Could not create your account. Check your details or sign in if you already have an account.');
  }
  const userId = created.user.id;
  const shopId = randomUUID();
  let photoPath: string | null = null;
  const cleanup = async () => {
    await removePhotoProof(admin, photoPath);
    try {
      const { error } = await admin.auth.admin.deleteUser(userId);
      if (error) console.error('Could not remove an incomplete signup:', error.message);
    } catch { console.error('Could not remove an incomplete signup: authentication unavailable'); }
  };
  const received = (code: string, duplicateName?: boolean) => jsonOk({
    ok: true, short_code: code, customer_path: publicShopPath(code),
    ...(duplicateName === undefined ? {} : { duplicate_name: duplicateName }),
    message: 'Application received — your shop will be reviewed before it goes live.',
  });
  const unconfirmedApplication = async () => {
    // The RPC may have committed even when its response was lost. A positive
    // lookup lets us recover the real code; a missing/failed lookup does NOT
    // prove rollback while the original request may still be in flight.
    try {
      const { data, error } = await admin.from('shops').select('owner_id,short_code').eq('id', shopId).maybeSingle();
      if (!error && data?.owner_id === userId && typeof data.short_code === 'string' && /^[A-HJ-NP-Z2-9]{8}$/.test(data.short_code)) {
        return received(data.short_code);
      }
    } catch { /* Leave the account and any proof intact for operator review. */ }
    console.error('Shop application outcome is unconfirmed; operator review may be needed:', shopId);
    return jsonError(503, 'signup_unconfirmed', 'We could not confirm your application. Try signing in before submitting again, or contact an administrator.');
  };
  if (submission.photo) {
    try { photoPath = await uploadPhotoProof(admin, shopId, submission.photo); }
    catch { await cleanup(); return jsonError(503, 'proof_upload', 'Could not upload your shop photo. Please try again.'); }
  }

  const rates = DEFAULT_RATES.map(([service, paper_size, color, sides, paper_gsm, option, unit, price_paise]) => ({
    service, paper_size, color, sides, paper_gsm, option, unit, price_paise,
  }));
  const onboarding = {
    business_type: d.business_type ?? 'other', legal_business_name: d.legal_business_name || null,
    year_established: d.year_established ?? null, staff_count: d.staff_count ?? 1,
    printer_count: d.printer_count ?? 1, avg_daily_jobs: d.avg_daily_jobs ?? 0,
    printer_details: d.printer_details ?? '', pincode: d.pincode ?? '', alternate_phone: d.alternate_phone || null,
    registration_type: d.registration_type ?? 'unregistered', registration_number: d.registration_number || null,
    business_hours: d.business_hours ?? {}, referral_source: d.referral_source || null,
  };

  // Unique constraints are authoritative. Retry a randomly generated code if
  // it collides; no owner can overwrite or share another shop's identity.
  for (let attempt = 0; attempt < 6; attempt++) {
    const code = shortCode();
    let result;
    try {
      result = await admin.rpc('create_shop_application', {
        p_shop: {
          id: shopId, owner_id: userId, slug: `shop-${code.toLowerCase()}`, short_code: code,
          name: shopName, owner_name: d.owner_name.trim(), address: d.address.trim(), city: d.city.trim(),
          phone: d.phone.trim(), gstin, upi_id: d.upi_id || null,
        },
        p_onboarding: onboarding,
        p_services: d.services ?? ['print', 'photocopy', 'scan', 'bind', 'laminate'],
        p_rates: rates,
        p_inventory: (d.inventory ?? []).map((item) => ({ ...item, name: item.name.trim() })),
        p_photo_path: photoPath,
      });
    } catch { return unconfirmedApplication(); }
    const { data: shop, error } = result;
    if (!error && shop) {
      if (typeof shop.short_code !== 'string' || !/^[A-HJ-NP-Z2-9]{8}$/.test(shop.short_code) || typeof shop.duplicate_name !== 'boolean') return unconfirmedApplication();
      // A stale name check may have caused an unnecessary photo upload.
      if (!shop.duplicate_name) await removePhotoProof(admin, photoPath);
      return received(shop.short_code, shop.duplicate_name);
    }
    if (error?.code === '23505' && /shops_(slug|short_code)_key/.test(`${error.message} ${error.details ?? ''}`)) continue;
    if (!isDefiniteDatabaseRejection(error)) return unconfirmedApplication();
    await cleanup();
    if (error?.message.includes('DUPLICATE_NAME_PROOF_REQUIRED')) {
      return jsonError(409, 'duplicate_name_requires_proof', 'This name is already in use. Add a shop photo or a valid-format GSTIN for review.');
    }
    console.error('Shop application failed:', error?.code);
    return jsonError(500, 'signup', 'Could not finish the application. Please try again.');
  }
  await cleanup();
  return jsonError(503, 'code_unavailable', 'Could not generate a shop code. Please try again.');
}
