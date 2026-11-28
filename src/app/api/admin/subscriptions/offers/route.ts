import { z } from 'zod';
import { getSessionProfile, jsonError, jsonOk } from '@/lib/api';
import { readJsonBody } from '@/lib/request-body';
import { promoCodeSchema, subscriptionTermSchema } from '@/lib/subscription-offers';
import { subscriptionMutationError } from '@/lib/subscription-server';
import { createAdminSupabase } from '@/lib/supabase';

const noStore = { headers: { 'Cache-Control': 'private, no-store' } };
const version = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).nullable();
const date = z.string().datetime({ offset: true }).nullable();
const page = z.string().regex(/^(0|[1-9]\d{0,4})$/).transform(Number).refine((value) => value <= 10000);
const limit = (maximum: number) => z.number().int().min(1).max(maximum).nullable();
const datesAreOrdered = (value: { starts_at: string | null; ends_at: string | null }) =>
  !value.starts_at || !value.ends_at || Date.parse(value.ends_at) > Date.parse(value.starts_at);
const promo = z.object({
  code: promoCodeSchema,
  discount_type: z.enum(['percent', 'fixed']),
  discount_value: z.number().int().min(1).max(100_000_000),
  terms: z.array(subscriptionTermSchema).min(1).max(3).refine((terms) => new Set(terms).size === terms.length),
  starts_at: date, ends_at: date,
  max_uses: limit(1_000_000), max_uses_per_shop: limit(1000), enabled: z.boolean(),
}).strict().refine((value) => value.discount_type !== 'percent' || value.discount_value <= 100).refine(datesAreOrdered);
const announcement = z.object({
  title: z.string().trim().min(1).max(100), message: z.string().trim().min(1).max(400),
  promo_code: promoCodeSchema.nullable(), starts_at: date, ends_at: date,
  enabled: z.boolean(), public_visible: z.boolean(),
}).strict().refine(datesAreOrdered);
const input = z.discriminatedUnion('action', [
  z.object({ action: z.literal('save_promo'), id: z.string().uuid().nullable(), expected_version: version, promo }).strict(),
  z.object({ action: z.literal('save_announcement'), id: z.string().uuid().nullable(), expected_version: version, announcement }).strict(),
]).refine((value) => (value.id === null) === (value.expected_version === null));

async function adminSession() {
  const session = await getSessionProfile();
  return session?.profile?.role === 'admin' ? session : null;
}

export async function GET(req: Request) {
  const session = await adminSession();
  if (!session) return jsonError(403, 'forbidden', 'Admin only.');
  const params = new URL(req.url).searchParams;
  const promoPage = page.safeParse(params.get('promo_page') ?? '0');
  const announcementPage = page.safeParse(params.get('announcement_page') ?? '0');
  if (!promoPage.success || !announcementPage.success) return jsonError(422, 'validation', 'Invalid offer page.');
  const { data, error } = await createAdminSupabase().rpc('admin_subscription_offers', {
    p_actor: session.user.id, p_promo_page: promoPage.data, p_announcement_page: announcementPage.data,
  });
  if (error) return subscriptionMutationError(error);
  if (!data || !Array.isArray(data.promos) || !Array.isArray(data.announcements) ||
      typeof data.promos_has_more !== 'boolean' || typeof data.announcements_has_more !== 'boolean') return jsonError(503, 'db', 'Could not load offers. Please retry.');
  return jsonOk(data, noStore);
}

export async function POST(req: Request) {
  const session = await adminSession();
  if (!session) return jsonError(403, 'forbidden', 'Admin only.');
  const parsed = input.safeParse(await readJsonBody(req));
  if (!parsed.success) return jsonError(422, 'validation', 'Check the code, discount, eligible terms, dates and limits, then try again.');
  const body = parsed.data;
  const { data, error } = await createAdminSupabase().rpc(
    body.action === 'save_promo' ? 'save_subscription_promo' : 'save_subscription_announcement',
    { p_actor: session.user.id, p_id: body.id, p_expected_version: body.expected_version,
      p_input: body.action === 'save_promo' ? body.promo : body.announcement },
  );
  if (error) return subscriptionMutationError(error);
  if (!data) return jsonError(503, 'db', 'Could not confirm the saved offer. Reload before trying again.');
  return jsonOk({ ok: true, result: data }, noStore);
}
