import { readJsonBody } from '@/lib/request-body';
import { z } from 'zod';
import { jsonOk, jsonError } from '@/lib/api';
import { loadOrderWithRates } from '@/lib/order-quote';
import { computeQuote, PricingError } from '@/lib/pricing';
import { buildUpiIntent } from '@/lib/upi';
import { checkoutContact } from '@/lib/contracts';
import { requestHasDraftAccess } from '@/lib/draft-access';
import { enforcePublicRateLimit } from '@/lib/rate-limit';
import { draftMutationError } from '@/lib/draft-mutation';
import { quoteToken } from '@/lib/quote-token';
import { shopHasSubscription } from '@/lib/subscription-server';
import { recoverStartedCheckout } from '@/lib/checkout-recovery';

const payInput = z.object({ method: z.enum(['upi', 'cod']), quote_token: z.string().regex(/^[0-9a-f]{64}$/) }).and(checkoutContact);
const noStore = { headers: { 'Cache-Control': 'private, no-store' } };

type Shop = { name: string; upi_id: string | null; eta_minutes: number; rush_surcharge_bps: number | null; status: string; is_open: boolean };

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!requestHasDraftAccess(req, id)) return jsonError(403, 'draft_session', 'Your order session expired. Please start a new order.');
  const parsed = payInput.safeParse(await readJsonBody(req));
  if (!parsed.success) return jsonError(422, 'validation', 'Please refresh the order and review the total before checkout.');

  let loaded;
  try { loaded = await loadOrderWithRates(id); }
  catch { return jsonError(503, 'db', 'Could not load the order. Please try again.'); }
  if (!loaded) return jsonError(404, 'order_not_found', 'Order not found');
  const { admin, order, items, card, gstBps, rushBps } = loaded;
  const { rush, customer_name, customer_phone, customer_email, notes, method, quote_token } = parsed.data;
  const shop = order.shops as unknown as Shop;

  // A lost response must not create another order/payment. Recover the same
  // checkout only when the caller presents the exact quote used to create it.
  const recovered = await recoverStartedCheckout(admin, id, order, { method, quote_token });
  if (recovered) return recovered;
  // Do not throttle recovery of an already-started payment above. This limit
  // applies only when initiating a new checkout, not when an answer was lost.
  const limited = await enforcePublicRateLimit(req, 'checkout');
  if (limited) return limited;
  if (!items.length) return jsonError(422, 'empty_order', 'Add at least one item');
  if (!shop) return jsonError(503, 'db', 'Could not load shop pricing. Please retry.');
  if (shop.is_open !== true) return jsonError(403, 'shop_closed', 'This shop is closed. Please check back when it reopens.');
  const subscribed = await shopHasSubscription(admin, order.shop_id);
  if (subscribed === null) return jsonError(503, 'db', 'Could not check shop availability. Please retry.');
  if (!subscribed || shop.status !== 'active') return jsonError(403, 'shop_unavailable', 'This shop is not accepting orders right now.');
  if (method === 'upi' && !shop.upi_id) return jsonError(409, 'upi_missing', 'This shop has not set up UPI collection yet — choose Cash on collection');

  const version = Number(order.draft_version);
  if (!Number.isSafeInteger(version) || version < 0) return jsonError(503, 'db', 'Could not verify the order. Please retry.');
  let quote;
  try {
    quote = computeQuote(
      items.map((i) => ({
        file_id: i.file_id, service: i.service, paper_size: i.paper_size, color: i.color, sides: i.sides,
        paper_gsm: i.paper_gsm, option: i.option, copies: i.copies, pages: i.pages,
      })),
      card,
      { rush: !!rush, rushBps: shop.rush_surcharge_bps ?? rushBps, gstBps },
    );
  } catch (e) {
    if (e instanceof PricingError) return jsonError(422, 'pricing', e.message);
    throw e;
  }
  if (quoteToken(id, version, !!rush, quote) !== quote_token) return jsonError(409, 'quote_changed', 'The order or price changed. Please review the updated total before placing the order.');

  const lines = items.map((item, index) => ({
    id: item.id, unit_price_paise: quote.lines[index].unitPricePaise, line_total_paise: quote.lines[index].lineTotalPaise,
  }));
  const { data: committed, error } = await admin.rpc('commit_draft_checkout', {
    p_order_id: id, p_version: version, p_rates: card, p_gst_bps: gstBps,
    p_shop: {
      name: shop.name, upi_id: shop.upi_id, eta_minutes: shop.eta_minutes,
      rush_surcharge_bps: shop.rush_surcharge_bps, status: shop.status,
    },
    p_lines: lines,
    p_checkout: {
      customer_name, customer_phone, customer_email: customer_email ?? '', notes: notes ?? '', method, rush: !!rush,
      subtotal_paise: quote.subtotalPaise, tax_paise: quote.taxPaise + quote.rushFeePaise, total_paise: quote.totalPaise,
      // The database rejects old pricing engines when a physical-sheet rate
      // exists, so an older deployment cannot commit pages × copies by mistake.
      pricing_engine: 'duplex-v1', quote_token,
    },
  });
  if (error) return draftMutationError(error);
  if (!committed) return jsonError(503, 'db', 'Could not confirm checkout. Please retry.');
  if (method === 'cod') return jsonOk({ mode: 'cod', token: committed.token, total_paise: quote.totalPaise }, noStore);

  const intent = buildUpiIntent({ upiId: shop.upi_id!, payeeName: shop.name, amountPaise: quote.totalPaise, note: `Printly ${id.slice(0, 8)}` });
  return jsonOk({ mode: 'upi', ...intent, shop_name: shop.name, total_paise: quote.totalPaise, rush_fee_paise: quote.rushFeePaise, subtotal_paise: quote.subtotalPaise, tax_paise: quote.taxPaise }, noStore);
}
