// TEMPORARY single-attempt synthetic production token alert. Remove after use.
import { authorizedOneShot } from '@/lib/native-one-shot-auth';
import { jsonError, jsonOk } from '@/lib/api';
import { createAdminSupabase } from '@/lib/supabase';
import { nativePushAccessToken, nativePushOneShotCredentials, sendNativePush, type NativePushDelivery } from '@/lib/native-push-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(request: Request): Promise<Response> {
  if (!await authorizedOneShot(request.headers.get('authorization'))) return jsonError(401,'unauthorized','Unauthorized.');
  const config = nativePushOneShotCredentials();
  if (!config) return jsonError(503,'unavailable','Test sender is unavailable.');
  let access: string;
  try { access = await nativePushAccessToken(config.credentials); } catch { return jsonError(503,'unavailable','Google authorization failed.'); }
  // First verify Google API/IAM without delivering or consuming the one shot.
  try {
    const validation = await fetch('https://fcm.googleapis.com/v1/projects/printly-5c247/messages:send', {
      method:'POST', redirect:'error', signal:AbortSignal.timeout(10000), headers:{authorization:`Bearer ${access}`,'content-type':'application/json'},
      body:JSON.stringify({validate_only:true,message:{topic:'printly-production-validation-810af132',data:{purpose:'validate_only'},android:{restricted_package_name:'io.github.dawartariq.printly.owner'}}}),
    });
    if (!validation.ok) return jsonError(503,'unavailable',`Google validation failed (${validation.status}).`);
  } catch { return jsonError(503,'unavailable','Google validation failed.'); }
  const db = createAdminSupabase();
  const claim = await db.rpc('claim_printly_prod_token_test_once');
  if (claim.error || !Array.isArray(claim.data) || claim.data.length !== 1) return jsonError(409,'unavailable','No eligible one-time delivery.');
  const row = claim.data[0] as NativePushDelivery & {order_token: string};
  const lookup = await db.rpc('native_push_order_token', {p_delivery:row.delivery_id,p_lease:row.lease_token});
  const attempted = !lookup.error && lookup.data?.token === 'A-1234567890';
  const outcome = attempted ? await sendNativePush({...row,orderToken:lookup.data.token},access,'production') : 'drop';
  // Never retry an uncertain send. A maximum-attempt lease also prevents the
  // ordinary worker from retrying if the process dies before this update.
  const intended = outcome === 'sent' ? 'sent' : 'drop';
  const finished = await db.rpc('finish_native_push_delivery_logged',{p_id:row.delivery_id,p_lease:row.lease_token,p_outcome:intended});
  return jsonOk({attempted,accepted:outcome==='sent',recorded:!finished.error && finished.data===intended},{status:outcome==='sent' && !finished.error && finished.data===intended ? 200 : 503,headers:{'Cache-Control':'no-store'}});
}
