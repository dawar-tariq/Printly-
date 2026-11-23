import { readJsonBody } from '@/lib/request-body';
import { z } from 'zod';
import { getStaffContext, jsonError, jsonOk } from '@/lib/api';
import { enforceSubscriptionPromoRateLimit } from '@/lib/rate-limit';
import { promoCodeSchema, subscriptionQuoteSchema, subscriptionTermSchema } from '@/lib/subscription-offers';
import { getVisibleSubscriptionAnnouncements } from '@/lib/subscription-offers-server';
import { subscriptionMutationError } from '@/lib/subscription-server';

const noStore = { headers: { 'Cache-Control': 'private, no-store' } };
const input = z.discriminatedUnion('action', [
  z.object({ action: z.literal('quote'), term: subscriptionTermSchema, code: promoCodeSchema.nullable() }).strict(),
  z.object({ action: z.literal('start'), term: subscriptionTermSchema, code: promoCodeSchema.nullable(),
    request_key: z.string().uuid(), expected_quote: subscriptionQuoteSchema }).strict(),
  z.object({ action: z.literal('submit'), purchase_id: z.string().uuid(), utr: z.string().max(80) }).strict(),
  z.object({ action: z.literal('cancel'), purchase_id: z.string().uuid() }).strict(),
]);

async function context(req: Request) {
  const staff = await getStaffContext({ allowExpired: true });
  if (!staff || staff.isAdmin || !staff.shopIds.length) return null;
  const shopId = new URL(req.url).searchParams.get('shop_id') ?? staff.shopIds[0];
  if (!staff.shopIds.includes(shopId)) return null;
  return { staff, shopId };
}

export async function GET(req: Request) {
  const ctx = await context(req);
  if (!ctx) return jsonError(403, 'forbidden', 'Shop sign-in required.');
  const { staff, shopId } = ctx;
  if (staff.subscriptionError) return jsonError(503, 'db', 'Could not check subscription status. Please retry.');
  const [shop, plan, purchases, announcements] = await Promise.all([
    staff.admin.from('shops').select('id, name, short_code, owner_id').eq('id', shopId).maybeSingle(),
    staff.admin.from('subscription_plan').select('monthly_paise, six_months_paise, yearly_paise, upi_id, payee_name, warning_days').eq('id', true).maybeSingle(),
    staff.admin.from('subscription_purchases').select('id, shop_id, term, amount_paise, upi_id, payee_name, status, utr, submitted_at, reviewed_at, review_note, period_start, period_end, created_at, base_amount_paise, monthly_reference_paise, discount_paise, promo_code, request_key')
      .eq('shop_id', shopId).order('created_at', { ascending: false }).limit(50),
    getVisibleSubscriptionAnnouncements(staff.admin, false),
  ]);
  if (shop.error || plan.error || purchases.error || !shop.data || !plan.data) return jsonError(503, 'db', 'Could not load subscription details. Please retry.');
  return jsonOk({
    shop: { id: shop.data.id, name: shop.data.name, short_code: shop.data.short_code },
    is_owner: shop.data.owner_id === staff.user.id,
    subscription: staff.subscriptions.find((row) => row.shop_id === shopId) ?? null,
    plan: plan.data,
    purchases: purchases.data ?? [],
    announcements: announcements ?? [], offers_unavailable: announcements === null,
  }, noStore);
}

export async function POST(req: Request) {
  const ctx = await context(req);
  if (!ctx) return jsonError(403, 'forbidden', 'Shop sign-in required.');
  const { staff, shopId } = ctx;
  if (staff.subscriptionError) return jsonError(503, 'db', 'Could not check subscription status. Please retry.');
  const parsed = input.safeParse(await readJsonBody(req));
  if (!parsed.success) return jsonError(422, 'validation', 'Invalid subscription request. Refresh the page and try again.');
  const body = parsed.data;
  if ((body.action === 'quote' || body.action === 'start') && body.code) {
    const limited = await enforceSubscriptionPromoRateLimit(shopId, staff.user.id);
    if (limited) return limited;
  }
  const result = body.action === 'quote'
    ? await staff.admin.rpc('quote_subscription_offer', { p_shop_id: shopId, p_actor: staff.user.id, p_term: body.term, p_code: body.code })
    : body.action === 'start'
      ? await staff.admin.rpc('start_subscription_purchase_with_offer', { p_shop_id: shopId, p_actor: staff.user.id, p_term: body.term,
        p_code: body.code, p_request_key: body.request_key, p_expected_quote: body.expected_quote })
      : body.action === 'submit'
        ? await staff.admin.rpc('submit_subscription_purchase', { p_shop_id: shopId, p_purchase_id: body.purchase_id, p_actor: staff.user.id, p_utr: body.utr })
        : await staff.admin.rpc('cancel_subscription_purchase', { p_shop_id: shopId, p_purchase_id: body.purchase_id, p_actor: staff.user.id });
  if (result.error) return subscriptionMutationError(result.error);
  if (body.action === 'quote') {
    const quote = subscriptionQuoteSchema.safeParse(result.data);
    if (!quote.success) return jsonError(503, 'db', 'Could not confirm this subscription quote. Please retry.');
    return jsonOk({ ok: true, result: quote.data }, noStore);
  }
  if (!result.data) return jsonError(503, 'db', 'Could not confirm the request. Refresh before retrying.');
  return jsonOk({ ok: true, result: result.data }, noStore);
}
