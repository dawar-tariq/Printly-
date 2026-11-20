import { createAdminSupabase } from '@/lib/supabase';
import { jsonError, jsonOk } from '@/lib/api';

export async function GET(req: Request) {
  const name = (new URL(req.url).searchParams.get('name') ?? '').trim();
  if (name.length < 2 || name.length > 80) return jsonError(422, 'validation', 'Enter a shop name between 2 and 80 characters.');
  const { data, error } = await createAdminSupabase().rpc('shop_name_exists', { p_name: name, p_exclude: null });
  if (error) return jsonError(503, 'name_check', 'Could not check this name. Please try again.');
  return jsonOk({ duplicate: Boolean(data) }, { headers: { 'Cache-Control': 'no-store' } });
}
