import { getSessionProfile, jsonOk, jsonError } from '@/lib/api';
import { createAdminSupabase } from '@/lib/supabase';
import { onboardingChecklist, onboardingCompleteness } from '@/lib/onboarding';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSessionProfile();
  if (!session || session.profile?.role !== 'admin') return jsonError(403, 'forbidden', 'Admin only');

  const admin = createAdminSupabase();
  const { data: shop, error } = await admin.from('shops')
    .select('id, owner_id, slug, short_code, name, address, city, phone, gstin, upi_id, kyc_status, status, eta_minutes, rush_surcharge_bps, rating_avg, rating_count, created_at, updated_at, owner:profiles!shops_owner_id_fkey(id, email, full_name, phone, created_at)')
    .eq('id', id).maybeSingle();
  if (error) return jsonError(500, 'db', error.message);
  if (!shop) return jsonError(404, 'not_found', 'Shop not found');

  const [obRes, svcRes, invRes, ratesRes, staffRes, subscriptionRes] = await Promise.all([
    admin.from('shop_onboarding').select('*').eq('shop_id', id).maybeSingle(),
    admin.from('shop_services').select('*').eq('shop_id', id).order('display_order'),
    admin.from('inventory_items').select('*').eq('shop_id', id).order('created_at'),
    admin.from('rate_card').select('service').eq('shop_id', id),
    admin.from('shop_staff').select('*, profile:profiles!shop_staff_user_id_fkey(email, full_name)').eq('shop_id', id),
    admin.from('shop_subscriptions').select('shop_id, term, started_at, expires_at, is_permanent').eq('shop_id', id).maybeSingle(),
  ]);
  if (subscriptionRes.error) return jsonError(503, 'db', 'Could not load subscription status. Please retry.');

  const onboarding = obRes.data ?? null;
  const services = svcRes.data ?? [];
  const inventory = invRes.data ?? [];
  const enabledServices = services.filter((s) => s.enabled).length;
  const checklist = onboardingChecklist(shop, onboarding, { inventoryCount: inventory.length, enabledServices });
  const completeness = onboardingCompleteness(shop, onboarding, { inventoryCount: inventory.length, enabledServices });

  return jsonOk({
    shop,
    subscription: subscriptionRes.data ?? null,
    onboarding,
    services,
    inventory,
    rate_count: (ratesRes.data ?? []).length,
    staff: staffRes.data ?? [],
    checklist,
    completeness,
  });
}
