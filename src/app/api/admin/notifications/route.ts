import { createHmac } from 'node:crypto';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSessionProfile, jsonError, jsonOk } from '@/lib/api';
import { readJsonBody } from '@/lib/request-body';
import { createAdminSupabase } from '@/lib/supabase';
import { adminMutationSchema, notificationTypes } from '@/lib/native-notification-management';
import { verifyGithubReleaseAsset } from '@/lib/native-app-update-server';
import { nativePushConfig, nativePushDatabaseSchedulerConfig } from '@/lib/native-push-server';
import { nativePushWorkerEnabled } from '@/lib/native-push-worker-gate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const noStore = { headers: { 'Cache-Control': 'private, no-store', Vary: 'Cookie' } };
const uuid = z.string().uuid();
const pageSchema = z.string().regex(/^[1-9]\d{0,4}$/).transform(Number).refine((n) => n <= 10000);
const searchSchema = z.string().trim().max(80).regex(/^[\p{L}\p{N} .@-]*$/u);
const dateSchema = z.string().datetime({ offset: true });
const pageSize = 30;

async function session() {
  const result = await getSessionProfile();
  return result?.profile?.role === 'admin' ? result : null;
}
function dbError(error: { message?: string; code?: string } | null | undefined): Response {
  if (error?.message?.includes('ADMIN_REQUIRED')) return jsonError(403, 'forbidden', 'Admin only.');
  if (error?.message?.includes('NOTIFICATION_RATE_LIMIT')) return jsonError(429, 'rate_limited', 'The campaign and retry limit has been reached. Please wait before queueing another.');
  if (error?.message?.includes('NOTIFICATION_SOURCE_INACTIVE')) return jsonError(409, 'source_inactive', 'The original announcement, promotion, maintenance notice or app release is no longer active and cannot be retried.');
  if (error?.message?.includes('NOTIFICATION_REQUEST_CONFLICT')) return jsonError(409, 'request_conflict', 'This request ID was already used for a different action. Refresh before retrying.');
  if (error?.message?.includes('INVALID_SCHEDULE')) return jsonError(422, 'validation', 'Choose a future time within one year.');
  if (error?.message?.includes('CAMPAIGN_CHANGED') || error?.message?.includes('TEMPLATE_CHANGED') || error?.message?.includes('RELEASE_CHANGED')) {
    return jsonError(409, 'changed', 'This item changed. Refresh and review it before trying again.');
  }
  if (error?.code === '23505') return jsonError(409, 'duplicate', 'That version or request already exists. Refresh before retrying.');
  return jsonError(503, 'unavailable', 'Could not complete the request. Refresh before retrying.');
}

/** Bound every mutation by authenticated actor, separately from preview. */
async function limit(actor: string, operation: 'preview' | 'write'): Promise<Response | null> {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key || !uuid.safeParse(actor).success) return jsonError(503, 'unavailable', 'Notification management is unavailable.');
  try {
    const hash = createHmac('sha256', key).update(`native-notification-admin-${operation}-v1:${actor.toLowerCase()}`).digest('hex');
    const result = await createAdminSupabase().rpc('consume_public_rate_limit', { p_bucket: 'checkout', p_client_hash: hash });
    if (result.error || !result.data || typeof result.data.allowed !== 'boolean') return jsonError(503, 'unavailable', 'Notification management is unavailable.');
    if (result.data.allowed) return null;
    const retry = Number.isFinite(result.data.retry_after) ? Math.max(1, Math.min(86400, Math.ceil(result.data.retry_after))) : 60;
    return NextResponse.json({ error: { code: 'rate_limited', message: 'Too many requests. Please wait and try again.' } },
      { status: 429, headers: { 'Retry-After': String(retry), 'Cache-Control': 'private, no-store' } });
  } catch { return jsonError(503, 'unavailable', 'Notification management is unavailable.'); }
}

