import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { jsonError, jsonOk } from '@/lib/api';
import { isolatedTestRequestAllowed } from '@/lib/isolated-test-environment.mjs';
import { nativePushTarget, validNativePushAuthorization } from '@/lib/native-push-server';
import { createAdminSupabase } from '@/lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Temporary transport for exactly the reviewed, public 0027 source. It only
// stores bytes in staging; it cannot apply SQL, claim a push or send anything.
// The database helper accepts only this SHA-256 and only the service role.
const sourceSha256 = 'f4f04e902c160e37208aefcb59c91ccb242f23cc0efffabc69f8af3cc71372c3';
export async function POST(request: Request): Promise<Response> {
  if (nativePushTarget() !== 'isolated' || !isolatedTestRequestAllowed(process.env, request.headers.get('host') ?? '')) {
    return jsonError(404, 'not_found', 'Not found.');
  }
  if (!validNativePushAuthorization(request.headers.get('authorization'), process.env.PRINTLY_NATIVE_PUSH_CRON_SECRET ?? '')) {
    return jsonError(401, 'unauthorized', 'Unauthorized.');
  }
  try {
    const source = await readFile(join(process.cwd(), 'supabase/migrations/0027_native_notification_management.sql'), 'utf8');
    if (createHash('sha256').update(source, 'utf8').digest('hex') !== sourceSha256) throw new Error('Unexpected migration source');
    const { data, error } = await createAdminSupabase().rpc('stage_native_qa_0027_f4f04e902c', { p_sql: source });
    if (error || data !== true) throw new Error('Could not stage the source');
    return jsonOk({ staged: true }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch {
    return jsonError(503, 'unavailable', 'Could not stage the reviewed migration source.');
  }
}
