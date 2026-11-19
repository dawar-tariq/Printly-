import { z } from 'zod';
import { jsonOk, jsonError } from '@/lib/api';
import { loadOrderWithRates } from '@/lib/order-quote';
import { computeQuote, PricingError } from '@/lib/pricing';
import { buildUpiIntent } from '@/lib/upi';
import { checkoutContact } from '@/lib/contracts';

const payInput = z.object({ method: z.enum(['upi', 'cod']) }).and(checkoutContact);

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = payInput.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return jsonError(422, 'validation', parsed.error.issues[0]?.message ?? 'Invalid input');

  const loaded = await loadOrderWithRates(id);
  if (!loaded) return jsonError(404, 'order_not_found', 'Order not found');
  const { admin, order, items, card, gstBps, rushBps } = loaded;
  if (order.status !== 'draft') return jsonError(409, 'order_locked', 'Order already placed');
  if (items.length === 0) return jsonError(422, 'empty_order', 'Add at least one item');

  const { rush, customer_name, customer_phone, customer_email, notes, method } = parsed.data;
  const rushBpsShop = (order as unknown as { shops: { rush_surcharge_bps: number } }).shops?.rush_surcharge_bps ?? rushBps;

  let quote;
  try {
    quote = computeQuote(
      items.map((i) => ({
        service: i.service, paper_size: i.paper_size, color: i.color, sides: i.sides,
        paper_gsm: i.paper_gsm, option: i.option, copies: i.copies, pages: i.pages,
      })),
      card,
      { rush: !!rush, rushBps: rushBpsShop, gstBps },
    );
  } catch (e) {
    if (e instanceof PricingError) return jsonError(422, 'pricing', e.message);
    throw e;
  }

  // persist line prices + totals
  const { data: dbItems } = await admin.from('order_items').select('id').eq('order_id', id).order('id');
  if (dbItems) {
    for (let i = 0; i < dbItems.length; i++) {
      const line = quote.lines[i];
      if (!line) continue;
      await admin.from('order_items').update({
        unit_price_paise: line.unitPricePaise, line_total_paise: line.lineTotalPaise,
      }).eq('id', dbItems[i].id);
    }
  }

  const shop = (order as unknown as { shops: { name: string; slug: string; upi_id: string | null; eta_minutes: number; commission_bps: number } }).shops;
  const commission = Math.round((quote.totalPaise * shop.commission_bps) / 10000);

  const baseUpdate = {
    customer_name, customer_phone, customer_email: customer_email ?? '', notes: notes ?? '',
    rush: !!rush,
    subtotal_paise: quote.subtotalPaise,
    discount_paise: 0,
    tax_paise: quote.taxPaise + quote.rushFeePaise,
    total_paise: quote.totalPaise,
    commission_paise: commission,
    payment_method: method,
    eta_minutes: shop.eta_minutes,
    updated_at: new Date().toISOString(),
  };

  if (method === 'cod') {
    const { data: token, error: tokErr } = await admin.rpc('next_token', { p_shop_id: order.shop_id });
    if (tokErr) return jsonError(500, 'token', tokErr.message);
    await admin.from('orders').update({
      ...baseUpdate, status: 'queued', payment_status: 'cod_pending', token,
    }).eq('id', id);
    await admin.from('payments').upsert({
      order_id: id, provider: 'cod', amount_paise: quote.totalPaise, status: 'cod_pending',
    }, { onConflict: 'order_id' });
    await admin.from('order_status_events').insert({ order_id: id, from_status: 'draft', to_status: 'queued', note: 'COD order placed — token assigned' });
    return jsonOk({ mode: 'cod', token, total_paise: quote.totalPaise });
  }

  // UPI — keep as draft until the shop confirms payment
  if (!shop.upi_id) return jsonError(409, 'upi_missing', 'This shop has not set up UPI collection yet — choose Cash on collection');
  await admin.from('orders').update({ ...baseUpdate, payment_status: 'pending' }).eq('id', id);
  await admin.from('payments').upsert({
    order_id: id, provider: 'upi', amount_paise: quote.totalPaise, status: 'created',
  }, { onConflict: 'order_id' });

  const intent = buildUpiIntent({
    upiId: shop.upi_id, payeeName: shop.name, amountPaise: quote.totalPaise, note: `Printly ${id.slice(0, 8)}`,
  });
  return jsonOk({ mode: 'upi', ...intent, shop_name: shop.name, total_paise: quote.totalPaise, rush_fee_paise: quote.rushFeePaise, subtotal_paise: quote.subtotalPaise, tax_paise: quote.taxPaise });
}