export async function GET(request: Request): Promise<Response> {
  const actor = await session();
  if (!actor) return jsonError(403, 'forbidden', 'Admin only.');
  const params = new URL(request.url).searchParams;
  const view = params.get('view') ?? 'overview';
  const parsedPage = pageSchema.safeParse(params.get('page') ?? '1');
  if (!parsedPage.success) return jsonError(422, 'validation', 'Invalid page.');
  const page = parsedPage.data;
  const start = (page - 1) * pageSize;
  const admin = createAdminSupabase();
  try {
    if (view === 'overview') {
      const result = await admin.rpc('admin_native_notification_overview', { p_actor: actor.user.id });
      if (result.error || !result.data || typeof result.data !== 'object') return dbError(result.error);
      const config = nativePushConfig() ?? nativePushDatabaseSchedulerConfig();
      return jsonOk({ ...result.data, worker_configured: !!config && nativePushWorkerEnabled(config.target), release_manager_enabled: process.env.PRINTLY_NATIVE_RELEASE_MANAGER_ENABLED === '1' }, noStore);
    }
    if (view === 'campaigns') {
      const q = searchSchema.safeParse(params.get('q') ?? '');
      const type = params.get('type') ?? '';
      const status = params.get('status') ?? '';
      const from = params.get('from') ?? '';
      const to = params.get('to') ?? '';
      if (!q.success || (type && !notificationTypes.includes(type as typeof notificationTypes[number])) ||
          (status && !['draft','scheduled','sending','completed','cancelled','archived'].includes(status)) ||
          (from && !dateSchema.safeParse(from).success) || (to && !dateSchema.safeParse(to).success) ||
          (from && to && Date.parse(from) > Date.parse(to))) return jsonError(422, 'validation', 'Invalid history filter.');
      let query = admin.from('native_notification_campaign_summary').select('*', { count: 'exact' });
      if (q.data) query = query.ilike('title', `%${q.data}%`);
      if (type) query = query.eq('notification_type', type);
      if (status) query = query.eq('status', status); else query = query.neq('status', 'archived');
      if (from) query = query.gte('created_at', from);
      if (to) query = query.lte('created_at', to);
      const result = await query.order('created_at', { ascending: false }).order('id', { ascending: false }).range(start, start + pageSize - 1);
      if (result.error || result.count === null) return dbError(result.error);
      return jsonOk({ campaigns: result.data ?? [], page, count: result.count, pages: Math.max(1, Math.ceil(result.count / pageSize)) }, noStore);
    }
    if (view === 'logs') {
      const campaignId = uuid.safeParse(params.get('id'));
      if (!campaignId.success) return jsonError(422, 'validation', 'Invalid campaign.');
      const result = await admin.from('native_push_delivery_log')
        .select('delivery_id,event_id,binding_id,shop_id,outcome,attempts,displayed_at,created_at,updated_at', { count: 'exact' })
        .eq('campaign_id', campaignId.data).order('created_at', { ascending: false }).order('delivery_id', { ascending: false }).range(start, start + pageSize - 1);
      if (result.error || result.count === null) return dbError(result.error);
      return jsonOk({ logs: result.data ?? [], page, count: result.count, pages: Math.max(1, Math.ceil(result.count / pageSize)) }, noStore);
    }
    if (view === 'targets') {
      const q = searchSchema.safeParse(params.get('q') ?? '');
      if (!q.success) return jsonError(422, 'validation', 'Invalid shop search.');
      let shops = admin.from('shops').select('id,name', { count: 'exact' });
      let devices = admin.from('native_notification_admin_devices').select('*', { count: 'exact' });
      if (q.data) { shops = shops.ilike('name', `%${q.data}%`); devices = devices.ilike('shop_name', `%${q.data}%`); }
      const [shopResult, deviceResult] = await Promise.all([
        shops.order('name').order('id').range(start, start + pageSize - 1),
        devices.order('last_seen_at', { ascending: false }).order('binding_id').range(start, start + pageSize - 1),
      ]);
      if (shopResult.error || deviceResult.error || shopResult.count === null || deviceResult.count === null) return jsonError(503, 'unavailable', 'Could not load targets.');
      return jsonOk({ shops: shopResult.data ?? [], devices: deviceResult.data ?? [], page, shop_count: shopResult.count, device_count: deviceResult.count }, noStore);
    }
    if (view === 'templates') {
      const result = await admin.from('native_notification_templates').select('*', { count: 'exact' }).eq('archived', false)
        .order('updated_at', { ascending: false }).order('id').range(start, start + pageSize - 1);
      if (result.error || result.count === null) return dbError(result.error);
      return jsonOk({ templates: result.data ?? [], page, count: result.count, pages: Math.max(1, Math.ceil(result.count / pageSize)) }, noStore);
    }
    if (view === 'releases') {
      const result = await admin.from('native_app_releases').select('*', { count: 'exact' }).order('version_code', { ascending: false }).range(start, start + pageSize - 1);
      if (result.error || result.count === null) return dbError(result.error);
      return jsonOk({ releases: result.data ?? [], page, count: result.count, pages: Math.max(1, Math.ceil(result.count / pageSize)) }, noStore);
    }
    return jsonError(422, 'validation', 'Invalid view.');
  } catch { return jsonError(503, 'unavailable', 'Could not load notification management. Please retry.'); }
}

