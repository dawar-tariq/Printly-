// TEMPORARY: a single approved managed-notification test for isolated QA only.
// Remove this route and the one-shot database helper immediately after use.
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
const TEST_EVENT = '997a24b9-9460-4565-833c-f0cfbe580f11';
const TEST_RUN = 'e320520dd717';
const VALIDATION_TOPIC = 'qa-managed-validation-e320520dd717';
const expected = {
  title: 'Printly QA test', message: 'This is a test notification. No action is needed.',
  notification_type: 'general', tap_action: 'home', image_url: null,
} as const;

function privateResponse(response: Response): Response {
  response.headers.set('Cache-Control', 'private, no-store');
  return response;
}
function error(status: number, message: string): Response {
  return privateResponse(jsonError(status, 'unavailable', message));
}
function configFor(request: Request): NativePushConfig | Response {
  // A valid scheduler secret is insufficient outside the dedicated QA project
  // or if the ordinary isolated worker is not explicitly kept disabled.
  if (nativePushTarget() !== 'isolated') return error(404, 'Not found.');
  if (!validNativePushAuthorization(request.headers.get('authorization'), process.env.PRINTLY_NATIVE_PUSH_CRON_SECRET ?? '')) {
    return error(401, 'Unauthorized.');
  }
  if (process.env.PRINTLY_ISOLATED_NATIVE_PUSH_DELIVERY_ENABLED !== '0') return error(503, 'The normal test worker must remain disabled.');
  const config = nativePushConfig();
  return config?.target === 'isolated' ? config : error(503, 'Test notification service is not configured.');
}

// FCM validate_only does not deliver. Never expose upstream response bodies.
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

/** OAuth/FCM validation for the QA project; never reads a device or sends. */
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

/** One POST can claim only the fixed test for the one eligible v2 QA device. */
export async function POST(request: Request): Promise<Response> {
  const config = configFor(request);
  if (config instanceof Response) return config;
  if (request.headers.get('x-printly-qa-test') !== TEST_RUN) return error(403, 'Test run mismatch.');
  let accessToken: string;
  try { accessToken = await nativePushAccessToken(config.credentials); }
  catch { return error(503, 'Test notification authorization is unavailable.'); }
  try {
    const admin = createAdminSupabase();
    // This service-only RPC refuses general-worker grants, other pending work,
    // anything but one eligible v2 QA registration, and every duplicate call.
    // Its first claim uses attempts=8, so an uncertain send is never retried.
    const claim = await admin.rpc('claim_printly_qa_v2_e320520dd717_once');
    if (claim.error || !Array.isArray(claim.data)) return error(503, 'Test delivery is unavailable.');
    if (claim.data.length === 0) return error(409, 'No eligible one-time test delivery.');
    if (claim.data.length !== 1) return error(503, 'Test delivery could not be safely selected.');
    const delivery = claim.data[0] as NativePushDelivery;
    if (delivery.event_id !== TEST_EVENT || delivery.kind !== 'general') return error(503, 'Test delivery could not be safely selected.');
    const finish = async (intended: 'sent' | 'drop'): Promise<boolean> => {
      try {
        const result = await admin.rpc('finish_native_push_delivery_logged', {
          p_id: delivery.delivery_id, p_lease: delivery.lease_token, p_outcome: intended,
        });
        return !result.error && result.data === intended;
      } catch { return false; }
    };
    const result = await admin.rpc('native_push_campaign_payload', { p_delivery: delivery.delivery_id, p_lease: delivery.lease_token });
    const content = result.data as Record<string, unknown> | null;
    const exact = !result.error && !!content && Object.keys(content).length === Object.keys(expected).length &&
      Object.entries(expected).every(([key, value]) => content[key] === value);
    const managed = { ...delivery, campaign: content };
    const payload = exact ? nativePushMessage(managed, 'isolated') : null;
    const checked = payload ? await validateOnly(payload, accessToken) : { ok: false, status: 0 };
    if (!checked.ok) {
      const recorded = await finish('drop');
      return privateResponse(jsonOk({ attempted: false, validation: 'failed', fcm_http_status: checked.status, recorded }, { status: 503 }));
    }
    let outcome: PushOutcome;
    try { outcome = await sendNativePush(managed, accessToken, 'isolated'); }
    catch { outcome = 'retry'; }
    // A timeout can mean FCM accepted the message but its response was lost.
    // Record every non-success as terminal; never issue a second live send.
    const recorded = await finish(outcome === 'sent' ? 'sent' : 'drop');
    return privateResponse(jsonOk({ attempted: true, fcm_result: outcome, recorded }, {
      status: outcome === 'sent' && recorded ? 200 : 503,
    }));
  } catch { return error(503, 'Test notification service is unavailable.'); }
}
