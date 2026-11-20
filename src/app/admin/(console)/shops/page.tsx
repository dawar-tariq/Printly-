'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Loader2, CheckCircle2, XCircle, PenLine, Store, ExternalLink, Phone, Search, Boxes, Printer, Clock, ChevronRight, Hourglass, BadgeCheck, Ban, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { BUSINESS_TYPE_LABELS, SERVICE_LABELS } from '@/lib/onboarding';
import { publicShopPath } from '@/lib/shop-identity';

interface Onboarding {
  business_type?: string | null;
  printer_count?: number | null;
  staff_count?: number | null;
  pincode?: string | null;
  submitted_at?: string | null;
  duplicate_name?: boolean;
}
interface ShopRow {
  id: string; name: string; slug: string; short_code: string; city: string; phone: string; gstin: string | null; upi_id: string | null;
  kyc_status: string; status: string; commission_bps: number; created_at: string;
  owner?: { email: string; full_name: string | null } | null;
  onboarding?: Onboarding | null;
  enabled_services?: number;
  inventory_count?: number;
  completeness?: number;
}

const FILTERS = [
  { key: 'pending', label: 'Pending review' },
  { key: 'changes_requested', label: 'Changes requested' },
  { key: 'approved', label: 'Approved' },
  { key: 'rejected', label: 'Rejected' },
  { key: 'all', label: 'All shops' },
] as const;

function kycChip(status: string) {
  return cn('chip capitalize',
    status === 'approved' ? 'bg-green-100 text-green-800' :
    status === 'pending' ? 'bg-amber-100 text-amber-800' :
    status === 'rejected' ? 'bg-red-100 text-red-700' :
    'bg-sky-100 text-sky-800');
}

