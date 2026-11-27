import { createClient } from '@supabase/supabase-js';
import { jsonError } from '@/lib/api';
import { SUPABASE_ANON, SUPABASE_URL } from '@/lib/supabase-client';
import { withVerifiedNativeSession } from '@/lib/native-session';
import * as me from '@/lib/native-me';
import * as applicationStatus from '@/lib/native-application-status';
import * as board from '@/app/api/shop/board/route';
import * as orders from '@/app/api/shop/orders/route';
import * as order from '@/lib/native-order';
import * as status from '@/app/api/shop/orders/[id]/status/route';
import * as payment from '@/app/api/shop/orders/[id]/confirm-payment/route';
import * as fileDownload from '@/app/api/shop/orders/[id]/files/[fileId]/download/route';
import * as filePreview from '@/app/api/shop/orders/[id]/files/[fileId]/preview/route';
import * as inventory from '@/app/api/shop/inventory/route';
import * as inventoryItem from '@/lib/native-inventory';
import * as reports from '@/lib/native-reports';
import * as settings from '@/app/api/shop/settings/route';
import * as rates from '@/lib/native-rate-card';
import * as subscription from '@/app/api/shop/subscription/route';
import * as subscriptionStatus from '@/app/api/shop/subscription/status/route';
import * as recovery from '@/lib/native-recovery';
import * as pushDevice from '@/lib/native-push-device';
import * as availability from '@/app/api/shop/availability/route';
import * as qr from '@/app/api/shop/qr/route';
import * as standee from '@/app/api/shop/standee/route';
import * as nameProof from '@/app/api/shop/name-proof/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ parts: string[] }> };
type Handler = (request: Request) => Promise<Response>;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Only these shop handlers can be invoked; this is not an arbitrary proxy. */
function endpoint(method: string, p: string[]): Handler | null {
  const key = p.join('/');
  if (p.length === 1) {
    if (method === 'GET' && key === 'me') return () => me.GET();
    if (method === 'GET' && key === 'application-status') return () => applicationStatus.GET();
    if (method === 'POST' && key === 'board') return board.POST;
    if (method === 'GET' && key === 'orders') return orders.GET;
    if (method === 'GET' && key === 'inventory') return inventoryItem.GET;
    if (method === 'POST' && key === 'inventory') return inventory.POST;
    if (method === 'GET' && key === 'reports') return reports.GET;
    if (method === 'PUT' && key === 'settings') return settings.PUT;
    if (method === 'GET' && key === 'rate-card') return rates.GET;
    if (method === 'GET' && key === 'subscription') return subscription.GET;
    if (method === 'POST' && key === 'subscription') return subscription.POST;
    if (method === 'GET' && key === 'recovery') return recovery.GET;
    if (method === 'POST' && key === 'push-device') return pushDevice.POST;
    if (method === 'DELETE' && key === 'push-device') return pushDevice.DELETE;
    if (method === 'POST' && key === 'push-display') return pushDevice.POST_DISPLAY;
    if (method === 'PUT' && key === 'availability') return availability.PUT;
    if (method === 'GET' && key === 'qr') return qr.GET;
    if (method === 'GET' && key === 'standee') return standee.GET;
    if (method === 'POST' && key === 'name-proof') return nameProof.POST;
  }
  if (method === 'GET' && key === 'subscription/status') return subscriptionStatus.GET;
  if (p.length === 2 && p[0] === 'rate-card' && uuid.test(p[1]) && method === 'PATCH') {
    const params = { params: Promise.resolve({ id: p[1] }) };
    return (request) => rates.PATCH(request, params);
  }
  if (p.length === 2 && p[0] === 'inventory' && uuid.test(p[1])) {
    const params = { params: Promise.resolve({ id: p[1] }) };
    if (method === 'PATCH') return (request) => inventoryItem.PATCH(request, params);
    if (method === 'DELETE') return (request) => inventoryItem.DELETE(request, params);
  }
  if (p[0] === 'orders' && uuid.test(p[1] ?? '')) {
    const params = { params: Promise.resolve({ id: p[1] }) };
    if (p.length === 2 && method === 'GET') return (request) => order.GET(request, params);
    if (p.length === 3 && method === 'POST' && p[2] === 'status') return (request) => status.POST(request, params);
    if (p.length === 3 && method === 'POST' && p[2] === 'confirm-payment') return (request) => payment.POST(request, params);
    if (p.length === 5 && method === 'GET' && p[2] === 'files' && uuid.test(p[3])) {
      const fileParams = { params: Promise.resolve({ id: p[1], fileId: p[3] }) };
      if (p[4] === 'download') return (request) => fileDownload.GET(request, fileParams);
      if (p[4] === 'preview') return (request) => filePreview.GET(request, fileParams);
    }
  }
  return null;
}

function privateResponse(response: Response): Response {
  response.headers.set('Cache-Control', 'private, no-store, max-age=0');
  response.headers.set('Vary', 'Authorization');
  response.headers.set('X-Content-Type-Options', 'nosniff');
  return response;
}

async function handle(request: Request, context: Params): Promise<Response> {
  const { parts } = await context.params;
  const selected = endpoint(request.method, parts);
  if (!selected) return privateResponse(jsonError(404, 'not_found', 'Not found.'));

  // A browser cookie is never a fallback for this native endpoint. Do not
  // decode/trust JWT claims locally: Auth must verify the token on every call.
  const authorization = request.headers.get('authorization') ?? '';
  const match = /^Bearer ([A-Za-z0-9_.-]{1,8192})$/i.exec(authorization);
  if (!match) return privateResponse(jsonError(401, 'unauthorized', 'Sign in required.'));
  if (!SUPABASE_URL || !SUPABASE_ANON) return privateResponse(jsonError(503, 'auth_unavailable', 'Sign-in service is unavailable.'));
  const token = match[1];
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  let result;
  try { result = await supabase.auth.getUser(token); }
  catch { return privateResponse(jsonError(503, 'auth_unavailable', 'Sign-in service is unavailable.')); }
  if (result.error) {
    const status = result.error.status;
    return privateResponse(status === 400 || status === 401 || status === 403
      ? jsonError(401, 'unauthorized', 'Session expired. Please sign in again.')
      : jsonError(503, 'auth_unavailable', 'Sign-in service is unavailable.'));
  }
  if (!result.data.user) return privateResponse(jsonError(401, 'unauthorized', 'Sign in required.'));

  try {
    // The original handlers still perform their normal shop-membership,
    // subscription and mutation checks. No service-role key reaches the app.
    const response = await withVerifiedNativeSession({ user: result.data.user, supabase }, () => selected(request));
    return privateResponse(response);
  } catch {
    return privateResponse(jsonError(503, 'unavailable', 'Could not complete the request. Refresh before retrying.'));
  }
}

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
