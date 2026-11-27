import { jsonError, jsonOk } from '@/lib/api';
import { createAdminSupabase } from '@/lib/supabase';
import { nativePushAccessToken, nativePushConfig, nativePushDatabaseSchedulerConfig, sendNativePush, validNativePushAuthorization, type NativePushDelivery, type PushOutcome } from '@/lib/native-push-server';
import { nativePushWorkerEnabled } from '@/lib/native-push-worker-gate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** A private scheduler invokes this; no scheduler or credentials are installed by the code. */
async function run(request: Request): Promise<Response> {
  const header = request.headers.get('authorization');
  const secret = process.env.PRINTLY_NATIVE_PUSH_CRON_SECRET ?? '';
  const legacyAuthorized = validNativePushAuthorization(header, secret);
  let config = legacyAuthorized ? nativePushConfig() : null;
  if (legacyAuthorized && !config) return jsonError(503, 'unavailable', 'Notification worker is not configured or is disabled.');
  if (!config) {
    const dbConfig = nativePushDatabaseSchedulerConfig();
    if (!dbConfig || !header || !/^Bearer [a-f0-9]{64}$/.test(header)) return jsonError(401, 'unauthorized', 'Unauthorized.');
    try {
      const auth = await createAdminSupabase().rpc('verify_native_push_scheduler_secret', { p_secret: header.slice(7) });
      if (auth.error || auth.data !== true) return jsonError(401, 'unauthorized', 'Unauthorized.');
      config = { ...dbConfig, cronSecret: '' };
    } catch { return jsonError(503, 'unavailable', 'Scheduler authorization unavailable.'); }
  }
  if (!nativePushWorkerEnabled(config.target)) return jsonError(503, 'unavailable', 'Notification worker is not configured or is disabled.');
  // The isolated gate above stops even authorized requests before OAuth, queue
  // access or delivery. Device registration uses its own configuration check.
  // Do not consume outbox attempts if Google authorization is unavailable.
  let accessToken: string;
  try { accessToken = await nativePushAccessToken(config.credentials); }
  catch { return jsonError(503, 'unavailable', 'Notification worker authorization is unavailable.'); }
  const admin = createAdminSupabase();
  try {
    // This server-side transition runs regardless of whether an admin browser is
    // open. The database locks each campaign against cancellation/other workers.
    const enqueued = await admin.rpc('enqueue_due_native_notification_campaigns', { p_limit: 5 });
    if (enqueued.error || typeof enqueued.data !== 'number') return jsonError(503, 'unavailable', 'Scheduled notifications are unavailable.');
    const claimed = await admin.rpc('claim_native_push_deliveries_budgeted', { p_limit: 30 });
    if (claimed.error || !Array.isArray(claimed.data)) return jsonError(503, 'unavailable', 'Notification queue is unavailable.');
    const outcomes = await Promise.all((claimed.data as NativePushDelivery[]).map(async (delivery) => {
      let outcome: PushOutcome;
      try {
        if (delivery.kind !== 'order' && delivery.kind !== 'payment') {
          const payload = await admin.rpc('native_push_campaign_payload', { p_delivery: delivery.delivery_id, p_lease: delivery.lease_token });
          // A transient database error should retry, while a disappeared lease or
          // revoked membership must not result in an admin message being sent.
          if (payload.error) outcome = 'retry';
          else if (!payload.data) outcome = 'drop';
          else outcome = await sendNativePush({ ...delivery, campaign: payload.data }, accessToken, config.target);
        } else if (delivery.kind === 'order') {
          const token = await admin.rpc('native_push_order_token', { p_delivery: delivery.delivery_id, p_lease: delivery.lease_token });
          // A failed lookup may be transient; a missing lease must not send.
          // A valid older app or absent token still gets the generic notice.
          if (token.error) outcome = 'retry';
          else if (!token.data || typeof token.data !== 'object' || Array.isArray(token.data) || !('token' in token.data)) outcome = 'drop';
          else outcome = await sendNativePush({ ...delivery, orderToken: token.data.token }, accessToken, config.target);
        } else outcome = await sendNativePush(delivery, accessToken, config.target);
      } catch { outcome = 'retry'; }
      try {
        const finished = await admin.rpc('finish_native_push_delivery_logged', { p_id: delivery.delivery_id, p_lease: delivery.lease_token, p_outcome: outcome });
        // The database can turn an old UNREGISTERED result into a retry if
        // that device re-registered while the send was in flight.
        return !finished.error && ['sent', 'gone', 'retry', 'drop'].includes(finished.data) ? finished.data : 'unconfirmed';
      } catch { return 'unconfirmed'; }
    }));
    // Cleanup is bounded and not needed for delivery; report failure without
    // losing the results. No message or device identifiers leave this worker.
    const sweep = await admin.rpc('sweep_native_push');
    const completed = await admin.rpc('complete_native_notification_campaigns');
    const count = (value: string) => outcomes.filter((result) => result === value).length;
    const unconfirmed = count('unconfirmed');
    const cleanupOk = !sweep.error && !completed.error;
    return jsonOk({ campaigns_queued: enqueued.data, claimed: outcomes.length, accepted: count('sent'), retried: count('retry'), unregistered: count('gone'), discarded: count('drop'), unconfirmed, cleanup_ok: cleanupOk }, {
      status: unconfirmed || !cleanupOk ? 503 : 200, headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch { return jsonError(503, 'unavailable', 'Notification queue is unavailable.'); }
}

// GET supports Vercel Cron; POST supports a private external/Supabase scheduler.
export const GET = run;
export const POST = run;
