import { randomBytes } from 'crypto';
import { jsonOk, jsonError } from '@/lib/api';
import { createAdminSupabase } from '@/lib/supabase';
import { shopSignupInput } from '@/lib/contracts';

const SHORT_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function shortCode(len = 5) {
  const bytes = randomBytes(len);
  return Array.from(bytes, (b) => SHORT_CODE_ALPHABET[b % SHORT_CODE_ALPHABET.length]).join('');
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

function slugify(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 48) || 'shop';
}

export async function POST(req: Request) {
  const parsed = shopSignupInput.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return jsonError(422, 'validation', parsed.error.issues[0]?.message ?? 'Invalid input');
  const d = parsed.data;
  const { shop_name, owner_name, email, password, phone, address, city, gstin, upi_id } = d;

  const admin = createAdminSupabase();

  // 1) create the auth user
  const { data: created, error: signUpErr } = await admin.auth.admin.createUser({
    email, password, email_confirm: true, user_metadata: { full_name: owner_name },
  });
  if (signUpErr || !created.user) return jsonError(422, 'signup', signUpErr?.message ?? 'Could not create account');
  const userId = created.user.id;

  // profile is created by trigger; make sure role is shop_staff
  await admin.from('profiles').update({ role: 'shop_staff', full_name: owner_name, phone }).eq('id', userId);

  // 2) unique slug + short code
  const base = slugify(shop_name);
  let slug = base;
  for (let i = 2; i < 50; i++) {
    const { data: exists } = await admin.from('shops').select('id').eq('slug', slug).maybeSingle();
    if (!exists) break;
    slug = `${base}-${i}`;
  }
  const shortCodeValue = shortCode(6);

  // 3) shop (pending KYC) + staff + default catalog + default rate card
  const { data: shop, error: shopErr } = await admin.from('shops').insert({
    owner_id: userId, slug, short_code: shortCodeValue, name: shop_name, address, city, phone,
    gstin: gstin || null, upi_id: upi_id || null, kyc_status: 'pending', status: 'paused',
  }).select('id, slug').single();
  if (shopErr || !shop) return jsonError(500, 'db', shopErr?.message ?? 'Could not create shop');

  await admin.from('shop_staff').insert({ shop_id: shop.id, user_id: userId, role: 'owner' });

  // Services: only the ones the owner picked (default: all five).
  const ALL_SERVICES = ['print', 'photocopy', 'scan', 'bind', 'laminate'];
  const chosen = d.services && d.services.length > 0 ? d.services : ALL_SERVICES;
  await admin.from('shop_services').insert(
    ALL_SERVICES.map((service, i) => ({ shop_id: shop.id, service, enabled: chosen.includes(service as never), display_order: i + 1 })),
  );
  await admin.from('rate_card').insert(
    DEFAULT_RATES.map(([service, paper_size, color, sides, paper_gsm, option, unit, price_paise]) => ({
      shop_id: shop.id, service, paper_size, color, sides, paper_gsm, option, unit, price_paise,
    })),
  );

  // Structured onboarding details (best-effort: never block signup if the
  // table is missing on an older deployment).
  const onboardingRow = {
    shop_id: shop.id,
    business_type: d.business_type ?? 'other',
    legal_business_name: d.legal_business_name || null,
    year_established: d.year_established ?? null,
    staff_count: d.staff_count ?? 1,
    printer_count: d.printer_count ?? 1,
    avg_daily_jobs: d.avg_daily_jobs ?? 0,
    printer_details: d.printer_details ?? '',
    pincode: d.pincode ?? '',
    alternate_phone: d.alternate_phone || null,
    registration_type: d.registration_type ?? 'unregistered',
    registration_number: d.registration_number || null,
    business_hours: d.business_hours ?? {},
    referral_source: d.referral_source || null,
  };
  await admin.from('shop_onboarding').upsert(onboardingRow, { onConflict: 'shop_id' });

  // Starting inventory submitted during onboarding.
  const inventory = (d.inventory ?? []).filter((i) => i.name.trim());
  if (inventory.length > 0) {
    await admin.from('inventory_items').insert(
      inventory.map((i) => ({
        shop_id: shop.id,
        name: i.name.trim(),
        category: i.category,
        qty: i.qty,
        unit: i.unit || 'sheets',
        low_stock_threshold: i.low_stock_threshold,
      })),
    );
  }

  return jsonOk({ ok: true, slug: shop.slug, message: 'Application received — we will verify and activate your shop within 24–48h' });
}
