import { createAdminSupabase } from '@/lib/supabase';
import { jsonOk, jsonError } from '@/lib/api';
import { createOrderInput } from '@/lib/contracts';
import { findPublicShop } from '@/lib/public-shop';
import { setDraftCookie } from '@/lib/draft-access';
import { shopHasSubscription } from '@/lib/subscription-server';

export async function POST(req: Request) {
  const parsed = createOrderInput.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return jsonError(422, 'validation', 'Invalid input');
  const admin = createAdminSupabase();
  const { data: shop, error: shopError } = await findPublicShop(admin, parsed.data.shop_slug);
  if (shopError) return jsonError(500, 'db', 'Could not look up this shop');
  if (!shop) return jsonError(404, 'shop_not_found', 'Shop not found');
  if (shop.status !== 'active') return jsonError(403, 'shop_unavailable', 'This shop is not accepting orders right now');
  const subscribed = await shopHasSubscription(admin, shop.id);
  if (subscribed === null) return jsonError(503, 'db', 'Could not check shop availability. Please try again.');
  if (!subscribed) return jsonError(403, 'shop_unavailable', 'This shop is not accepting orders right now');

  const { data: order, error } = await admin
    .from('orders')
    .insert({ shop_id: shop.id, status: 'draft', payment_status: 'pending' })
    .select('id')
    .single();
  if (error?.message.includes('SHOP_UNAVAILABLE')) return jsonError(403, 'shop_unavailable', 'This shop is not accepting orders right now');
  if (error) return jsonError(503, 'db', 'Could not start the order. Please try again.');
  const response = jsonOk({ order_id: order.id, shop_id: shop.id });
  setDraftCookie(response, order.id);
  return response;
}
