import { createAdminSupabase } from '@/lib/supabase';
import { jsonOk, jsonError } from '@/lib/api';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const admin = createAdminSupabase();
  const { data, error } = await admin.rpc('get_order_track', { p_order_id: id });
  if (error) return jsonError(500, 'db', error.message);
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return jsonError(404, 'not_found', 'Order not found');
  return jsonOk({ track: row });
}
