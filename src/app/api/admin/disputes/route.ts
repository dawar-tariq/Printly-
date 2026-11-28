import { readJsonBody } from '@/lib/request-body';
import { z } from 'zod';
import { getSessionProfile, jsonOk, jsonError } from '@/lib/api';
import { createAdminSupabase } from '@/lib/supabase';

export async function GET(req: Request) {
  const session = await getSessionProfile();
  if (!session || session.profile?.role !== 'admin') return jsonError(403, 'forbidden', 'Admin only');
  const status = new URL(req.url).searchParams.get('status') ?? 'open';
  const admin = createAdminSupabase();
  let query = admin.from('disputes')
    .select('id, type, description, status, resolution_note, created_at, resolved_at, orders!inner(id, token, total_paise, shop_id, shops!inner(name, slug))')
    .order('created_at', { ascending: false })
    .limit(100);
  if (status !== 'all') query = query.eq('status', status);
  const { data, error } = await query;
  if (error) {
    console.error('Could not load disputes:', error.code);
    return jsonError(503, 'db', 'Could not load disputes. Please try again.');
  }
  return jsonOk({ disputes: data ?? [] });
}

const resolveInput = z.object({
  action: z.enum(['investigating', 'resolve_reject', 'resolve_refund']),
  note: z.string().max(1000).optional(),
});

export async function POST(req: Request) {
  const session = await getSessionProfile();
  if (!session || session.profile?.role !== 'admin') return jsonError(403, 'forbidden', 'Admin only');
  const url = new URL(req.url);
  const disputeId = url.searchParams.get('id');
  if (!disputeId) return jsonError(422, 'validation', 'Missing dispute id');
  const parsed = resolveInput.safeParse(await readJsonBody(req));
  if (!parsed.success) return jsonError(422, 'validation', 'Invalid action');

  const admin = createAdminSupabase();
  const { action, note } = parsed.data;
  const update =
    action === 'investigating'
      ? { status: 'investigating' }
      : action === 'resolve_reject'
        ? { status: 'resolved_reject', resolution_note: note ?? '', resolved_by: session.user.id, resolved_at: new Date().toISOString() }
        : { status: 'resolved_refund', resolution_note: note ?? '', resolved_by: session.user.id, resolved_at: new Date().toISOString() };
  const { error } = await admin.from('disputes').update(update).eq('id', disputeId);
  if (error) {
    console.error('Could not update dispute:', error.code);
    return jsonError(503, 'db', 'Could not update this dispute. Please try again.');
  }
  return jsonOk({ ok: true, action });
}
