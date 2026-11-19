'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2, CheckCircle2, XCircle, PenLine, Store, ExternalLink, Phone } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ShopRow {
  id: string; name: string; slug: string; city: string; phone: string; gstin: string | null; upi_id: string | null;
  kyc_status: string; status: string; commission_bps: number; created_at: string;
  owner?: { email: string; full_name: string | null } | null;
}

const FILTERS = ['pending', 'changes_requested', 'approved', 'rejected', 'all'] as const;

export default function AdminShopsPage() {
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>('pending');
  const [shops, setShops] = useState<ShopRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/api/admin/shops?kyc=${filter}`, { cache: 'no-store' });
    if (res.ok) setShops((await res.json()).shops);
    setLoading(false);
  }, [filter]);
  useEffect(() => { load(); }, [load]);

  const act = async (id: string, action: 'approve' | 'reject' | 'request_changes') => {
    setBusyId(id);
    try {
      const res = await fetch(`/api/admin/shops/${id}/kyc`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action }),
      });
      if (!res.ok) alert('Action failed');
      await load();
    } finally { setBusyId(null); }
  };

  return (
    <div>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h1 className="text-2xl font-extrabold tracking-tight flex items-center gap-2"><Store size={22} />Shops & KYC</h1>
        <div className="flex gap-1 bg-neutral-200 rounded-xl p-1 flex-wrap">
          {FILTERS.map((f) => (
            <button key={f} onClick={() => setFilter(f)} className={cn('px-3 h-8 rounded-lg text-xs font-bold capitalize', filter === f ? 'bg-white shadow text-neutral-900' : 'text-neutral-600')}>{f.replace('_', ' ')}</button>
          ))}
        </div>
      </div>

      {loading ? <div className="grid place-items-center py-20"><Loader2 className="animate-spin text-indigo-600" size={30} /></div> : (
        <div className="grid gap-3 mt-4">
          {shops.map((s) => (
            <div key={s.id} className="card p-4 flex flex-col sm:flex-row sm:items-center gap-4">
              <div className="w-12 h-12 rounded-2xl bg-orange-100 text-orange-700 grid place-items-center font-extrabold text-lg shrink-0">{s.name.charAt(0)}</div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-extrabold">{s.name}</span>
                  <span className={cn('chip capitalize', s.kyc_status === 'approved' ? 'bg-green-100 text-green-800' : s.kyc_status === 'pending' ? 'bg-amber-100 text-amber-800' : s.kyc_status === 'rejected' ? 'bg-red-100 text-red-700' : 'bg-neutral-200 text-neutral-600')}>{s.kyc_status.replace('_', ' ')}</span>
                  <a className="text-[10px] text-indigo-700 hover:underline inline-flex items-center gap-0.5" href={`/s/${s.slug}`} target="_blank" rel="noreferrer">customer page <ExternalLink size={9} /></a>
                </div>
                <div className="text-xs text-neutral-500 mt-0.5">{s.city} · joined {new Date(s.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</div>
                <div className="text-[11px] text-neutral-500 mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
                  <span>Owner: {s.owner?.full_name ?? '—'} · {s.owner?.email ?? 'no email'}</span>
                  <a href={`tel:${s.phone}`} className="inline-flex items-center gap-1 text-indigo-800 font-semibold"><Phone size={10} />{s.phone}</a>
                  {s.upi_id && <span className="font-mono">UPI: {s.upi_id}</span>}
                  {s.gstin && <span className="font-mono">GST: {s.gstin}</span>}
                </div>
              </div>
              {s.kyc_status !== 'approved' && (
                <div className="flex sm:flex-col items-center gap-1.5 shrink-0">
                  <button disabled={busyId === s.id} onClick={() => act(s.id, 'approve')} className="btn btn-primary h-9 px-3 text-xs">{busyId === s.id ? <Loader2 size={13} className="animate-spin" /> : <><CheckCircle2 size={13} />Approve</>}</button>
                  <button disabled={busyId === s.id} onClick={() => act(s.id, 'request_changes')} className="btn btn-ghost h-9 px-3 text-xs"><PenLine size={13} />Changes</button>
                  <button disabled={busyId === s.id} onClick={() => act(s.id, 'reject')} className="btn btn-ghost h-9 px-3 text-xs text-red-700"><XCircle size={13} />Reject</button>
                </div>
              )}
            </div>
          ))}
          {shops.length === 0 && <div className="card p-10 text-center text-sm text-neutral-400">No shops in “{filter.replace('_', ' ')}”.</div>}
        </div>
      )}
    </div>
  );
}
