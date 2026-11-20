'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AlertTriangle, ChevronRight, Loader2, RefreshCw } from 'lucide-react';
import { formatPaiseExact, timeAgo } from '@/lib/format';

type Order = { id: string; token: string | null; status: string; payment_status: string; payment_method: string | null; customer_name: string; customer_phone: string; total_paise: number; utr: string | null; created_at: string };
type Result = { orders: Order[]; pagination: { page: number; pages: number; count: number } };

export default function RecoveryPage() {
  const router = useRouter();
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Result | null>(null);
  const [error, setError] = useState('');
  const [lookup, setLookup] = useState('');
  const [lookupError, setLookupError] = useState('');
  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/shop/recovery?page=${page}`, { cache: 'no-store' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error?.message ?? 'Could not load open orders.');
      setData(body); setError('');
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not load open orders.'); }
  }, [page]);
  useEffect(() => { void load(); }, [load]);

  return <div className="space-y-4 pb-10">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h1 className="text-2xl font-extrabold">Open orders &amp; payment issues</h1><p className="mt-1 text-sm text-neutral-600">A limited workspace for orders already in progress.</p></div><button onClick={() => void load()} className="btn btn-ghost min-h-10 px-3 text-xs"><RefreshCw size={14} />Refresh</button></div>
    <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950"><AlertTriangle size={18} className="mt-0.5 shrink-0" /><p>New orders and normal management require an active subscription. You can finish existing jobs and handle UPI reports here. <Link href="/shop/subscription" className="font-bold underline">Review subscription</Link></p></div>
    <section className="card p-4"><h2 className="font-extrabold">Find a specific existing order</h2><p className="mt-1 text-xs text-neutral-500">For a completed or cancelled order with a payment issue, paste the customer’s tracking link or order ID. Only orders belonging to your shop can be opened.</p><form className="mt-3 flex flex-wrap gap-2" onSubmit={(event) => {
      event.preventDefault();
      const match = lookup.trim().match(/(?:^|\/track\/)([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})(?=\/?(?:$|[?#]))/i);
      if (!match) { setLookupError('Enter the full tracking link or order ID.'); return; }
      setLookupError(''); router.push(`/shop/recovery/${match[1]}`);
    }}><label className="min-w-0 flex-1 basis-48 text-xs font-semibold text-neutral-600">Tracking link or order ID<input value={lookup} onChange={(event) => setLookup(event.target.value)} maxLength={2048} className="input mt-1 w-full text-sm" placeholder="Paste tracking link" /></label><button className="btn btn-ghost min-h-10 self-end px-4 text-xs">Find order</button></form>{lookupError && <p role="alert" className="mt-2 text-xs text-red-700">{lookupError}</p>}</section>
    {error && <div role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-800">{error} <button onClick={() => void load()} className="font-bold underline">Retry</button></div>}
    {!data && !error ? <div className="grid place-items-center py-16"><Loader2 className="animate-spin text-orange-600" /></div> : data && <section className="card p-4"><h2 className="font-extrabold">In progress ({data.pagination.count})</h2><p className="mt-1 text-xs text-neutral-500">Orders in the queue and UPI checkouts already started before access expired.</p><div className="mt-3 divide-y divide-neutral-100">{data.orders.map((order) => <Link key={order.id} href={`/shop/recovery/${order.id}`} className="flex items-center gap-3 py-4 hover:bg-neutral-50"><div className="min-w-0 flex-1"><p className="break-words text-sm font-bold">{order.token ?? `Order #${order.id.slice(0, 8).toUpperCase()}`} · {order.customer_name || 'Walk-in'}</p><p className="mt-1 text-xs text-neutral-500">{order.status === 'draft' ? 'UPI payment' : order.status.replace('_', ' ')} · {order.payment_status.replace('_', ' ')} · {timeAgo(order.created_at)}</p>{order.utr && <p className="mt-1 break-all text-xs text-neutral-500">Reference: {order.utr}</p>}</div><span className="shrink-0 text-sm font-bold">{formatPaiseExact(order.total_paise)}</span><ChevronRight size={16} className="shrink-0 text-neutral-400" /></Link>)}{!data.orders.length && <p className="py-5 text-sm text-neutral-500">No open orders on this page.</p>}</div>{(data.pagination.pages > 1 || page > 1) && <div className="mt-3 flex items-center justify-end gap-2 text-xs"><button disabled={page <= 1} onClick={() => setPage(page - 1)} className="btn btn-ghost min-h-9 px-3 disabled:opacity-40">Previous</button><span>Page {data.pagination.page} of {data.pagination.pages}</span><button disabled={page >= data.pagination.pages} onClick={() => setPage(page + 1)} className="btn btn-ghost min-h-9 px-3 disabled:opacity-40">Next</button></div>}</section>}
  </div>;
}
