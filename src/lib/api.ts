import { NextResponse } from 'next/server';
import { createServerSupabase, createAdminSupabase } from '@/lib/supabase';

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

/** Shop access is membership-based; admin review lives in the separate admin console. */
export async function getStaffContext() {
  const session = await getSessionProfile();
  if (!session) return null;
  const { user, profile } = session;
  const admin = createAdminSupabase();
  const isAdmin = profile?.role === 'admin';
  const { data, error } = isAdmin
    ? { data: [], error: null }
    : await admin.from('shop_staff').select('shop_id').eq('user_id', user.id);
  // Fail closed if memberships cannot be loaded.
  const shopIds = error ? [] : (data ?? []).map((s) => s.shop_id);
  return { user, profile, isAdmin, shopIds, admin };
}

export async function assertStaffOfShop(shopId: string) {
  const staff = await getStaffContext();
  if (!staff || staff.isAdmin) return null;
  return staff.shopIds.includes(shopId) ? staff : null;
}
