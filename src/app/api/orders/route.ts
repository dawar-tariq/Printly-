import { createAdminSupabase } from '@/lib/supabase';
import { jsonOk, jsonError } from '@/lib/api';
import { createOrderInput } from '@/lib/contracts';

export async function POST(req: Request) {
  const parsed = createOrderInput.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return jsonError(422, 'validation', 'Invalid input');
  const admin = createAdminSupabase();
  const { data: shop } = await admin.from('shops').select('id, status').eq('slug', parsed.data.shop_slug).maybeSingle();
  if (!shop) return jsonError(404, 'shop_not_found', 'Shop not found');
  if (shop.status !== 'active') return jsonError(403, 'shop_unavailable', 'This shop is not accepting orders right now');

  const { data: order, error } = await admin
    .from('orders')
    .insert({ shop_id: shop.id, status: 'draft', payment_status: 'pending' })
    .select('id')
    .single();
  if (error) return jsonError(500, 'db', error.message);
  return jsonOk({ order_id: order.id, shop_id: shop.id });
}
