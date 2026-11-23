import { jsonOk, jsonError } from '@/lib/api';
import { computeQuote, PricingError } from '@/lib/pricing';
import { loadOrderWithRates } from '@/lib/order-quote';
import { requestHasDraftAccess } from '@/lib/draft-access';
import { enforcePublicRateLimit } from '@/lib/rate-limit';
import { quoteToken } from '@/lib/quote-token';
import { shopHasSubscription } from '@/lib/subscription-server';

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!requestHasDraftAccess(req, id)) return jsonError(403, 'draft_session', 'Your order session expired. Please start a new order.');
  const limited = await enforcePublicRateLimit(req, 'draft_changes');
  if (limited) return limited;
  let loaded;
  try { loaded = await loadOrderWithRates(id); }
  catch { return jsonError(503, 'db', 'Could not calculate the total. Please retry.'); }
  if (!loaded) return jsonError(404, 'order_not_found', 'Order not found');
  const { admin, order, items, card, gstBps, rushBps } = loaded;
  if (order.status !== 'draft' || order.payment_method) return jsonError(409, 'order_locked', 'The order has already entered checkout.');
  const subscribed = await shopHasSubscription(admin, order.shop_id);
  if (subscribed === null) return jsonError(503, 'db', 'Could not check shop availability. Please retry.');
  if (!subscribed) return jsonError(403, 'shop_unavailable', 'This shop is not accepting orders right now.');
  if (!items.length) return jsonError(422, 'empty_order', 'Add at least one item.');
  const requestedRush = new URL(req.url).searchParams.get('rush');
  const rush = requestedRush === '1' ? true : requestedRush === '0' ? false : !!order.rush;
  const rushBpsShop = (order as unknown as { shops: { rush_surcharge_bps: number | null } }).shops?.rush_surcharge_bps ?? rushBps;

  try {
    const quote = computeQuote(
      items.map((i) => ({
        file_id: i.file_id, service: i.service, paper_size: i.paper_size, color: i.color, sides: i.sides,
        paper_gsm: i.paper_gsm, option: i.option, copies: i.copies, pages: i.pages,
      })),
      card,
      { rush, rushBps: rushBpsShop, gstBps },
    );
    const version = Number(order.draft_version);
    if (!Number.isSafeInteger(version) || version < 0) return jsonError(503, 'db', 'Could not verify the order. Please retry.');
    return jsonOk({ quote, rush, quote_token: quoteToken(id, version, rush, quote) }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (e) {
    if (e instanceof PricingError) return jsonError(422, 'pricing', e.message);
    throw e;
  }
}
