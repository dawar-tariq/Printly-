import { createAdminSupabase, createServerSupabase } from '@/lib/supabase';
import { shopHasSubscription } from '@/lib/subscription-server';
import { jsonOk, jsonError } from '@/lib/api';
import { findPublicShop } from '@/lib/public-shop';

export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const supabase = await createServerSupabase();
  const { data: shop, error } = await findPublicShop(supabase, slug);
  if (error) {
    console.error('Could not load a public shop:', error.code);
    return jsonError(503, 'db', 'Could not load this shop. Please try again.');
  }
  if (!shop) return jsonError(404, 'not_found', 'Shop not found');

  const subscribed = shop.status === 'active' ? await shopHasSubscription(createAdminSupabase(), shop.id) : false;
  if (subscribed === null) return jsonError(503, 'db', 'Could not check shop availability. Please retry.');

  const [{ data: services }, { data: rates }] = await Promise.all([
    supabase.from('shop_services').select('service, enabled, display_order').eq('shop_id', shop.id).order('display_order'),
    supabase.from('rate_card').select('service, paper_size, color, sides, paper_gsm, option, unit, price_paise').eq('shop_id', shop.id),
  ]);
  return jsonOk({ shop, accepting_orders: shop.status === 'active' && shop.is_open === true && subscribed, services: services ?? [], rateCard: rates ?? [] }, { headers: { 'Cache-Control': 'no-store' } });
}
