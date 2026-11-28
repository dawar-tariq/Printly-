import { readJsonBody } from '@/lib/request-body';
import { z } from 'zod';
import { getSessionProfile, jsonError, jsonOk } from '@/lib/api';
import { createAdminSupabase } from '@/lib/supabase';
import { isValidUpiId } from '@/lib/upi';
import { subscriptionMutationError } from '@/lib/subscription-server';

const PAGE_SIZE = 30;
const noStore = { headers: { 'Cache-Control': 'private, no-store' } };
const price = z.number().int().min(1).max(100_000_000).nullable();
const settingsInput = z.object({
  expected_version: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  monthly_paise: price.optional(),
  six_months_paise: price.optional(),
  yearly_paise: price.optional(),
  upi_id: z.string().trim().max(100).refine(isValidUpiId).nullable().optional(),
  payee_name: z.string().trim().min(1).max(50).nullable().optional(),
  warning_days: z.number().int().min(1).max(30).optional(),
}).strict();

const pageNumber = (value: string | null) => {
  const n = Number(value ?? '1');
  return Number.isSafeInteger(n) ? Math.max(1, Math.min(n, 100000)) : 1;
};

export async function GET(req: Request) {
  const session = await getSessionProfile();
  if (!session || session.profile?.role !== 'admin') return jsonError(403, 'forbidden', 'Admin only.');
  const params = new URL(req.url).searchParams;
  const page = pageNumber(params.get('page'));
  const pendingPage = pageNumber(params.get('pending_page'));
  // Search is a literal name substring, never PostgREST filter syntax.
  const search = (params.get('q') ?? '').trim().replace(/[%_,()*\\]/g, '').slice(0, 80);
  const admin = createAdminSupabase();
  let shopsQuery = admin.from('shops').select('id, name, short_code, status', { count: 'exact' }).order('name').range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  if (search) shopsQuery = shopsQuery.ilike('name', `%${search}%`);
  const [plan, shops, pending, history] = await Promise.all([
    admin.from('subscription_plan').select('monthly_paise, six_months_paise, yearly_paise, upi_id, payee_name, warning_days, version, updated_at').eq('id', true).maybeSingle(),
    shopsQuery,
    admin.from('subscription_purchases').select('id, shop_id, term, amount_paise, upi_id, payee_name, status, utr, submitted_at, reviewed_at, review_note, period_start, period_end, created_at, base_amount_paise, monthly_reference_paise, discount_paise, promo_code', { count: 'exact' })
      .eq('status', 'submitted').order('submitted_at', { ascending: true }).range((pendingPage - 1) * PAGE_SIZE, pendingPage * PAGE_SIZE - 1),
    admin.from('subscription_purchases').select('id, shop_id, term, amount_paise, upi_id, payee_name, status, utr, submitted_at, reviewed_at, review_note, period_start, period_end, created_at, base_amount_paise, monthly_reference_paise, discount_paise, promo_code')
      .in('status', ['approved', 'rejected']).order('reviewed_at', { ascending: false }).limit(20),
  ]);
  if (plan.error || shops.error || pending.error || history.error || !plan.data) return jsonError(503, 'db', 'Could not load subscriptions. Please retry.');
  const shopRows = shops.data ?? [];
  const purchaseRows = [...(pending.data ?? []), ...(history.data ?? [])];
  const ids = [...new Set([...shopRows.map((s) => s.id as string), ...purchaseRows.map((p) => p.shop_id as string)])];
  const [entitlements, names, pilots] = ids.length ? await Promise.all([
    admin.from('shop_subscriptions').select('shop_id, term, started_at, expires_at, is_permanent, updated_at').in('shop_id', ids),
    admin.from('shops').select('id, name, short_code').in('id', ids),
    admin.from('shop_pilot_grants').select('shop_id, starts_at, ends_at').in('shop_id', ids),
  ]) : [{ data: [], error: null }, { data: [], error: null }, { data: [], error: null }];
  if (entitlements.error || names.error || pilots.error) return jsonError(503, 'db', 'Could not load shop subscriptions. Please retry.');
  const byShop = new Map((entitlements.data ?? []).map((s) => [s.shop_id, s]));
  const byId = new Map((names.data ?? []).map((s) => [s.id, s]));
  const byPilot = new Map((pilots.data ?? []).map((p) => [p.shop_id, p]));
  return jsonOk({
    plan: plan.data,
    shops: shopRows.map((s) => ({ ...s, subscription: byShop.get(s.id) ?? null, pilot: byPilot.get(s.id) ?? null })),
    pending: (pending.data ?? []).map((p) => ({ ...p, shop: byId.get(p.shop_id) ?? null, subscription: byShop.get(p.shop_id) ?? null })),
    history: (history.data ?? []).map((p) => ({ ...p, shop: byId.get(p.shop_id) ?? null })),
    pagination: { page, pages: Math.max(1, Math.ceil((shops.count ?? 0) / PAGE_SIZE)), count: shops.count ?? 0,
      pendingPage, pendingPages: Math.max(1, Math.ceil((pending.count ?? 0) / PAGE_SIZE)), pendingCount: pending.count ?? 0 },
  }, noStore);
}

export async function PUT(req: Request) {
  const session = await getSessionProfile();
  if (!session || session.profile?.role !== 'admin') return jsonError(403, 'forbidden', 'Admin only.');
  const parsed = settingsInput.safeParse(await readJsonBody(req));
  if (!parsed.success) return jsonError(422, 'validation', 'Enter valid prices, UPI details and reminder days.');
  const { expected_version, ...changes } = parsed.data;
  if (!Object.keys(changes).length) return jsonError(422, 'validation', 'Choose a setting to update.');
  const admin = createAdminSupabase();
  const { data, error } = await admin.rpc('update_subscription_plan', { p_expected_version: expected_version, p_changes: changes, p_actor: session.user.id });
  if (error) return subscriptionMutationError(error);
  if (!data) return jsonError(503, 'db', 'Could not save the subscription settings. Please retry.');
  return jsonOk({ ok: true }, noStore);
}
