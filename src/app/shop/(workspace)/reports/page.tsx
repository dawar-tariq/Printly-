'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2, BarChart3, IndianRupee, ShoppingBag, CheckCircle2 } from 'lucide-react';
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { formatPaise, formatPaiseExact } from '@/lib/format';
import { SERVICE_LABEL } from '@/lib/constants';
import { cn } from '@/lib/utils';

type Range = 'day' | 'week' | 'month';
interface Report {
  days: number; orders_count: number; paid_orders_count: number; revenue_paise: number; avg_order_paise: number;
  service_counts: Record<string, number>;
  series: { day: string; revenue_paise: number; orders: number }[];
}

export default function ReportsPage() {
  const [range, setRange] = useState<Range>('week');
  const [data, setData] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (r: Range) => {
    setLoading(true);
    const res = await fetch(`/api/shop/reports?range=${r}`, { cache: 'no-store' });
    if (res.ok) setData(await res.json());
    setLoading(false);
  }, []);
  useEffect(() => { load(range); }, [range, load]);

  const stats = data ? [
    { label: 'Revenue (collected)', value: formatPaise(data.revenue_paise), icon: IndianRupee, sub: `${data.orders_count} orders` },
    { label: 'Paid orders', value: String(data.paid_orders_count), icon: CheckCircle2, sub: 'confirmed or collected' },
    { label: 'Avg. order value', value: formatPaise(data.avg_order_paise), icon: ShoppingBag, sub: 'paid orders' },
  ] : [];

  const maxService = data ? Math.max(1, ...Object.values(data.service_counts)) : 1;

  return (
    <div className="max-w-4xl mx-auto pb-10">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h1 className="text-2xl font-extrabold tracking-tight flex items-center gap-2"><BarChart3 size={22} />Reports</h1>
        <div className="flex gap-1 bg-neutral-200 rounded-xl p-1">
          {([['day', 'Today'], ['week', '7 days'], ['month', '30 days']] as [Range, string][]).map(([r, label]) => (
            <button key={r} onClick={() => setRange(r)} className={cn('px-3.5 h-8 rounded-lg text-xs font-bold', range === r ? 'bg-white shadow text-neutral-900' : 'text-neutral-600')}>{label}</button>
          ))}
        </div>
      </div>

      {loading || !data ? (
        <div className="grid place-items-center py-20"><Loader2 className="animate-spin text-orange-600" size={30} /></div>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-4">
            {stats.map(({ label, value, icon: Icon, sub }) => (
              <div key={label} className="card p-4">
                <div className="flex items-center gap-1.5 text-[11px] font-semibold text-neutral-500"><Icon size={12} />{label}</div>
                <div className="mt-1.5 text-2xl font-extrabold tabular-nums tracking-tight">{value}</div>
                <div className="text-[10px] text-neutral-400 mt-0.5">{sub}</div>
              </div>
            ))}
          </div>

          {/* revenue chart */}
          <div className="card mt-4 p-4">
            <h2 className="text-xs font-extrabold uppercase tracking-widest text-neutral-500">Daily revenue</h2>
            <div className="h-48 mt-2">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.series} margin={{ left: -8, right: 4 }}>
                  <XAxis dataKey="day" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={(v) => `₹${Math.round(v / 100)}`} />
                  <Tooltip cursor={{ fill: 'rgba(0,0,0,0.05)' }} formatter={(v) => [formatPaiseExact(Number(v)), 'Revenue']} />
                  <Bar dataKey="revenue_paise" fill="#ea580c" radius={[6, 6, 0, 0]} maxBarSize={42} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="mt-4">
            {/* service mix */}
            <div className="card p-4">
              <h2 className="text-xs font-extrabold uppercase tracking-widest text-neutral-500">What sells</h2>
              <div className="mt-3 space-y-2.5">
                {Object.entries(data.service_counts).sort((a, b) => b[1] - a[1]).map(([service, count]) => (
                  <div key={service}>
                    <div className="flex justify-between text-xs font-semibold"><span>{SERVICE_LABEL[service] ?? service}</span><span className="tabular-nums text-neutral-500">{count}</span></div>
                    <div className="h-2 mt-1 rounded-full bg-neutral-100 overflow-hidden"><div className="h-full bg-orange-600 rounded-full" style={{ width: `${(count / maxService) * 100}%` }} /></div>
                  </div>
                ))}
                {Object.keys(data.service_counts).length === 0 && <p className="text-xs text-neutral-400">No items in this period yet.</p>}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