export async function POST(request: Request): Promise<Response> {
  const actor = await session();
  if (!actor) return jsonError(403, 'forbidden', 'Admin only.');
  const parsed = adminMutationSchema.safeParse(await readJsonBody(request));
  if (!parsed.success) return jsonError(422, 'validation', 'Check the fields, audience, URL and dates, then try again.');
  const body = parsed.data;
  // The database validates new schedule windows after checking the exact
  // request ID, so a lost response can still be acknowledged after its due time.
  if (['publish_release', 'activate_release', 'unpublish_release'].includes(body.action)) {
    const releaseAction = body as Extract<typeof body, { verification_confirmed: boolean }>;
    if (releaseAction.notify && releaseAction.action !== 'activate_release') return jsonError(422, 'validation', 'Only setting a current release can queue an update notice.');
    if (releaseAction.action !== 'unpublish_release' && !releaseAction.verification_confirmed) return jsonError(422, 'validation', 'Independently verify the APK package, version and signer before publishing.');
  }
  const limited = await limit(actor.user.id, body.action === 'preview' ? 'preview' : 'write');
  if (limited) return limited;
  const admin = createAdminSupabase();
  try {
    let result;
    switch (body.action) {
      case 'save_campaign':
        result = await admin.rpc('save_native_notification_campaign', { p_actor: actor.user.id, p_id: body.id, p_revision: body.revision, p_input: body.campaign }); break;
      case 'preview':
        result = await admin.rpc('preview_native_notification_audience', { p_actor: actor.user.id, p_input: body.campaign }); break;
      case 'queue':
        result = await admin.rpc('queue_native_notification_campaign', { p_actor: actor.user.id, p_id: body.id, p_revision: body.revision, p_request: body.request_id, p_scheduled_at: body.scheduled_at }); break;
      case 'cancel': case 'archive':
        result = await admin.rpc('change_native_notification_campaign', { p_actor: actor.user.id, p_id: body.id, p_revision: body.revision, p_action: body.action }); break;
      case 'retry':
        result = await admin.rpc('retry_native_notification_campaign', { p_actor: actor.user.id, p_id: body.id, p_request: body.request_id }); break;
      case 'save_template':
        result = await admin.rpc('save_native_notification_template', { p_actor: actor.user.id, p_id: body.id, p_revision: body.revision, p_input: body.template }); break;
      case 'save_release':
        result = await admin.rpc('save_native_app_release', { p_actor: actor.user.id, p_id: body.id, p_revision: body.revision, p_input: body.release }); break;
      case 'publish_release': case 'activate_release': case 'unpublish_release': {
        const releaseAction = body.action.replace('_release', '');
        const replayArgs = { p_actor: actor.user.id, p_id: body.id, p_revision: body.revision, p_request: body.request_id, p_action: releaseAction, p_notify: body.notify };
        // A committed request may have lost its HTTP response. Confirm the
        // original action before checking its now-changed revision or GitHub;
        // this is a historical acknowledgment, not another publication.
        const replay = await admin.rpc('native_app_release_request_result', replayArgs);
        if (replay.error) return dbError(replay.error);
        if (replay.data) return jsonOk({ ok: true, result: replay.data }, noStore);
        if (body.action !== 'unpublish_release') {
          if (process.env.PRINTLY_NATIVE_RELEASE_MANAGER_ENABLED !== '1') return jsonError(503, 'release_disabled', 'Enable the release manager server-side after completing the rollout checks.');
          const release = await admin.from('native_app_releases').select('apk_url,apk_sha256,certificate_sha256,revision').eq('id', body.id).maybeSingle();
          if (release.error) return dbError(release.error);
          if (!release.data || release.data.revision !== body.revision) {
            // Another identical request may have committed after the first
            // replay check but before this metadata read.
            const lateReplay = await admin.rpc('native_app_release_request_result', replayArgs);
            if (lateReplay.error) return dbError(lateReplay.error);
            if (lateReplay.data) return jsonOk({ ok: true, result: lateReplay.data }, noStore);
            return jsonError(409, 'changed', 'This release changed. Refresh before trying again.');
          }
          const verified = await verifyGithubReleaseAsset(release.data, process.env.PRINTLY_ANDROID_SIGNING_CERT_SHA256);
          if (verified === 'fingerprint') return jsonError(422, 'signer', 'The release certificate does not match the server’s independently verified public fingerprint.');
          if (verified === 'asset') return jsonError(422, 'asset', 'The published GitHub release asset or its SHA-256 digest does not match.');
          if (verified !== 'ok') return jsonError(503, 'github_unavailable', 'GitHub verification is unavailable. Try again later.');
        }
        result = await admin.rpc('change_native_app_release', replayArgs);
        break;
      }
    }
    if (result.error || !result.data) return dbError(result.error);
    return jsonOk({ ok: true, result: result.data }, noStore);
  } catch { return jsonError(503, 'unavailable', 'Could not complete the request. Refresh before retrying.'); }
}
