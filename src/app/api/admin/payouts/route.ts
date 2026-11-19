import { z } from 'zod';
import { getSessionProfile, jsonOk, jsonError } from '@/lib/api';
import { createAdminSupabase } from '@/lib/supabase';

export async function GET() {
  const session = await getSessionProfile();
  if (!session || session.profile?.role !== 'admin') return jsonError(403, 'forbidden', 'Admin only');
  const admin = createAdminSupabase();
  const { data, error } = await admin.from('payouts')
    .select('*, shops!inner(name, slug)')
    .order('created_at', { ascending: false })
    .limit(100);
  if (error) return jsonError(500, 'db', error.message);
  return jsonOk({ payouts: data ?? [] });
}

const generateInput = z.object({ period_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), period_end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) });

export async function POST(req: Request) {
  const session = await getSessionProfile();
  if (!session || session.profile?.role !== 'admin') return jsonError(403, 'forbidden', 'Admin only');
  const parsed = generateInput.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return jsonError(422, 'validation', 'period_start/period_end (YYYY-MM-DD) required');
  const { period_start, period_end } = parsed.data;

  const admin = createAdminSupabase();
  const endExclusive = new Date(`${period_end}T00:00:00Z`);
  endExclusive.setUTCDate(endExclusive.getUTCDate() + 1);

  const { data: shops } = await admin.from('shops').select('id, commission_bps').neq('status', 'suspended');
  const created: string[] = [];
  for (const shop of shops ?? []) {
    const { data: existing } = await admin.from('payouts').select('id').eq('shop_id', shop.id).eq('period_start', period_start).eq('period_end', period_end).limit(1);
    if (existing && existing.length > 0) continue;

    const { data: orders } = await admin.from('orders')
      .select('total_paise, commission_paise, payment_status')
      .eq('shop_id', shop.id)
      .in('payment_status', ['confirmed', 'cod_collected'])
      .gte('created_at', `${period_start}T00:00:00Z`)
      .lt('created_at', endExclusive.toISOString());
    const gross = (orders ?? []).reduce((a, o) => a + (o.total_paise ?? 0), 0);
    if (gross === 0) continue;
    const commission = (orders ?? []).reduce((a, o) => a + (o.commission_paise ?? 0), 0);
    const { data: payout, error } = await admin.from('payouts').insert({
      shop_id: shop.id, period_start, period_end,
      gross_paise: gross, commission_paise: commission, net_paise: gross - commission, status: 'pending',
    }).select('id').single();
    if (!error && payout) created.push(payout.id);
  }
  return jsonOk({ ok: true, created: created.length });
}
