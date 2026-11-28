'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Loader2, IndianRupee, ShoppingBag, Store, ShieldAlert, CreditCard, Hourglass } from 'lucide-react';
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { formatPaise, formatPaiseExact } from '@/lib/format';

interface Analytics {
  gmv_paise: number; pending_subscriptions: number; orders_count: number; paid_orders_count: number;
  aov_paise: number; active_shops: number; pending_kyc: number; open_disputes: number;
  series: { day: string; gmv_paise: number; orders: number }[];
}

export default function AdminAnalyticsPage() {
  const [data, setData] = useState<Analytics | null>(null);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    setError(false);
    fetch('/api/admin/analytics', { cache: 'no-store' }).then((r) => { if (!r.ok) throw new Error('unavailable'); return r.json(); }).then(setData).catch(() => setError(true));
  }, [retry]);

  if (error) return <div role="alert" className="card p-8 text-center text-sm text-red-700">Could not load analytics. <button onClick={() => setRetry((n) => n + 1)} className="font-bold underline">Try again</button></div>;
  if (!data) return <div className="grid place-items-center py-24"><Loader2 className="animate-spin text-indigo-600" size={30} /></div>;

  const stats = [
    { label: 'GMV (paid)', value: formatPaise(data.gmv_paise), icon: IndianRupee, sub: 'up to 10,000 recent orders' },
    { label: 'Subscription requests', value: String(data.pending_subscriptions), icon: CreditCard, sub: 'awaiting payment verification' },
    { label: 'Orders', value: String(data.orders_count), icon: ShoppingBag, sub: `${data.paid_orders_count} paid · AOV ${formatPaise(data.aov_paise)}` },
    { label: 'Enabled shops', value: String(data.active_shops), icon: Store, sub: 'shop status, before subscription check' },
  ];

  return (
    <div className="pb-10">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-extrabold tracking-tight">Platform overview</h1>
        <div className="flex gap-2">
          {data.pending_kyc > 0 && <Link href="/admin/shops" className="chip bg-amber-100 text-amber-900 h-8 px-3"><Hourglass size={12} />{data.pending_kyc} pending KYC</Link>}
          {data.open_disputes > 0 && <Link href="/admin/disputes" className="chip bg-red-100 text-red-800 h-8 px-3"><ShieldAlert size={12} />{data.open_disputes} open disputes</Link>}
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mt-4">
        {stats.map(({ label, value, icon: Icon, sub }) => (
          <div key={label} className="card p-4">
            <div className="flex items-center gap-1.5 text-[11px] font-semibold text-neutral-500"><Icon size={12} />{label}</div>
            <div className="mt-1.5 text-2xl font-extrabold tabular-nums tracking-tight">{value}</div>
            {sub && <div className="text-[10px] text-neutral-400 mt-0.5">{sub}</div>}
          </div>
        ))}
      </div>

      <div className="card mt-4 p-4">
        <h2 className="text-xs font-extrabold uppercase tracking-widest text-neutral-500">GMV — last 14 days</h2>
        <div className="h-56 mt-2">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data.series} margin={{ left: -8, right: 4 }}>
              <XAxis dataKey="day" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={(v) => `₹${Math.round(Number(v) / 100)}`} />
              <Tooltip cursor={{ fill: 'rgba(0,0,0,0.05)' }} formatter={(v) => [formatPaiseExact(Number(v)), 'GMV']} />
              <Bar dataKey="gmv_paise" fill="#4f46e5" radius={[6, 6, 0, 0]} maxBarSize={40} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4 text-center">
        {[['Plan', 'One plan · all features'], ['Terms', 'Monthly · 6 months · yearly'], ['Shop payments', 'UPI direct'], ['Renewal', 'Manual · admin verified']].map(([k, v]) => (
          <div key={k} className="card p-4"><div className="text-[10px] uppercase tracking-widest text-neutral-400">{k}</div><div className="mt-1 font-extrabold">{v}</div></div>
        ))}
      </div>
    </div>
  );
}
