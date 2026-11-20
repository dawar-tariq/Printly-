'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Loader2, CheckCircle2, XCircle, Printer, PackageCheck, Package, Banknote, Clock,
  AlertCircle, User, ChevronRight, Zap, IndianRupee, RefreshCw,
} from 'lucide-react';
import { formatPaise, timeAgo } from '@/lib/format';
import { cn } from '@/lib/utils';
import { createBrowserSupabase } from '@/lib/supabase-client';

interface OrderCard {
  id: string; token: string | null; status: string; payment_status: string; payment_method: string | null;
  customer_name: string; customer_phone: string; total_paise: number; rush: boolean; eta_minutes: number | null;
  utr: string | null; created_at: string; items: { count: number }[];
}

export default function ShopBoardPage() {
  const router = useRouter();
  const [lookup, setLookup] = useState('');
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [confirmQueue, setConfirmQueue] = useState<OrderCard[]>([]);
  const [lanes, setLanes] = useState<{ queued: OrderCard[]; printing: OrderCard[]; ready: OrderCard[] }>({ queued: [], printing: [], ready: [] });
  const [completedToday, setCompletedToday] = useState(0);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [utrEdit, setUtrEdit] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const [confirmRes, qRes, pRes, rRes, doneRes] = await Promise.all([
      fetch('/api/shop/orders?lane=confirm', { cache: 'no-store' }),
      fetch('/api/shop/orders?lane=queued', { cache: 'no-store' }),
      fetch('/api/shop/orders?lane=printing', { cache: 'no-store' }),
      fetch('/api/shop/orders?lane=ready', { cache: 'no-store' }),
      fetch('/api/shop/orders?lane=completed', { cache: 'no-store' }),
    ]);
    const j = (r: Response) => (r.ok ? r.json() : Promise.resolve({ orders: [] }));
    const [c, q, p, r, d] = await Promise.all([j(confirmRes), j(qRes), j(pRes), j(rRes), j(doneRes)]);
    setConfirmQueue(c.orders ?? []);
    setLanes({
      queued: (q.orders ?? []).slice().reverse(),
      printing: (p.orders ?? []).slice().reverse(),
      ready: (r.orders ?? []).slice().reverse(),
    });
    setCompletedToday((d.orders ?? []).length);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 8000);
    // realtime: refresh on any order change visible to this shop
    const supabase = createBrowserSupabase();
    const channel = supabase
      .channel('shop-orders')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, () => load())
      .subscribe();
    return () => { clearInterval(t); supabase.removeChannel(channel); };
  }, [load]);

  const transition = async (id: string, to: string) => {
    setBusyId(id);
    try {
      const res = await fetch(`/api/shop/orders/${id}/status`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ to }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(data?.error?.message ?? 'Could not update order');
      }
      await load();
    } finally { setBusyId(null); }
  };

  const confirmPayment = async (id: string, action: 'confirm' | 'reject') => {
    setBusyId(id);
    try {
      const res = await fetch(`/api/shop/orders/${id}/confirm-payment`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, utr: utrEdit[id]?.trim() || undefined }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(data?.error?.message ?? 'Could not update payment');
      }
      await load();
    } finally { setBusyId(null); }
  };

  const Lane = ({ title, icon: Icon, orders, action }: { title: string; icon: typeof Printer; orders: OrderCard[]; action: (o: OrderCard) => React.ReactNode }) => (
    <section className="rounded-2xl bg-neutral-200/60 border border-neutral-200 overflow-hidden flex flex-col min-h-72">
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-neutral-200">
        <h2 className="text-xs font-extrabold uppercase tracking-widest text-neutral-600 flex items-center gap-1.5"><Icon size={14} />{title}<span className="ml-1 bg-white rounded-full px-1.5 py-0.5 text-[10px] border border-neutral-200">{orders.length}</span></h2>
      </div>
      <div className="p-2 space-y-2 flex-1">
        {orders.map((o) => (
          <div key={o.id} className="bg-white rounded-xl border border-neutral-200 p-3 shadow-sm">
            <div className="flex items-start justify-between gap-2">
              <Link href={`/shop/orders/${o.id}`} className="group min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-2xl font-black tracking-tight text-neutral-900 group-hover:text-orange-700">{o.token ?? '—'}</span>
                  {o.rush && <span className="chip bg-red-100 text-red-700"><Zap size={10} />RUSH</span>}
                </div>
                <div className="mt-0.5 text-[11px] text-neutral-500 flex min-w-0 items-center gap-1"><User size={10} className="shrink-0" /><span className="min-w-0 truncate">{o.customer_name || 'Walk-in'} · {o.customer_phone}</span></div>
              </Link>
              <div className="text-right shrink-0">
                <div className="text-sm font-extrabold tabular-nums">{formatPaise(o.total_paise)}</div>
                <span className={cn('chip mt-0.5', o.payment_method === 'cod' ? 'bg-blue-100 text-blue-800' : 'bg-green-100 text-green-800')}>{o.payment_method === 'cod' ? 'COD' : 'UPI ✓'}</span>
              </div>
            </div>
            <div className="mt-2 flex items-center justify-between gap-2">
              <span className="text-[10px] text-neutral-400 flex items-center gap-1"><Clock size={10} />{timeAgo(o.created_at)} · {o.items?.[0]?.count ?? 0} item{(o.items?.[0]?.count ?? 0) !== 1 ? 's' : ''}</span>
              <div className="flex items-center gap-1.5">
                <Link href={`/shop/orders/${o.id}`} className="btn btn-ghost h-8 px-2.5 text-[11px]">Details</Link>
                {action(o)}
              </div>
            </div>
          </div>
        ))}
        {orders.length === 0 && <div className="text-center text-[11px] text-neutral-400 py-8">Nothing here</div>}
      </div>
    </section>
  );

  if (loading) return <div className="grid place-items-center py-20"><Loader2 className="animate-spin text-orange-600" size={30} /></div>;

  return (
    <div>
      <details className="card mb-4 p-3">
        <summary className="cursor-pointer text-sm font-bold text-neutral-700">Find an order with its tracking link</summary>
        <form className="mt-3 flex flex-wrap gap-2" onSubmit={(event) => {
          event.preventDefault();
          const match = lookup.trim().match(/(?:^|\/track\/)([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})(?=\/?(?:$|[?#]))/i);
          if (!match) { setLookupError('Enter the full tracking link or order ID.'); return; }
          setLookupError(null);
          router.push(`/shop/orders/${match[1]}`);
        }}>
          <label className="min-w-0 flex-1 basis-48 text-xs font-semibold text-neutral-600">Tracking link or order ID
            <input value={lookup} onChange={(event) => setLookup(event.target.value)} maxLength={2048} className="input mt-1 w-full text-sm" placeholder="Paste the customer’s tracking link" />
          </label>
          <button type="submit" className="btn btn-ghost min-h-10 self-end px-4 text-sm">Find order</button>
          {lookupError && <p role="alert" className="w-full text-xs text-red-700">{lookupError}</p>}
        </form>
        <p className="mt-2 text-xs text-neutral-500">Only orders for your shop can be opened.</p>
      </details>
      {/* Awaiting payment confirmation */}
      {confirmQueue.length > 0 && (
        <section className="rounded-2xl border-2 border-amber-400 bg-amber-50 overflow-hidden mb-4">
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-amber-200">
            <h2 className="text-xs font-extrabold uppercase tracking-widest text-amber-900 flex items-center gap-2"><AlertCircle size={14} />Payment confirmation ({confirmQueue.length})</h2>
            <button onClick={load} className="p-1.5 text-amber-800 hover:bg-amber-100 rounded-lg"><RefreshCw size={15} /></button>
          </div>
          <div className="p-2 grid min-w-0 grid-cols-1 gap-2 md:grid-cols-2">
            {confirmQueue.map((o) => (
              <div key={o.id} className="min-w-0 bg-white rounded-xl border border-amber-200 p-3">
                <div className="flex items-start justify-between gap-2">
                  <Link href={`/shop/orders/${o.id}`} className="min-w-0">
                    <div className="text-[11px] font-bold text-neutral-500">ORDER #{o.id.slice(0, 8).toUpperCase()}</div>
                    <div className="text-sm font-bold truncate">{o.customer_name || 'Walk-in'} · {o.customer_phone}</div>
                    <div className="text-[11px] text-neutral-500 mt-0.5">{o.items?.[0]?.count ?? 0} item(s) · {timeAgo(o.created_at)}</div>
                  </Link>
                  <div className="text-right shrink-0">
                    <div className="text-base font-extrabold tabular-nums flex items-center gap-0.5"><IndianRupee size={14} />{(o.total_paise / 100).toFixed(2)}</div>
                    <span className="chip bg-amber-100 text-amber-800 mt-0.5">UPI · unverified</span>
                  </div>
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <input
                    value={utrEdit[o.id] ?? o.utr ?? ''}
                    onChange={(e) => setUtrEdit((m) => ({ ...m, [o.id]: e.target.value }))}
                    placeholder="UTR / ref no. (optional)"
                    className="input h-9 min-w-0 text-xs font-mono flex-1"
                  />
                </div>
                {o.payment_status === 'pending' && <p className="mt-2 text-xs text-amber-900">Waiting for the customer to mark the payment as sent. If they contacted you, open the order to record their report.</p>}
                <div className="mt-2 flex items-center gap-2">
                  <button disabled={busyId === o.id || o.payment_status !== 'submitted'} onClick={() => confirmPayment(o.id, 'confirm')} className="btn btn-primary h-9 px-4 text-xs flex-1">
                    {busyId === o.id ? <Loader2 size={14} className="animate-spin" /> : <><CheckCircle2 size={14} /> Payment received</>}
                  </button>
                  <button disabled={busyId === o.id} onClick={() => confirmPayment(o.id, 'reject')} className="btn btn-ghost h-9 px-3 text-xs text-red-700"><XCircle size={14} />Not received</button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Board lanes */}
      <div className="grid gap-3 lg:grid-cols-3">
        <Lane title="New orders" icon={Package} orders={lanes.queued} action={(o) => (
          <button disabled={busyId === o.id} onClick={() => transition(o.id, 'printing')} className="btn btn-dark h-8 px-3 text-[11px]">{busyId === o.id ? <Loader2 size={13} className="animate-spin" /> : 'Start printing'}</button>
        )} />
        <Lane title="Printing" icon={Printer} orders={lanes.printing} action={(o) => (
          <button disabled={busyId === o.id} onClick={() => transition(o.id, 'ready')} className="btn btn-dark h-8 px-3 text-[11px]">{busyId === o.id ? <Loader2 size={13} className="animate-spin" /> : 'Mark ready'}</button>
        )} />
        <Lane title="Ready for pickup" icon={PackageCheck} orders={lanes.ready} action={(o) => (
          <button disabled={busyId === o.id} onClick={() => transition(o.id, 'collected')} className="btn btn-primary h-8 px-3 text-[11px]">{busyId === o.id ? <Loader2 size={13} className="animate-spin" /> : o.payment_method === 'cod' ? 'Cash received ✓' : 'Mark collected'}</button>
        )} />
      </div>

      <div className="mt-3 flex items-center justify-between px-1 text-[11px] text-neutral-500">
        <span className="flex items-center gap-2"><Banknote size={12} />Completed today: <b className="text-neutral-800">{completedToday}</b></span>
        <Link href="/shop/reports" className="flex items-center gap-1 font-bold text-orange-800 hover:underline">View reports <ChevronRight size={12} /></Link>
      </div>
    </div>
  );
}
