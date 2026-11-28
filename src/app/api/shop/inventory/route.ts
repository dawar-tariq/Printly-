import { readJsonBody } from '@/lib/request-body';
import { z } from 'zod';
import { getStaffContext, jsonOk, jsonError } from '@/lib/api';
import { createAdminSupabase } from '@/lib/supabase';

async function shopIdFor(req: Request) {
  const staff = await getStaffContext();
  if (!staff || staff.shopIds.length === 0) return null;
  const url = new URL(req.url);
  const shopId = url.searchParams.get('shop_id') ?? staff.shopIds[0];
  return staff.shopIds.includes(shopId) ? shopId : null;
}

export async function GET(req: Request) {
  const shopId = await shopIdFor(req);
  if (!shopId) return jsonError(403, 'forbidden', 'No shop');
  const admin = createAdminSupabase();
  const { data, error } = await admin.from('inventory_items').select('*').eq('shop_id', shopId).order('category').order('name');
  if (error) {
    console.error('Could not load inventory:', error.code);
    return jsonError(503, 'db', 'Could not load inventory. Please try again.');
  }
  return jsonOk({ items: data ?? [] });
}

const createInput = z.object({
  name: z.string().min(1).max(80),
  category: z.enum(['paper', 'ink', 'binding', 'laminate', 'other']),
  qty: z.number().min(0).max(1_000_000),
  unit: z.string().min(1).max(20),
  low_stock_threshold: z.number().min(0).max(1_000_000),
});

export async function POST(req: Request) {
  const shopId = await shopIdFor(req);
  if (!shopId) return jsonError(403, 'forbidden', 'No shop');
  const parsed = createInput.safeParse(await readJsonBody(req));
  if (!parsed.success) return jsonError(422, 'validation', 'Invalid item');
  const admin = createAdminSupabase();
  const { data, error } = await admin.from('inventory_items').insert({ ...parsed.data, shop_id: shopId }).select('id').single();
  if (error) {
    console.error('Could not add inventory:', error.code);
    return jsonError(503, 'db', 'Could not add inventory. Please try again.');
  }
  return jsonOk({ ok: true, id: data.id });
}
