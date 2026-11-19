import { getSessionProfile, jsonOk, jsonError } from '@/lib/api';
import { createAdminSupabase } from '@/lib/supabase';

export async function GET() {
  const session = await getSessionProfile();
  if (!session || session.profile?.role !== 'admin') return jsonError(403, 'forbidden', 'Admin only');
  const admin = createAdminSupabase();

  const [{ data: orders }, { count: shopCount }, { count: pendingKyc }, { count: openDisputes }] = await Promise.all([
    admin.from('orders').select('total_paise, commission_paise, payment_status, created_at').limit(10000),
    admin.from('shops').select('id', { count: 'exact', head: true }).eq('status', 'active'),
    admin.from('shops').select('id', { count: 'exact', head: true }).eq('kyc_status', 'pending'),
    admin.from('disputes').select('id', { count: 'exact', head: true }).eq('status', 'open'),
  ]);

  const paid = (orders ?? []).filter((o) => o.payment_status === 'confirmed' || o.payment_status === 'cod_collected');
  const gmv = paid.reduce((a, o) => a + (o.total_paise ?? 0), 0);
  const commission = paid.reduce((a, o) => a + (o.commission_paise ?? 0), 0);

  const series: { day: string; gmv_paise: number; orders: number }[] = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i); d.setHours(0, 0, 0, 0);
    const key = d.toISOString().slice(0, 10);
    const dayOrders = (orders ?? []).filter((o) => o.created_at.slice(0, 10) === key);
    const dayPaid = dayOrders.filter((o) => o.payment_status === 'confirmed' || o.payment_status === 'cod_collected');
    series.push({
      day: d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }),
      gmv_paise: dayPaid.reduce((a, o) => a + (o.total_paise ?? 0), 0),
      orders: dayOrders.length,
    });
  }

  const totalOrders = orders?.length ?? 0;
  return jsonOk({
    gmv_paise: gmv,
    commission_paise: commission,
    orders_count: totalOrders,
    paid_orders_count: paid.length,
    aov_paise: paid.length ? Math.round(gmv / paid.length) : 0,
    active_shops: shopCount ?? 0,
    pending_kyc: pendingKyc ?? 0,
    open_disputes: openDisputes ?? 0,
    series,
  });
}
