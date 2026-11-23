import { createAdminSupabase } from '@/lib/supabase';
import { jsonOk, jsonError } from '@/lib/api';
import { enforceTrackingRateLimit } from '@/lib/rate-limit';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) return jsonError(404, 'not_found', 'Order not found');
  const limited = await enforceTrackingRateLimit(req, id);
  if (limited) return limited;
  const admin = createAdminSupabase();
  const { data, error } = await admin.rpc('get_order_track', { p_order_id: id });
  if (error) {
    console.error('Could not load order tracking:', error.code);
    return jsonError(503, 'db', 'Could not load this order. Please try again.');
  }
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return jsonError(404, 'not_found', 'Order not found');
  return jsonOk({ track: row });
}
