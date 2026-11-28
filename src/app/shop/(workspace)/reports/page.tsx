'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, BarChart3, IndianRupee, ShoppingBag, CheckCircle2 } from 'lucide-react';
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { formatPaiseExact } from '@/lib/format';
import { SERVICE_LABEL } from '@/lib/constants';
import { cn } from '@/lib/utils';
import styles from './reports.module.css';

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
  const [error, setError] = useState('');
  const sequence = useRef(0);

  const load = useCallback(async (r: Range) => {
    const current = ++sequence.current;
    setLoading(true); setError(''); setData(null);
    try {
      const res = await fetch(`/api/shop/reports?range=${r}`, { cache: 'no-store' });
      const result = await res.json();
      if (!res.ok) throw new Error(typeof result?.error?.message === 'string' ? result.error.message : 'Could not load this report.');
      if (!result || typeof result.orders_count !== 'number' || typeof result.paid_orders_count !== 'number'
          || typeof result.revenue_paise !== 'number' || typeof result.avg_order_paise !== 'number'
          || !result.service_counts || typeof result.service_counts !== 'object' || !Array.isArray(result.series)) throw new Error('Could not load this report.');
      if (current === sequence.current) setData(result as Report);
    } catch (failure) { if (current === sequence.current) setError(failure instanceof Error ? failure.message : 'Could not load this report.'); }
    finally { if (current === sequence.current) setLoading(false); }
  }, []);
  useEffect(() => { void load(range); return () => { sequence.current++; }; }, [range, load]);

  const stats = data ? [
    { label: 'Revenue (collected)', value: formatPaiseExact(data.revenue_paise), icon: IndianRupee, sub: `${data.orders_count} orders started` },
    { label: 'Paid orders', value: String(data.paid_orders_count), icon: CheckCircle2, sub: 'confirmed or collected' },
    { label: 'Avg. order value', value: formatPaiseExact(data.avg_order_paise), icon: ShoppingBag, sub: 'paid orders' },
  ] : [];

  const maxService = data ? Math.max(1, ...Object.values(data.service_counts)) : 1;

  return (
    <div className={styles.page}>
      <div className={styles.heading}>
        <div><p className={styles.eyebrow}>Your shop at a glance</p><h1 className={styles.title}><BarChart3 size={24} />Reports</h1><p className={styles.subtitle}>Understand your orders and collected revenue over time.</p></div>
        <div className={styles.ranges} role="group" aria-label="Report period">
          {([['day', 'Today'], ['week', '7 days'], ['month', '30 days']] as [Range, string][]).map(([r, label]) => (
            <button key={r} onClick={() => setRange(r)} aria-pressed={range === r} className={cn(styles.range, range === r && styles.rangeActive)}>{label}</button>
          ))}
        </div>
      </div>

      {loading ? (
        <div role="status" className="grid place-items-center py-20"><Loader2 className="animate-spin text-orange-600" size={30} /><span className="mt-2 text-xs text-neutral-500">Loading report…</span></div>
      ) : error || !data ? (
        <div role="alert" className="card mt-4 p-5 text-sm text-red-800">{error || 'Could not load this report.'} <button type="button" onClick={() => void load(range)} className="font-bold underline">Try again</button></div>
      ) : (
        <>
          <p className="mt-3 text-[11px] leading-5 text-neutral-500">India time. Revenue includes paid orders created in this period; it is not a bank balance.</p>
          <div className={styles.stats}>
            {stats.map(({ label, value, icon: Icon, sub }) => (
              <div key={label} className={`card ${styles.stat}`}>
                <div className={styles.statTop}><span className={styles.statLabel}>{label}</span><span className={styles.statIcon}><Icon size={17} /></span></div>
                <div className={styles.statValue}>{value}</div>
                <div className={styles.statSub}>{sub}</div>
              </div>
            ))}
          </div>

          {/* revenue chart */}
          <div className={`card ${styles.panel}`}>
            <h2 className={styles.panelTitle}>Daily revenue</h2>
            <p className={styles.panelSub}>Collected revenue for each day in the selected period.</p>
            <div className={styles.chart}>
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
            <div className={`card ${styles.panel}`}>
              <h2 className={styles.panelTitle}>Service mix</h2>
              <p className={styles.panelSub}>Items ordered by service in the selected period.</p>
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
