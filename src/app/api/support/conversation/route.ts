import { z } from 'zod';
import { jsonError, jsonOk } from '@/lib/api';
import { createAdminSupabase } from '@/lib/supabase';
import { readJsonBody } from '@/lib/request-body';
import { enforcePublicRateLimit, enforceSupportTicketLimit } from '@/lib/rate-limit';
import { authorizeSupport, supportId, supportSecret, supportText, supportMutationError } from '@/lib/support-access';

const input = z.discriminatedUnion('action', [
  z.object({ action: z.literal('read'), id: supportId, secret: supportSecret }),
  z.object({ action: z.literal('reply'), id: supportId, secret: supportSecret, message_id: supportId, message: supportText }),
]);

/** Credentials are sent in a POST body, never in URLs or query logs. */
export async function POST(req: Request) {
  const limited = await enforcePublicRateLimit(req, 'support_access');
  if (limited) return limited;
  const parsed = input.safeParse(await readJsonBody(req));
  if (!parsed.success) return jsonError(422, 'validation', 'Check the private access code and message.');
  const { id, secret } = parsed.data;
  const admin = createAdminSupabase();
  const authorized = await authorizeSupport(admin, id, secret);
  if (authorized.response) return authorized.response;
  if (parsed.data.action === 'reply') {
    const messageLimit = await enforcePublicRateLimit(req, 'support_message') ?? await enforceSupportTicketLimit(id);
    if (messageLimit) return messageLimit;
    const { error } = await admin.rpc('append_support_message', {
      p_ticket_id: id, p_message_id: parsed.data.message_id, p_sender: 'customer', p_actor_id: null, p_body: parsed.data.message,
    });
    if (error) return supportMutationError(error);
    return jsonOk({ ok: true }, { headers: { 'Cache-Control': 'private, no-store' } });
  }
  const { data, error } = await admin.from('support_messages').select('id, sender, body, created_at')
    .eq('ticket_id', id).order('position', { ascending: true }).limit(100);
  if (error) return jsonError(503, 'db', 'Could not load the conversation. Please retry.');
  return jsonOk({ ticket: authorized.ticket, messages: data ?? [] }, { headers: { 'Cache-Control': 'private, no-store' } });
}
