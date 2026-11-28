import 'server-only';
import { createHash, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import { jsonError } from '@/lib/api';

export const supportId = z.string().uuid();
export const supportSecret = z.string().regex(/^[A-Za-z0-9_-]{43}$/).refine((value) => {
  const bytes = Buffer.from(value, 'base64url');
  return bytes.length === 32 && bytes.toString('base64url') === value;
});
export const supportText = z.string().trim().min(1).max(3000);
export const supportSubject = z.string().trim().min(3).max(120);

// A uniformly random 256-bit secret does not require a password KDF. SHA-256
// permits service-role key rotation without losing access to old tickets.
export function supportSecretHash(secret: string): string {
  return createHash('sha256').update(secret, 'utf8').digest('hex');
}

export async function authorizeSupport(admin: SupabaseClient, id: string, secret: string) {
  const { data, error } = await admin.from('support_tickets')
    .select('id, subject, status, message_count, created_at, updated_at, secret_hash').eq('id', id).maybeSingle();
  if (error) return { response: jsonError(503, 'db', 'Support is temporarily unavailable. Please try again.') };
  const saved = typeof data?.secret_hash === 'string' && /^[0-9a-f]{64}$/.test(data.secret_hash)
    ? Buffer.from(data.secret_hash, 'hex') : Buffer.alloc(32);
  const valid = timingSafeEqual(saved, Buffer.from(supportSecretHash(secret), 'hex')) && !!data;
  if (!valid || !data) return { response: jsonError(404, 'not_found', 'Conversation not found. Check your private access code.') };
  const { secret_hash: _secretHash, ...ticket } = data;
  return { ticket };
}

export function supportMutationError(error: { message?: string; code?: string } | null) {
  if (error?.message?.includes('SUPPORT_FULL')) return jsonError(409, 'support_full', 'This conversation has reached its message limit. Please start a new request.');
  if (error?.message?.includes('SUPPORT_MESSAGE_CONFLICT') || error?.message?.includes('SUPPORT_CONFLICT')) {
    return jsonError(409, 'support_conflict', 'This request could not be repeated with different details. Check the conversation or start a new request.');
  }
  if (error?.message?.includes('SUPPORT_NOT_FOUND')) return jsonError(404, 'not_found', 'Conversation not found.');
  return jsonError(503, 'db', 'Support is temporarily unavailable. Please try again.');
}
