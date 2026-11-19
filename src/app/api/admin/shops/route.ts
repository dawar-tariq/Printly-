import { getSessionProfile, jsonOk, jsonError } from '@/lib/api';
import { createAdminSupabase } from '@/lib/supabase';

export async function GET(req: Request) {
  const session = await getSessionProfile();
  if (!session || session.profile?.role !== 'admin') return jsonError(403, 'forbidden', 'Admin only');
  const url = new URL(req.url);
  const kyc = url.searchParams.get('kyc'); // pending|approved|rejected|changes_requested|all

  const admin = createAdminSupabase();
  let query = admin.from('shops')
    .select('id, name, slug, city, phone, gstin, upi_id, kyc_status, status, commission_bps, created_at, owner:profiles!shops_owner_id_fkey(email, full_name)')
    .order('created_at', { ascending: false })
    .limit(200);
  if (kyc && kyc !== 'all') query = query.eq('kyc_status', kyc);
  const { data, error } = await query;
  if (error) return jsonError(500, 'db', error.message);
  return jsonOk({ shops: data ?? [] });
}
