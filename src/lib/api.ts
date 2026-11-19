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

/** Shop ids the current user can operate. Empty when not staff/admin. */
export async function getStaffContext() {
  const session = await getSessionProfile();
  if (!session) return null;
  const { user, profile } = session;
  const admin = createAdminSupabase();
  const isAdmin = profile?.role === 'admin';
  let shopIds: string[] = [];
  if (isAdmin) {
    const { data } = await admin.from('shops').select('id').limit(200);
    shopIds = (data ?? []).map((s) => s.id);
  } else {
    const { data } = await admin.from('shop_staff').select('shop_id').eq('user_id', user.id);
    shopIds = (data ?? []).map((s) => s.shop_id);
  }
  return { user, profile, isAdmin, shopIds, admin };
}

export async function assertStaffOfShop(shopId: string) {
  const staff = await getStaffContext();
  if (!staff) return null;
  if (staff.isAdmin || staff.shopIds.includes(shopId)) return staff;
  return null;
}
