'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Landmark, CheckCircle2, XCircle, LoaderCircle, Plus } from 'lucide-react';
import { formatPaiseExact } from '@/lib/format';
import { cn } from '@/lib/utils';

interface Payout {
  id: string; shop_id: string; period_start: string; period_end: string;
  gross_paise: number; commission_paise: number; net_paise: number; status: string; utr: string | null; paid_at: string | null;
  shops: { name: string; slug: string };
}

const today = () => new Date().toISOString().slice(0, 10);
const daysAgo = (n: number) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);

export default function AdminPayoutsPage() {
  const [payouts, setPayouts] = useState<Payout[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [periodStart, setPeriodStart] = useState(daysAgo(7));
  const [periodEnd, setPeriodEnd] = useState(daysAgo(1));
  const [utrEdit, setUtrEdit] = useState<Record<string, string>>({});
  const [banner, setBanner] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch('/api/admin/payouts', { cache: 'no-store' });
    if (res.ok) setPayouts((await res.json()).payouts);
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const generate = async () => {
    setGenerating(true); setBanner(null);
    try {
      const res = await fetch('/api/admin/payouts', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ period_start: periodStart, period_end: periodEnd }),
      });
      const d = await res.json().catch(() => ({}));
      setBanner(res.ok ? `${d.created ?? 0} payout settlement(s) generated.` : d?.error?.message ?? 'Failed');
      await load();
    } finally { setGenerating(false); }
  };

  const mark = async (id: string, action: 'paid' | 'failed' | 'processing') => {
    const res = await fetch(`/api/admin/payouts/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, utr: utrEdit[id]?.trim() || undefined }),
    });
    if (!res.ok) alert('Update failed');
    await load();
  };

  const totalPending = payouts.filter((p) => p.status === 'pending' || p.status === 'processing').reduce((a, p) => a + p.net_paise, 0);

  return (
    <div className="pb-10">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h1 className="text-2xl font-extrabold tracking-tight flex items-center gap-2"><Landmark size={22} />Payouts & settlements</h1>
        <div className="text-xs text-neutral-500">Pending net: <b className="text-neutral-900">{formatPaiseExact(totalPending)}</b></div>
      </div>
      <p className="text-xs text-neutral-500 mt-1">UPI payments land directly in each shop’s account — these are bookkeeping records of the 8% platform fee to be collected (bank transfer outside the app for MVP).</p>

      <div className="card mt-4 p-4 flex flex-wrap items-end gap-3">
        <div><label className="label">Period start</label><input type="date" className="input h-10" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} /></div>
        <div><label className="label">Period end</label><input type="date" className="input h-10" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} /></div>
        <button onClick={generate} disabled={generating || periodStart > periodEnd} className="btn btn-primary h-10 px-4 text-sm">{generating ? <Loader2 size={15} className="animate-spin" /> : <><Plus size={15} />Generate settlements</>}</button>
        {banner && <span className="text-xs font-semibold text-green-800 bg-green-50 border border-green-200 rounded-lg px-3 py-2">{banner}</span>}
      </div>

      {loading ? <div className="grid place-items-center py-20"><Loader2 className="animate-spin text-indigo-600" size={30} /></div> : (
        <div className="card mt-4 overflow-x-auto">
          <table className="w-full text-sm min-w-[720px]">
            <thead className="text-left text-[11px] uppercase tracking-wider text-neutral-400 bg-neutral-50">
              <tr><th className="px-4 py-2.5">Shop</th><th className="px-2 py-2.5">Period</th><th className="px-2 py-2.5 text-right">Gross</th><th className="px-2 py-2.5 text-right">Fee</th><th className="px-2 py-2.5 text-right">Net</th><th className="px-2 py-2.5">Status</th><th className="px-4 py-2.5">Action</th></tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {payouts.map((p) => (
                <tr key={p.id}>
                  <td className="px-4 py-2.5 font-semibold">{p.shops?.name}</td>
                  <td className="px-2 py-2.5 text-xs text-neutral-600">{p.period_start} → {p.period_end}</td>
                  <td className="px-2 py-2.5 text-right tabular-nums">{formatPaiseExact(p.gross_paise)}</td>
                  <td className="px-2 py-2.5 text-right tabular-nums text-neutral-500">−{formatPaiseExact(p.commission_paise)}</td>
                  <td className="px-2 py-2.5 text-right tabular-nums font-bold">{formatPaiseExact(p.net_paise)}</td>
                  <td className="px-2 py-2.5"><span className={cn('chip capitalize', p.status === 'paid' ? 'bg-green-100 text-green-800' : p.status === 'failed' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-800')}>{p.status}</span>{p.utr && <div className="text-[10px] font-mono text-neutral-400 mt-0.5">{p.utr}</div>}</td>
                  <td className="px-4 py-2.5">
                    {(p.status === 'pending' || p.status === 'processing') && (
                      <div className="flex items-center gap-1.5">
                        <input value={utrEdit[p.id] ?? ''} onChange={(e) => setUtrEdit((m) => ({ ...m, [p.id]: e.target.value }))} className="input h-8 w-24 text-[10px] font-mono" placeholder="UTR…" />
                        {p.status === 'pending' && <button onClick={() => mark(p.id, 'processing')} className="w-8 h-8 rounded-lg bg-neutral-100 hover:bg-neutral-200 grid place-items-center" title="Mark processing"><LoaderCircle size={14} /></button>}
                        <button onClick={() => mark(p.id, 'paid')} className="w-8 h-8 rounded-lg bg-green-100 text-green-700 hover:bg-green-200 grid place-items-center" title="Mark paid"><CheckCircle2 size={15} /></button>
                        <button onClick={() => mark(p.id, 'failed')} className="w-8 h-8 rounded-lg bg-red-50 text-red-600 hover:bg-red-100 grid place-items-center" title="Mark failed"><XCircle size={15} /></button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
              {payouts.length === 0 && <tr><td colSpan={7} className="px-4 py-8 text-center text-sm text-neutral-400">No settlements generated yet — pick a period above.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
