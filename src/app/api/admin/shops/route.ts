import { getSessionProfile, jsonOk, jsonError } from '@/lib/api';
import { createAdminSupabase } from '@/lib/supabase';
import { onboardingCompleteness } from '@/lib/onboarding';

export async function GET(req: Request) {
  const session = await getSessionProfile();
  if (!session || session.profile?.role !== 'admin') return jsonError(403, 'forbidden', 'Admin only');
  const url = new URL(req.url);
  const kyc = url.searchParams.get('kyc'); // pending|approved|rejected|changes_requested|all
  const q = (url.searchParams.get('q') ?? '').trim().toLowerCase();

  const admin = createAdminSupabase();
  let query = admin.from('shops')
    .select('id, name, slug, short_code, address, city, phone, gstin, upi_id, kyc_status, status, created_at, owner:profiles!shops_owner_id_fkey(email, full_name)')
    .order('created_at', { ascending: false })
    .limit(200);
  if (kyc && kyc !== 'all') query = query.eq('kyc_status', kyc);
  const { data, error } = await query;
  if (error) {
    console.error('Could not load shops for review:', error.code);
    return jsonError(503, 'db', 'Could not load shops. Please try again.');
  }

  let shops = (data ?? []) as Array<Record<string, unknown> & { id: string; name: string; city: string; phone: string; gstin: string | null; upi_id: string | null; address?: string }>;
  if (q) {
    shops = shops.filter((s) =>
      [s.name, s.city, s.phone, s.slug, s.short_code, s.gstin ?? '', s.upi_id ?? '', (s.owner as { email?: string } | null)?.email ?? '']
        .join(' ').toLowerCase().includes(q),
    );
  }

  // Enrich with onboarding details, enabled services and inventory counts.
  const ids = shops.map((s) => s.id);
  let onboardingByShop: Record<string, Record<string, unknown>> = {};
  let servicesByShop: Record<string, number> = {};
  let inventoryByShop: Record<string, number> = {};
  if (ids.length > 0) {
    const [obRes, svcRes, invRes] = await Promise.all([
      admin.from('shop_onboarding').select('*').in('shop_id', ids),
      admin.from('shop_services').select('shop_id, enabled').in('shop_id', ids),
      admin.from('inventory_items').select('shop_id').in('shop_id', ids),
    ]);
    for (const row of (obRes.data ?? []) as Array<Record<string, unknown> & { shop_id: string }>) {
      onboardingByShop[row.shop_id] = row;
    }
    for (const row of (svcRes.data ?? []) as Array<{ shop_id: string; enabled: boolean }>) {
      if (row.enabled) servicesByShop[row.shop_id] = (servicesByShop[row.shop_id] ?? 0) + 1;
    }
    for (const row of (invRes.data ?? []) as Array<{ shop_id: string }>) {
      inventoryByShop[row.shop_id] = (inventoryByShop[row.shop_id] ?? 0) + 1;
    }
  }

  const enriched = shops.map((s) => {
    const onboarding = onboardingByShop[s.id] ?? null;
    const enabledServices = servicesByShop[s.id] ?? 0;
    const inventoryCount = inventoryByShop[s.id] ?? 0;
    return {
      ...s,
      onboarding,
      enabled_services: enabledServices,
      inventory_count: inventoryCount,
      completeness: onboardingCompleteness(s, onboarding, { inventoryCount, enabledServices }),
    };
  });

  // Counts across ALL shops (ignoring the current filter) for the header stats.
  const { data: allRows } = await admin.from('shops').select('kyc_status').limit(500);
  const counts: Record<string, number> = { all: 0, pending: 0, approved: 0, rejected: 0, changes_requested: 0 };
  for (const r of (allRows ?? []) as Array<{ kyc_status: string }>) {
    counts.all += 1;
    counts[r.kyc_status] = (counts[r.kyc_status] ?? 0) + 1;
  }

  return jsonOk({ shops: enriched, counts });
}
