// TEMPORARY: isolated, one-phone QA diagnostic and dispatch. Remove after testing.
import { jsonError, jsonOk } from '@/lib/api';
import { createAdminSupabase } from '@/lib/supabase';
import {
  nativePushAccessToken, nativePushConfig, nativePushMessage, nativePushTarget,
  QA_ANDROID_PACKAGE, QA_FCM_PROJECT, sendNativePush, validNativePushAuthorization,
  type NativePushConfig, type NativePushDelivery, type PushOutcome,
} from '@/lib/native-push-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;
const TEST_EVENT = '3b1c6a49-f9f9-447b-ac45-6f399ea5d974';
const VALIDATION_TOPIC = 'qa-validation-c47d26a62fcb3059fc4920e3fdea6cf5';

function privateResponse(response: Response): Response {
  response.headers.set('Cache-Control', 'private, no-store');
  return response;
}
function error(status: number, message: string): Response {
  return privateResponse(jsonError(status, 'unavailable', message));
}
function configFor(request: Request): NativePushConfig | Response {
  // Even a valid scheduler credential is insufficient outside the complete
  // dedicated QA isolation guard. The caller cannot choose a project or event.
  if (nativePushTarget() !== 'isolated') return error(404, 'Not found.');
  if (!validNativePushAuthorization(request.headers.get('authorization'), process.env.PRINTLY_NATIVE_PUSH_CRON_SECRET ?? '')) {
    return error(401, 'Unauthorized.');
  }
  const config = nativePushConfig();
  return config?.target === 'isolated' ? config : error(503, 'Test notification service is not configured.');
}

// The FCM REST API explicitly guarantees validate_only does not deliver. This
// helper always sets the flag itself and never returns the upstream response.
async function validateOnly(message: Record<string, unknown>, accessToken: string): Promise<{ ok: boolean; status: number }> {
  try {
    const response = await fetch(`https://fcm.googleapis.com/v1/projects/${QA_FCM_PROJECT}/messages:send`, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10_000),
      headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ ...message, validate_only: true }),
    });
    return { ok: response.ok, status: response.status };
  } catch { return { ok: false, status: 0 }; }
}

/** Authenticated no-delivery check of the stored QA key, OAuth and FCM IAM/API. */
export async function GET(request: Request): Promise<Response> {
  const config = configFor(request);
  if (config instanceof Response) return config;
  let accessToken: string;
  try { accessToken = await nativePushAccessToken(config.credentials); }
  catch { return error(503, 'Test notification authorization is unavailable.'); }
  const checked = await validateOnly({ message: {
    topic: VALIDATION_TOPIC, data: { purpose: 'isolated_qa_validate_only' },
    android: { restricted_package_name: QA_ANDROID_PACKAGE },
  } }, accessToken);
  return privateResponse(jsonOk({ oauth: 'ok', validation: checked.ok ? 'ok' : 'failed', fcm_http_status: checked.status }, {
    status: checked.ok ? 200 : 503,
  }));
}

/** One POST can create/lease only the fixed synthetic event for the sole QA phone. */
export async function POST(request: Request): Promise<Response> {
  const config = configFor(request);
  if (config instanceof Response) return config;
  let accessToken: string;
  try { accessToken = await nativePushAccessToken(config.credentials); }
  catch { return error(503, 'Test notification authorization is unavailable.'); }
  try {
    const admin = createAdminSupabase();
    // The temporary service-only RPC checks that the *only* registered device
    // belongs to the fixed QA owner/shop. It inserts the fixed event once and
    // sets attempts to the maximum before returning, so even an ambiguous FCM
    // timeout or worker crash cannot cause a normal worker to retry this test.
    const claim = await admin.rpc('claim_printly_qa_c47d26a6_once');
    if (claim.error || !Array.isArray(claim.data)) return error(503, 'Test delivery is unavailable.');
    if (claim.data.length === 0) return error(409, 'No eligible one-time test delivery.');
    if (claim.data.length !== 1) return error(503, 'Test delivery could not be safely selected.');
    const delivery = claim.data[0] as NativePushDelivery;
    if (delivery.event_id !== TEST_EVENT || delivery.kind !== 'order') return error(503, 'Test delivery could not be safely selected.');
    const payload = nativePushMessage(delivery, 'isolated');
    const checked = payload ? await validateOnly(payload, accessToken) : { ok: false, status: 0 };
    const finish = async (intended: 'sent' | 'drop'): Promise<boolean> => {
      try {
        const result = await admin.rpc('finish_native_push_delivery', {
          p_id: delivery.delivery_id, p_lease: delivery.lease_token, p_outcome: intended,
        });
        return !result.error && result.data === intended;
      } catch { return false; }
    };
    if (!checked.ok) {
      const recorded = await finish('drop');
      return privateResponse(jsonOk({ attempted: false, validation: 'failed', fcm_http_status: checked.status, recorded }, { status: 503 }));
    }
    let outcome: PushOutcome;
    try { outcome = await sendNativePush(delivery, accessToken, 'isolated'); }
    catch { outcome = 'retry'; }
    // A one-off test is never requeued. A retry/timeout can mean FCM accepted
    // the send but its response was lost; do not make a second send.
    const intended = outcome === 'sent' ? 'sent' : 'drop';
    const recorded = await finish(intended);
    return privateResponse(jsonOk({ attempted: true, fcm_result: outcome, recorded }, {
      status: outcome === 'sent' && recorded ? 200 : 503,
    }));
  } catch { return error(503, 'Test notification service is unavailable.'); }
}
