import { z } from 'zod';
import { jsonError, jsonOk } from '@/lib/api';
import { createAdminSupabase } from '@/lib/supabase';
import { readJsonBody } from '@/lib/request-body';
import { enforcePublicRateLimit } from '@/lib/rate-limit';
import { supportId, supportSecret, supportSecretHash, supportSubject, supportText, supportMutationError } from '@/lib/support-access';

const createInput = z.object({ id: supportId, secret: supportSecret, subject: supportSubject, message_id: supportId, message: supportText });

/** A caller-generated code makes creating a ticket safe to retry after a lost response. */
export async function POST(req: Request) {
  const limited = await enforcePublicRateLimit(req, 'support_create');
  if (limited) return limited;
  const parsed = createInput.safeParse(await readJsonBody(req));
  if (!parsed.success) return jsonError(422, 'validation', 'Enter a subject (3–120 characters) and a message (up to 3,000 characters).');
  const { id, secret, subject, message_id, message } = parsed.data;
  const { error } = await createAdminSupabase().rpc('create_support_ticket', {
    p_id: id, p_secret_hash: supportSecretHash(secret), p_subject: subject, p_message_id: message_id, p_body: message,
  });
  if (error) return supportMutationError(error);
  return jsonOk({ ok: true }, { headers: { 'Cache-Control': 'private, no-store' } });
}
