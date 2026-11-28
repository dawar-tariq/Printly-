'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Loader2, ShieldAlert, SearchCheck, Ban, BadgeIndianRupee } from 'lucide-react';
import { formatPaiseExact, timeAgo } from '@/lib/format';
import { cn } from '@/lib/utils';
import { Suspense } from 'react';

interface Dispute {
  id: string; type: string; description: string; status: string; resolution_note: string | null; created_at: string; resolved_at: string | null;
  orders: { id: string; token: string | null; total_paise: number; shop_id: string; shops: { name: string; slug: string } };
}

const STATUS_FILTERS = ['open', 'investigating', 'resolved_reject', 'resolved_refund', 'all'] as const;

function DisputesInner() {
  const router = useRouter();
  const params = useSearchParams();
  const filter = (params.get('status') ?? 'open') as (typeof STATUS_FILTERS)[number];
  const [disputes, setDisputes] = useState<Dispute[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/api/admin/disputes?status=${filter}`, { cache: 'no-store' });
    if (res.ok) setDisputes((await res.json()).disputes);
    setLoading(false);
  }, [filter]);
  useEffect(() => { load(); }, [load]);

  const act = async (id: string, action: 'investigating' | 'resolve_reject' | 'resolve_refund') => {
    setBusyId(id);
    try {
      const res = await fetch(`/api/admin/disputes?id=${id}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, note: (notes[id] ?? '').trim() || undefined }),
      });
      if (!res.ok) alert('Action failed');
      await load();
    } finally { setBusyId(null); }
  };

  return (
    <div>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h1 className="text-2xl font-extrabold tracking-tight flex items-center gap-2"><ShieldAlert size={22} />Disputes</h1>
        <div className="flex gap-1 bg-neutral-200 rounded-xl p-1 overflow-x-auto">
          {STATUS_FILTERS.map((s) => (
            <button key={s} onClick={() => router.push(`/admin/disputes?status=${s}`)} className={cn('px-3 h-8 rounded-lg text-xs font-bold capitalize whitespace-nowrap', filter === s ? 'bg-white shadow text-neutral-900' : 'text-neutral-600')}>{s.replace(/_/g, ' ')}</button>
          ))}
        </div>
      </div>

      {loading ? <div className="grid place-items-center py-20"><Loader2 className="animate-spin text-indigo-600" size={30} /></div> : (
        <div className="grid gap-3 mt-4">
          {disputes.map((d) => (
            <div key={d.id} className="card p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-extrabold">Order {d.orders?.token ? `#${d.orders.token}` : `#${d.orders?.id?.slice(0, 8)}`} · {d.orders?.shops?.name}</span>
                    <span className={cn('chip capitalize', d.status === 'open' ? 'bg-red-100 text-red-700' : d.status === 'investigating' ? 'bg-amber-100 text-amber-800' : 'bg-neutral-200 text-neutral-600')}>{d.status.replace('_', ' ')}</span>
                    <span className="chip bg-neutral-100 text-neutral-600 capitalize">{d.type.replace('_', ' ')}</span>
                  </div>
                  <p className="text-sm text-neutral-700 mt-1.5 max-w-2xl">{d.description}</p>
                  <div className="text-[10px] text-neutral-400 mt-1.5">{timeAgo(d.created_at)} · order value {formatPaiseExact(d.orders?.total_paise ?? 0)}{d.resolved_at ? ` · resolved ${timeAgo(d.resolved_at)}` : ''}</div>
                </div>
                {d.status !== 'resolved_reject' && d.status !== 'resolved_refund' && (
                  <div className="w-full sm:w-72 shrink-0">
                    <input value={notes[d.id] ?? ''} onChange={(e) => setNotes((m) => ({ ...m, [d.id]: e.target.value }))} className="input h-9 text-xs" placeholder="Resolution note…" />
                    <div className="flex gap-1.5 mt-1.5">
                      {d.status === 'open' && (
                        <button disabled={busyId === d.id} onClick={() => act(d.id, 'investigating')} className="btn btn-ghost h-8 px-2.5 text-[11px] flex-1"><SearchCheck size={12} />Investigating</button>
                      )}
                      <button disabled={busyId === d.id} onClick={() => act(d.id, 'resolve_reject')} className="btn btn-ghost h-8 px-2.5 text-[11px] flex-1"><Ban size={12} />Reject claim</button>
                      <button disabled={busyId === d.id} onClick={() => act(d.id, 'resolve_refund')} className="btn btn-dark h-8 px-2.5 text-[11px] flex-1"><BadgeIndianRupee size={12} />Refund</button>
                    </div>
                  </div>
                )}
              </div>
              {d.resolution_note && <p className="mt-2 text-xs text-neutral-500 border-t border-neutral-100 pt-2">Resolution: {d.resolution_note}</p>}
            </div>
          ))}
          {disputes.length === 0 && <div className="card p-10 text-center text-sm text-neutral-400">No “{filter.replace('_', ' ')}” disputes. 🎉</div>}
        </div>
      )}
    </div>
  );
}

export default function AdminDisputesPage() {
  return <Suspense fallback={<div className="grid place-items-center py-20"><Loader2 className="animate-spin" /></div>}><DisputesInner /></Suspense>;
}
