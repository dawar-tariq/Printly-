import { NextResponse } from 'next/server';
import { createServerSupabase, createAdminSupabase } from '@/lib/supabase';
import { subscriptionState, type ShopSubscription } from '@/lib/subscription';

export function jsonOk(data: unknown, init: ResponseInit = {}) {
  return NextResponse.json(data, init);
}
export function jsonError(status: number, code: string, message: string) {
  return NextResponse.json({ error: { code, message } }, { status });
}

/** Current user + profile; null when signed out. */
export async function getSessionProfile() {
  const supabase = await createServerSupabase();
  const { data: { user }, error: userErr } = await supabase.auth.getUser();
  if (userErr || !user) return null;
  const admin = createAdminSupabase();
  const { data: profile } = await admin
    .from('profiles').select('id, email, full_name, phone, role').eq('id', user.id).single();
  return { user, profile, supabase };
}

/** Membership and subscription are checked server-side on every shop API. */
export async function getStaffContext(options: { allowExpired?: boolean } = {}) {
  const session = await getSessionProfile();
  if (!session) return null;
  const { user, profile } = session;
  const admin = createAdminSupabase();
  const isAdmin = profile?.role === 'admin';
  const { data, error } = isAdmin
    ? { data: [], error: null }
    : await admin.from('shop_staff').select('shop_id').eq('user_id', user.id);
  // Fail closed if memberships or entitlements cannot be loaded.
  const allShopIds: string[] = error ? [] : (data ?? []).map((s) => s.shop_id);
  const subscriptions = allShopIds.length
    ? await admin.from('shop_subscriptions').select('shop_id, term, started_at, expires_at, is_permanent, updated_at').in('shop_id', allShopIds)
    : { data: [], error: null };
  const rows = (subscriptions.data ?? []) as ShopSubscription[];
  const activeShopIds = subscriptions.error ? [] : allShopIds.filter((id) => subscriptionState(rows.find((s) => s.shop_id === id)).active);
  const shopIds = options.allowExpired ? allShopIds : activeShopIds;
  return { user, profile, isAdmin, shopIds, allShopIds, activeShopIds, subscriptions: rows, membershipError: !!error, subscriptionError: !!subscriptions.error, admin };
}

/** Expired shops may only access already-placed or already-started UPI orders. */
export async function assertStaffOfShop(shopId: string, options: { recoveryOrderId?: string } = {}) {
  const staff = await getStaffContext({ allowExpired: true });
  if (!staff || staff.isAdmin || !staff.allShopIds.includes(shopId)) return null;
  if (staff.activeShopIds.includes(shopId)) return staff;
  if (!options.recoveryOrderId) return null;
  const { data: order, error } = await staff.admin.from('orders').select('status, payment_method')
    .eq('id', options.recoveryOrderId).eq('shop_id', shopId).maybeSingle();
  if (error || !order) return null;
  // A specific already-placed order may also be opened by its tracking ID for
  // payment issues, even after completion/cancellation. Unsubmitted drafts stay locked.
  const recoverable = order.status !== 'draft' || order.payment_method === 'upi';
  return recoverable ? staff : null;
}
