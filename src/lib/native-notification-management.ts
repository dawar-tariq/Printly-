import { z } from 'zod';

// Shared, non-secret contracts. Neither the console nor the APK receives an
// FCM credential. Actions are enum destinations, never arbitrary deep links.
export const notificationTypes = ['general', 'important', 'feature', 'maintenance', 'promotion', 'update'] as const;
export const notificationActions = ['home', 'orders', 'announcement', 'maintenance', 'update'] as const;
export const audienceKinds = ['all', 'shops', 'devices', 'version', 'inactive'] as const;
export type NotificationType = typeof notificationTypes[number];
export type NotificationAction = typeof notificationActions[number];
export type AudienceKind = typeof audienceKinds[number];

const id = z.string().uuid();
const version = z.number().int().min(1).max(999_999_999);
const revision = z.number().int().min(0).max(2_147_483_647);
// Keep release and notification text compatible with the Android parser:
// tabs/newlines are allowed, but other ASCII control characters are not.
export const hasSafeNativeTextControls = (s: string) => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(s);
const shortText = (max: number) => z.string().trim().min(1).max(max).refine(hasSafeNativeTextControls);
const distinct = (values: string[]) => new Set(values.map((value) => value.toLowerCase())).size === values.length;
const ids = z.array(id).max(100).refine(distinct);
const HASH = /^[0-9a-f]{64}$/;

/** Android Instant.parse accepts at most nine fractional digits and offsets
 * within ±18:00. Zod's general ISO datetime accepts a wider range. */
export const nativeReleaseInstantSchema = z.string().datetime({ offset: true }).refine((value) => {
  const fraction = /\.(\d+)(?=Z|[+-]\d{2}:\d{2}$)/.exec(value);
  if (fraction && fraction[1].length > 9) return false;
  const offset = /[+-](\d{2}):(\d{2})$/.exec(value);
  return !offset || Number(offset[1]) < 18 || (Number(offset[1]) === 18 && Number(offset[2]) === 0);
});

/** Direct public, image-only paths in our own GitHub repository. This avoids
 * server-side URL fetching and device requests to arbitrary/internal hosts. */
export function approvedNotificationImageUrl(raw: string): string | null {
  if (raw.length > 500 || !/^https:\/\/raw\.githubusercontent\.com\/dawar-tariq\/Printly-\/[A-Za-z0-9][A-Za-z0-9._+-]{0,79}(?:\/[A-Za-z0-9][A-Za-z0-9._+-]{0,119})+\.(?:png|jpe?g|webp)$/i.test(raw)) return null;
  try { const url = new URL(raw); return url.toString() === raw && !url.username && !url.password && !url.search && !url.hash ? raw : null; }
  catch { return null; }
}

/** The update manager only advertises APK assets of this exact repository. */
export function approvedGithubApkUrl(raw: string): string | null {
  if (raw.length > 1000 || !/^https:\/\/github\.com\/dawar-tariq\/Printly-\/releases\/download\/[A-Za-z0-9][A-Za-z0-9._+-]{0,79}\/[A-Za-z0-9][A-Za-z0-9._+-]{0,119}\.apk$/.test(raw)) return null;
  try { const url = new URL(raw); return url.toString() === raw && !url.username && !url.password && !url.search && !url.hash ? raw : null; }
  catch { return null; }
}
const image = z.string().trim().refine((value) => approvedNotificationImageUrl(value) !== null).nullable();
export const contentSchema = z.object({
  title: shortText(100).refine((value) => !/[\r\n]/.test(value)),
  message: shortText(500),
  notification_type: z.enum(notificationTypes),
  tap_action: z.enum(notificationActions),
  image_url: image,
}).strict();
export const campaignSchema = contentSchema.extend({
  audience_kind: z.enum(audienceKinds), shop_ids: ids, device_ids: ids, target_version: version.nullable(),
}).strict().refine((value) => {
  if (value.audience_kind === 'shops') return value.shop_ids.length > 0 && !value.device_ids.length && value.target_version === null;
  if (value.audience_kind === 'devices') return value.device_ids.length > 0 && !value.shop_ids.length && value.target_version === null;
  if (value.audience_kind === 'version') return value.target_version !== null && !value.shop_ids.length && !value.device_ids.length;
  return !value.shop_ids.length && !value.device_ids.length && value.target_version === null;
});
export const templateSchema = contentSchema.extend({ name: shortText(80).refine((value) => !/[\r\n]/.test(value)) }).strict();
export const releaseSchema = z.object({
  version_code: version,
  version_name: z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9._+-]{0,39}$/),
  minimum_version_code: version,
  apk_url: z.string().trim().refine((value) => approvedGithubApkUrl(value) !== null),
  apk_sha256: z.string().trim().toLowerCase().regex(HASH),
  certificate_sha256: z.string().trim().toLowerCase().regex(HASH),
  notes: z.string().trim().max(400).refine(hasSafeNativeTextControls),
  mandatory: z.boolean(),
  released_at: nativeReleaseInstantSchema,
}).strict().refine((value) => value.minimum_version_code <= value.version_code);

export const adminMutationSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('save_campaign'), id, revision: revision.nullable(), campaign: campaignSchema }).strict(),
  z.object({ action: z.literal('preview'), campaign: campaignSchema }).strict(),
  z.object({ action: z.literal('queue'), id, revision, request_id: id, scheduled_at: z.string().datetime({ offset: true }).nullable() }).strict(),
  z.object({ action: z.enum(['cancel', 'archive']), id, revision }).strict(),
  z.object({ action: z.literal('retry'), id, request_id: id }).strict(),
  z.object({ action: z.literal('save_template'), id, revision: revision.nullable(), template: templateSchema }).strict(),
  z.object({ action: z.literal('save_release'), id, revision: revision.nullable(), release: releaseSchema }).strict(),
  z.object({ action: z.enum(['publish_release', 'activate_release', 'unpublish_release']), id, revision, request_id: id, notify: z.boolean(), verification_confirmed: z.boolean() }).strict(),
]);

export type CampaignInput = z.infer<typeof campaignSchema>;
export type TemplateInput = z.infer<typeof templateSchema>;
export type ReleaseInput = z.infer<typeof releaseSchema>;
