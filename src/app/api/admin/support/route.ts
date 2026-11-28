import { getSessionProfile, jsonError, jsonOk } from '@/lib/api';
import { createAdminSupabase } from '@/lib/supabase';

/** Only authenticated platform admins may see the support inbox. */
export async function GET(req: Request) {
  const session = await getSessionProfile();
  if (!session || session.profile?.role !== 'admin') return jsonError(403, 'forbidden', 'Admin only.');
  const params = new URL(req.url).searchParams;
  const status = params.get('status') ?? 'open';
  if (!['open', 'answered', 'closed', 'all'].includes(status)) return jsonError(422, 'validation', 'Invalid status.');
  const requested = Number(params.get('page') ?? 1);
  const page = Number.isSafeInteger(requested) ? Math.max(1, Math.min(100_000, requested)) : 1;
  const pageSize = 30;
  let query = createAdminSupabase().from('support_tickets')
    .select('id, subject, status, message_count, created_at, updated_at', { count: 'exact' });
  if (status !== 'all') query = query.eq('status', status);
  const { data, error, count } = await query.order('updated_at', { ascending: false }).order('id', { ascending: false })
    .range((page - 1) * pageSize, page * pageSize - 1);
  if (error || count === null) return jsonError(503, 'db', 'Could not load the support inbox. Please retry.');
  return jsonOk({ tickets: data ?? [], pagination: { page, pages: Math.max(1, Math.ceil(count / pageSize)), count } },
    { headers: { 'Cache-Control': 'private, no-store' } });
}
