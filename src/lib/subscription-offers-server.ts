import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createAdminSupabase } from '@/lib/supabase';
import { visibleAnnouncementsSchema, type VisibleAnnouncement } from '@/lib/subscription-offers';

/** Null means unavailable, not an assertion that there are no active offers. */
export async function getVisibleSubscriptionAnnouncements(admin: SupabaseClient, publicOnly: boolean): Promise<VisibleAnnouncement[] | null> {
  try {
    const { data, error } = await admin.rpc('visible_subscription_announcements', { p_public_only: publicOnly });
    if (error) return null;
    const parsed = visibleAnnouncementsSchema.safeParse(data);
    return parsed.success ? parsed.data : null;
  } catch { return null; }
}

/** Public pages publish only the safe fields returned by the server-side RPC. */
export async function getPublicSubscriptionAnnouncements(): Promise<VisibleAnnouncement[] | null> {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return null;
  try { return await getVisibleSubscriptionAnnouncements(createAdminSupabase(), true); }
  catch { return null; }
}