export default function AdminShopsPage() {
  const [filter, setFilter] = useState<string>('pending');
  const [q, setQ] = useState('');
  const [shops, setShops] = useState<ShopRow[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({ all: 0, pending: 0, approved: 0, rejected: 0, changes_requested: 0 });
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async (search: string) => {
    setLoading(true);
    const params = new URLSearchParams({ kyc: filter });
    if (search.trim()) params.set('q', search.trim());
    const res = await fetch(`/api/admin/shops?${params}`, { cache: 'no-store' });
    if (res.ok) {
      const data = await res.json();
      setShops(data.shops ?? []);
      if (data.counts) setCounts(data.counts);
    }
    setLoading(false);
  }, [filter]);

  useEffect(() => { load(q); }, [load]); // eslint-disable-line react-hooks/exhaustive-deps

  const act = async (id: string, action: 'approve' | 'reject' | 'request_changes') => {
    setBusyId(id);
    try {
      const res = await fetch(`/api/admin/shops/${id}/kyc`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action }),
      });
      if (!res.ok) alert('Action failed');
      await load(q);
    } finally { setBusyId(null); }
  };

  const stats = useMemo(() => [
    { label: 'Total shops', value: counts.all ?? 0, icon: Store },
    { label: 'Pending review', value: counts.pending ?? 0, icon: Hourglass },
    { label: 'Approved', value: counts.approved ?? 0, icon: BadgeCheck },
    { label: 'Changes requested', value: counts.changes_requested ?? 0, icon: PenLine },
    { label: 'Rejected', value: counts.rejected ?? 0, icon: Ban },
  ], [counts]);

  return (
    <div className="pb-10">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight flex items-center gap-2"><Store size={22} />Shops &amp; KYC</h1>
          <p className="text-xs text-neutral-500 mt-0.5">Review new shop applications, see full onboarding details and approve shops.</p>
        </div>
        <button onClick={() => load(q)} className="btn btn-ghost h-9 px-3 text-xs"><RefreshCw size={13} />Refresh</button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mt-4">
        {stats.map(({ label, value, icon: Icon }) => (
          <div key={label} className="card p-4">
            <div className="flex items-center gap-1.5 text-[11px] font-semibold text-neutral-500"><Icon size={12} />{label}</div>
            <div className="mt-1.5 text-2xl font-extrabold tabular-nums tracking-tight">{value}</div>
          </div>
        ))}
      </div>

      <div className="flex flex-col md:flex-row md:items-center gap-3 mt-4">
        <div className="relative flex-1 max-w-md">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') load(q); }}
            placeholder="Search by shop, city, phone, email, GSTIN…"
            className="input pl-9 h-10 text-sm"
          />
        </div>
        <div className="flex gap-1 bg-neutral-200 rounded-xl p-1 flex-wrap">
          {FILTERS.map((f) => (
            <button key={f.key} onClick={() => setFilter(f.key)} className={cn('px-3 h-8 rounded-lg text-xs font-bold', filter === f.key ? 'bg-white shadow text-neutral-900' : 'text-neutral-600')}>
              {f.label}{counts[f.key] != null && <span className="ml-1 text-[10px] opacity-70">({counts[f.key]})</span>}
            </button>
          ))}
        </div>
      </div>

      {loading ? <div className="grid place-items-center py-20"><Loader2 className="animate-spin text-indigo-600" size={30} /></div> : (
        <div className="grid gap-3 mt-4">
          {shops.map((s) => {
            const ob = s.onboarding;
            const completeness = s.completeness ?? 0;
            return (
              <div key={s.id} className="card p-4">
                <div className="flex flex-col lg:flex-row lg:items-center gap-4">
                  <div className="w-12 h-12 rounded-2xl bg-orange-100 text-orange-700 grid place-items-center font-extrabold text-lg shrink-0">{s.name.charAt(0)}</div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Link href={`/admin/shops/${s.id}`} className="font-extrabold hover:text-indigo-700 hover:underline">{s.name}</Link>
                      <span className={kycChip(s.kyc_status)}>{s.kyc_status.replace('_', ' ')}</span>
                      <span className={cn('chip capitalize', s.status === 'active' ? 'bg-green-50 text-green-700' : s.status === 'suspended' ? 'bg-red-50 text-red-700' : 'bg-neutral-100 text-neutral-600')}>{s.status}</span>
                      {ob?.duplicate_name && <span className="chip bg-amber-100 text-amber-900">Duplicate name · proof review</span>}
                      <a className="text-[10px] text-indigo-700 hover:underline inline-flex items-center gap-0.5" href={publicShopPath(s.short_code)} target="_blank" rel="noreferrer">customer page <ExternalLink size={9} /></a>
                    </div>
                    <div className="text-xs text-neutral-500 mt-0.5 flex flex-wrap gap-x-2 gap-y-0.5">
                      <span>{s.city}</span>·<span>Applied {new Date(s.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
                      {ob?.business_type && <span>· {BUSINESS_TYPE_LABELS[ob.business_type] ?? ob.business_type}</span>}
                      {ob?.pincode && <span>· PIN {ob.pincode}</span>}
                    </div>
                    <div className="text-[11px] text-neutral-500 mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
                      <span>Owner: {s.owner?.full_name ?? '—'} · {s.owner?.email ?? 'no email'}</span>
                      <a href={`tel:${s.phone}`} className="inline-flex items-center gap-1 text-indigo-800 font-semibold"><Phone size={10} />{s.phone}</a>
                      {s.upi_id && <span className="font-mono">UPI: {s.upi_id}</span>}
                      {s.gstin && <span className="font-mono">GST: {s.gstin}</span>}
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-neutral-500">
                      <span className="inline-flex items-center gap-1"><Printer size={11} />{ob?.printer_count ?? '—'} printers · {ob?.staff_count ?? '—'} staff</span>
                      <span className="inline-flex items-center gap-1"><Boxes size={11} />{s.inventory_count ?? 0} inventory items</span>
                      <span className="inline-flex items-center gap-1"><Clock size={11} />{s.enabled_services ?? 0} services</span>
                      <span className="inline-flex items-center gap-2 min-w-36">
                        <span className="flex-1 h-1.5 rounded-full bg-neutral-200 overflow-hidden max-w-24"><span className={cn('block h-full rounded-full', completeness >= 80 ? 'bg-green-500' : completeness >= 50 ? 'bg-amber-500' : 'bg-red-400')} style={{ width: `${completeness}%` }} /></span>
                        <span className="font-semibold text-neutral-700">{completeness}% complete</span>
                      </span>
                    </div>
                  </div>
                  <div className="flex lg:flex-col items-center gap-1.5 shrink-0">
                    <Link href={`/admin/shops/${s.id}`} className="btn btn-dark h-9 px-3 text-xs">Review details <ChevronRight size={13} /></Link>
                    {s.kyc_status !== 'approved' && (
                      <>
                        {!ob?.duplicate_name && <button disabled={busyId === s.id} onClick={() => act(s.id, 'approve')} className="btn btn-primary h-9 px-3 text-xs">{busyId === s.id ? <Loader2 size={13} className="animate-spin" /> : <><CheckCircle2 size={13} />Approve</>}</button>}
                        <div className="flex gap-1.5">
                          <button disabled={busyId === s.id} onClick={() => act(s.id, 'request_changes')} className="btn btn-ghost h-9 px-3 text-xs"><PenLine size={13} />Changes</button>
                          <button disabled={busyId === s.id} onClick={() => act(s.id, 'reject')} className="btn btn-ghost h-9 px-3 text-xs text-red-700"><XCircle size={13} />Reject</button>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
          {shops.length === 0 && <div className="card p-10 text-center text-sm text-neutral-400">No shops found{filter !== 'all' ? ` in “${FILTERS.find((f) => f.key === filter)?.label}”` : ''}{q ? ` matching “${q}”` : ''}.</div>}
        </div>
      )}
    </div>
  );
}
