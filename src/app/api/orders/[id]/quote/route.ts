import { createAdminSupabase } from '@/lib/supabase';
import { jsonOk, jsonError } from '@/lib/api';
import { computeQuote, PricingError } from '@/lib/pricing';
import { loadOrderWithRates } from '@/lib/order-quote';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const loaded = await loadOrderWithRates(id);
  if (!loaded) return jsonError(404, 'order_not_found', 'Order not found');
  const { order, items, card, gstBps, rushBps } = loaded;

  try {
    const quote = computeQuote(
      items.map((i) => ({
        service: i.service, paper_size: i.paper_size, color: i.color, sides: i.sides,
        paper_gsm: i.paper_gsm, option: i.option, copies: i.copies, pages: i.pages,
      })),
      card,
      { rush: order.rush, rushBps, gstBps },
    );
    return jsonOk({ quote, rush: order.rush });
  } catch (e) {
    if (e instanceof PricingError) return jsonError(422, 'pricing', e.message);
    throw e;
  }
}
