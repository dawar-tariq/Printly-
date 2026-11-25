import { jsonError, jsonOk } from '@/lib/api';
import { createAdminSupabase } from '@/lib/supabase';
import { nativePushAccessToken, nativePushConfig, sendNativePush, validNativePushAuthorization, type NativePushDelivery, type PushOutcome } from '@/lib/native-push-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** A private scheduler invokes this; no scheduler or credentials are installed by the code. */
async function run(request: Request): Promise<Response> {
  const secret = process.env.PRINTLY_NATIVE_PUSH_CRON_SECRET ?? '';
  if (!validNativePushAuthorization(request.headers.get('authorization'), secret)) return jsonError(401, 'unauthorized', 'Unauthorized.');
  const config = nativePushConfig();
  if (!config) return jsonError(503, 'unavailable', 'Notification worker is not configured.');
  // Do not consume outbox attempts if Google authorization is unavailable.
  let accessToken: string;
  try { accessToken = await nativePushAccessToken(config.credentials); }
  catch { return jsonError(503, 'unavailable', 'Notification worker authorization is unavailable.'); }
  const admin = createAdminSupabase();
  try {
    const claimed = await admin.rpc('claim_native_push_deliveries', { p_limit: 30 });
    if (claimed.error || !Array.isArray(claimed.data)) return jsonError(503, 'unavailable', 'Notification queue is unavailable.');
    const outcomes = await Promise.all((claimed.data as NativePushDelivery[]).map(async (delivery) => {
      let outcome: PushOutcome;
      try { outcome = await sendNativePush(delivery, accessToken, config.target); } catch { outcome = 'retry'; }
      try {
        const finished = await admin.rpc('finish_native_push_delivery', { p_id: delivery.delivery_id, p_lease: delivery.lease_token, p_outcome: outcome });
        // The database can turn an old UNREGISTERED result into a retry if
        // that device re-registered while the send was in flight.
        return !finished.error && ['sent', 'gone', 'retry', 'drop'].includes(finished.data) ? finished.data : 'unconfirmed';
      } catch { return 'unconfirmed'; }
    }));
    // Cleanup is bounded and not needed for delivery; report failure without
    // losing the results. No message or device identifiers leave this worker.
    const sweep = await admin.rpc('sweep_native_push');
    const count = (value: string) => outcomes.filter((result) => result === value).length;
    const unconfirmed = count('unconfirmed');
    return jsonOk({ claimed: outcomes.length, accepted: count('sent'), retried: count('retry'), unregistered: count('gone'), discarded: count('drop'), unconfirmed, cleanup_ok: !sweep.error }, {
      status: unconfirmed || sweep.error ? 503 : 200, headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch { return jsonError(503, 'unavailable', 'Notification queue is unavailable.'); }
}

// GET supports Vercel Cron; POST supports a private external/Supabase scheduler.
export const GET = run;
export const POST = run;
