import { createAdminSupabase } from '@/lib/supabase';
import { jsonOk, jsonError } from '@/lib/api';
import { createOrderInput } from '@/lib/contracts';
import { findPublicShop } from '@/lib/public-shop';
import { setDraftCookie } from '@/lib/draft-access';

export async function POST(req: Request) {
  const parsed = createOrderInput.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return jsonError(422, 'validation', 'Invalid input');
  const admin = createAdminSupabase();
  const { data: shop, error: shopError } = await findPublicShop(admin, parsed.data.shop_slug);
  if (shopError) return jsonError(500, 'db', 'Could not look up this shop');
  if (!shop) return jsonError(404, 'shop_not_found', 'Shop not found');
  if (shop.status !== 'active') return jsonError(403, 'shop_unavailable', 'This shop is not accepting orders right now');

  const { data: order, error } = await admin
    .from('orders')
    .insert({ shop_id: shop.id, status: 'draft', payment_status: 'pending' })
    .select('id')
    .single();
  if (error) return jsonError(500, 'db', error.message);
  const response = jsonOk({ order_id: order.id, shop_id: shop.id });
  setDraftCookie(response, order.id);
  return response;
}
