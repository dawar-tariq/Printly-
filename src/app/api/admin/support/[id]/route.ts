import { z } from 'zod';
import { getSessionProfile, jsonError, jsonOk } from '@/lib/api';
import { createAdminSupabase } from '@/lib/supabase';
import { readJsonBody } from '@/lib/request-body';
import { supportId, supportText, supportMutationError } from '@/lib/support-access';

const actionInput = z.discriminatedUnion('action', [
  z.object({ action: z.literal('reply'), message_id: supportId, message: supportText }),
  z.object({ action: z.enum(['close', 'reopen']), expected_count: z.number().int().min(1).max(100) }),
]);

async function adminSession() {
  const session = await getSessionProfile();
  return session?.profile?.role === 'admin' ? session : null;
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!await adminSession()) return jsonError(403, 'forbidden', 'Admin only.');
  const { id } = await params;
  if (!supportId.safeParse(id).success) return jsonError(404, 'not_found', 'Conversation not found.');
  const admin = createAdminSupabase();
  const [ticket, messages] = await Promise.all([
    admin.from('support_tickets').select('id, subject, status, message_count, created_at, updated_at').eq('id', id).maybeSingle(),
    admin.from('support_messages').select('id, sender, body, created_at').eq('ticket_id', id).order('position', { ascending: true }).limit(100),
  ]);
  if (ticket.error || messages.error) return jsonError(503, 'db', 'Could not load this conversation. Please retry.');
  if (!ticket.data) return jsonError(404, 'not_found', 'Conversation not found.');
  return jsonOk({ ticket: ticket.data, messages: messages.data ?? [] }, { headers: { 'Cache-Control': 'private, no-store' } });
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await adminSession();
  if (!session) return jsonError(403, 'forbidden', 'Admin only.');
  const { id } = await params;
  if (!supportId.safeParse(id).success) return jsonError(404, 'not_found', 'Conversation not found.');
  const input = actionInput.safeParse(await readJsonBody(req));
  if (!input.success) return jsonError(422, 'validation', 'Enter a message of up to 3,000 characters.');
  const admin = createAdminSupabase();
  if (input.data.action === 'reply') {
    const { error } = await admin.rpc('append_support_message', {
      p_ticket_id: id, p_message_id: input.data.message_id, p_sender: 'admin', p_actor_id: session.user.id, p_body: input.data.message,
    });
    if (error) return supportMutationError(error);
  } else {
    const { data, error } = await admin.from('support_tickets')
      .update({ status: input.data.action === 'close' ? 'closed' : 'open', updated_at: new Date().toISOString() })
      .eq('id', id).eq('message_count', input.data.expected_count).select('id').maybeSingle();
    if (error) return jsonError(503, 'db', 'Could not update this conversation. Please retry.');
    if (!data) return jsonError(409, 'conversation_changed', 'This conversation changed. Refresh before updating its status.');
  }
  return jsonOk({ ok: true }, { headers: { 'Cache-Control': 'private, no-store' } });
}
