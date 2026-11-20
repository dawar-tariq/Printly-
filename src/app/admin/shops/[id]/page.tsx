'use client';

import { use, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Loader2, CheckCircle2, XCircle, PenLine, ArrowLeft, Phone, Mail, MapPin, ExternalLink, Boxes, Printer, Clock, User, Building2, BadgeCheck, Ban, Play, Pause, Check, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { BUSINESS_TYPE_LABELS, REGISTRATION_LABELS, SERVICE_LABELS, INVENTORY_CATEGORY_LABELS, formatBusinessHours, type ChecklistItem } from '@/lib/onboarding';

interface Detail {
  shop: {
    id: string; name: string; slug: string; short_code: string; address: string; city: string; phone: string;
    gstin: string | null; upi_id: string | null; kyc_status: string; status: string; commission_bps: number;
    eta_minutes: number; rush_surcharge_bps: number; rating_avg: number; rating_count: number; created_at: string; updated_at: string;
    owner?: { id: string; email: string; full_name: string | null; phone: string | null; created_at: string } | null;
  };
  onboarding: Record<string, unknown> & {
    business_type?: string; legal_business_name?: string | null; year_established?: number | null;
    staff_count?: number; printer_count?: number; avg_daily_jobs?: number; printer_details?: string;
    pincode?: string; alternate_phone?: string | null; registration_type?: string; registration_number?: string | null;
    business_hours?: Record<string, unknown>; referral_source?: string | null;
    review_note?: string; reviewed_at?: string | null; submitted_at?: string;
  } | null;
  services: Array<{ service: string; enabled: boolean }>;
  inventory: Array<{ id: string; name: string; category: string; qty: number; unit: string; low_stock_threshold: number }>;
  rate_count: number;
  staff: Array<{ id: string; role: string; profile?: { email: string; full_name: string | null } | null }>;
  checklist: ChecklistItem[];
  completeness: number;
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2 border-b border-neutral-100 last:border-0">
      <span className="text-xs text-neutral-500 shrink-0">{label}</span>
      <span className="text-sm font-semibold text-right break-words">{value || '—'}</span>
    </div>
  );
}

export default function AdminShopDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [data, setData] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/admin/shops/${id}`, { cache: 'no-store' });
    if (!res.ok) { setError('Could not load shop'); return; }
    const d = await res.json();
    setData(d);
    setNote(d.onboarding?.review_note ?? '');
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const act = async (action: 'approve' | 'reject' | 'request_changes' | 'suspend' | 'activate') => {
    setBusy(action); setToast(null);
    try {
      const res = await fetch(`/api/admin/shops/${id}/kyc`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, note: note.trim() || undefined }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { setToast(body?.error?.message ?? 'Action failed'); return; }
      setToast(`Shop ${action === 'approve' ? 'approved & activated' : action === 'reject' ? 'rejected' : action === 'request_changes' ? 'sent back for changes' : action === 'suspend' ? 'suspended' : 'activated'}.`);
      await load();
    } finally { setBusy(null); }
  };

  if (error) return <div className="card p-10 text-center text-sm text-red-600">{error}</div>;
  if (!data) return <div className="grid place-items-center py-24"><Loader2 className="animate-spin text-indigo-600" size={30} /></div>;

  const { shop, onboarding: ob, services, inventory, checklist, completeness } = data;
  const missing = checklist.filter((c) => !c.done);
  const enabledServices = services.filter((s) => s.enabled);

  return (
    <div className="pb-10">
      <Link href="/admin/shops" className="inline-flex items-center gap-1 text-xs font-bold text-indigo-700 hover:underline"><ArrowLeft size={13} />Back to shops</Link>

      <div className="card mt-3 p-5">
        <div className="flex flex-col sm:flex-row sm:items-start gap-4">
          <div className="w-14 h-14 rounded-2xl bg-orange-100 text-orange-700 grid place-items-center font-extrabold text-2xl shrink-0">{shop.name.charAt(0)}</div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-2xl font-extrabold tracking-tight">{shop.name}</h1>
              <span className={cn('chip capitalize', shop.kyc_status === 'approved' ? 'bg-green-100 text-green-800' : shop.kyc_status === 'pending' ? 'bg-amber-100 text-amber-800' : shop.kyc_status === 'rejected' ? 'bg-red-100 text-red-700' : 'bg-sky-100 text-sky-800')}>{shop.kyc_status.replace('_', ' ')}</span>
              <span className="chip bg-neutral-100 text-neutral-700 capitalize">{shop.status}</span>
            </div>
            <div className="text-xs text-neutral-500 mt-1 flex flex-wrap gap-x-3 gap-y-1">
              <span className="inline-flex items-center gap-1"><MapPin size={11} />{shop.address}, {shop.city}</span>
              <span>Slug: <span className="font-mono">{shop.slug}</span> · Code: <span className="font-mono">{shop.short_code}</span></span>
              <span>Applied {new Date(shop.created_at).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              <a href={`/s/${shop.slug}`} target="_blank" rel="noreferrer" className="btn btn-ghost h-8 px-3 text-xs"><ExternalLink size={12} />Customer page</a>
              <a href={`tel:${shop.phone}`} className="btn btn-ghost h-8 px-3 text-xs"><Phone size={12} />Call shop</a>
              {shop.owner?.email && <a href={`mailto:${shop.owner.email}`} className="btn btn-ghost h-8 px-3 text-xs"><Mail size={12} />Email owner</a>}
            </div>
          </div>
          <div className="shrink-0 text-center">
            <div className="text-3xl font-extrabold tabular-nums">{completeness}%</div>
            <div className="text-[10px] uppercase tracking-widest text-neutral-400">Onboarding complete</div>
            <div className="mt-2 h-2 w-32 rounded-full bg-neutral-200 overflow-hidden mx-auto"><div className={cn('h-full', completeness >= 80 ? 'bg-green-500' : completeness >= 50 ? 'bg-amber-500' : 'bg-red-400')} style={{ width: `${completeness}%` }} /></div>
          </div>
        </div>
      </div>

      {toast && <div className="mt-3 rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">{toast}</div>}

      <div className="grid lg:grid-cols-3 gap-4 mt-4">
        <div className="lg:col-span-2 space-y-4">
          {/* Checklist */}
          <section className="card p-5">
            <h2 className="text-sm font-extrabold flex items-center gap-2"><BadgeCheck size={15} className="text-indigo-600" />What&apos;s needed — onboarding checklist</h2>
            <p className="text-[11px] text-neutral-500 mt-0.5">Everything a shop should provide before going live. Missing items are highlighted.</p>
            <div className="grid sm:grid-cols-2 gap-x-6 mt-3">
              {checklist.map((c) => (
                <div key={c.key} className={cn('flex items-start gap-2.5 py-2 border-b border-neutral-100', c.done ? '' : 'text-neutral-500')}>
                  <span className={cn('mt-0.5 w-5 h-5 rounded-full grid place-items-center shrink-0', c.done ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700')}>
                    {c.done ? <Check size={12} /> : <AlertTriangle size={11} />}
                  </span>
                  <div className="min-w-0">
                    <div className={cn('text-sm font-semibold', c.done ? 'text-neutral-900' : 'text-amber-900')}>{c.label}</div>
                    <div className="text-[11px] text-neutral-400">{c.hint}</div>
                  </div>
                </div>
              ))}
            </div>
            {missing.length > 0 && <p className="mt-3 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">Still needed: {missing.map((m) => m.label).join(', ')}.</p>}
          </section>

          {/* Business details */}
          <section className="card p-5">
            <h2 className="text-sm font-extrabold flex items-center gap-2"><Building2 size={15} className="text-indigo-600" />Business &amp; owner details</h2>
            <div className="mt-2">
              <Row label="Shop name" value={shop.name} />
              <Row label="Legal business name" value={ob?.legal_business_name} />
              <Row label="Business type" value={ob?.business_type ? BUSINESS_TYPE_LABELS[ob.business_type] ?? ob.business_type : null} />
              <Row label="Year established" value={ob?.year_established} />
              <Row label="Owner" value={shop.owner ? `${shop.owner.full_name ?? '—'} (${shop.owner.email})` : null} />
              <Row label="Phone" value={shop.phone} />
              <Row label="Alternate phone" value={ob?.alternate_phone} />
              <Row label="Address" value={`${shop.address}, ${shop.city}${ob?.pincode ? ` — ${ob.pincode}` : ''}`} />
              <Row label="GSTIN" value={shop.gstin ? <span className="font-mono">{shop.gstin}</span> : null} />
              <Row label="UPI ID" value={shop.upi_id ? <span className="font-mono">{shop.upi_id}</span> : null} />
              <Row label="Registration" value={ob?.registration_type ? `${REGISTRATION_LABELS[ob.registration_type] ?? ob.registration_type}${ob.registration_number ? ` · ${ob.registration_number}` : ''}` : null} />
              <Row label="Business hours" value={formatBusinessHours(ob?.business_hours)} />
              <Row label="Staff / printers" value={`${ob?.staff_count ?? '—'} staff · ${ob?.printer_count ?? '—'} printers`} />
              <Row label="Avg daily jobs" value={ob?.avg_daily_jobs != null ? String(ob.avg_daily_jobs) : null} />
              <Row label="Printer details" value={ob?.printer_details} />
              <Row label="How they found Printly" value={ob?.referral_source} />
              <Row label="Commission" value={`${(shop.commission_bps / 100).toFixed(1)}% · ETA ${shop.eta_minutes} min · Rush +${(shop.rush_surcharge_bps / 100).toFixed(0)}%`} />
              <Row label="Rating" value={shop.rating_count ? `${shop.rating_avg} (${shop.rating_count} reviews)` : 'No reviews yet'} />
            </div>
          </section>

          {/* Services */}
          <section className="card p-5">
            <h2 className="text-sm font-extrabold flex items-center gap-2"><Printer size={15} className="text-indigo-600" />Services offered</h2>
            <div className="flex flex-wrap gap-2 mt-3">
              {services.map((s) => (
                <span key={s.service} className={cn('chip', s.enabled ? 'bg-green-100 text-green-800' : 'bg-neutral-100 text-neutral-500 line-through')}>{SERVICE_LABELS[s.service] ?? s.service}</span>
              ))}
              {services.length === 0 && <span className="text-sm text-neutral-400">No services configured</span>}
            </div>
            <p className="text-[11px] text-neutral-400 mt-2">{enabledServices.length} enabled · {data.rate_count} rate-card rows seeded</p>
          </section>

          {/* Inventory */}
          <section className="card p-5">
            <h2 className="text-sm font-extrabold flex items-center gap-2"><Boxes size={15} className="text-indigo-600" />Starting inventory ({inventory.length} items)</h2>
            {inventory.length === 0 ? (
              <p className="text-sm text-neutral-400 mt-3">No inventory submitted during onboarding. The owner can add stock from Inventory after approval.</p>
            ) : (
              <div className="overflow-x-auto mt-3">
                <table className="w-full text-sm">
                  <thead><tr className="text-left text-[11px] uppercase tracking-wider text-neutral-400 border-b border-neutral-200">
                    <th className="py-2 pr-3 font-semibold">Item</th><th className="py-2 pr-3 font-semibold">Category</th><th className="py-2 pr-3 font-semibold">Qty</th><th className="py-2 font-semibold">Low-stock alert</th>
                  </tr></thead>
                  <tbody>
                    {inventory.map((i) => (
                      <tr key={i.id} className="border-b border-neutral-100 last:border-0">
                        <td className="py-2 pr-3 font-semibold">{i.name}</td>
                        <td className="py-2 pr-3 text-neutral-600">{INVENTORY_CATEGORY_LABELS[i.category] ?? i.category}</td>
                        <td className="py-2 pr-3 tabular-nums">{i.qty} {i.unit}</td>
                        <td className="py-2 tabular-nums text-neutral-500">{i.low_stock_threshold} {i.unit}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* Staff */}
          {data.staff.length > 0 && (
            <section className="card p-5">
              <h2 className="text-sm font-extrabold flex items-center gap-2"><User size={15} className="text-indigo-600" />Team access</h2>
              <div className="mt-2">
                {data.staff.map((m) => (
                  <Row key={m.id} label={m.role} value={m.profile ? `${m.profile.full_name ?? '—'} (${m.profile.email})` : '—'} />
                ))}
              </div>
            </section>
          )}
        </div>

        {/* Review panel */}
        <aside className="space-y-4">
          <section className="card p-5 lg:sticky lg:top-24">
            <h2 className="text-sm font-extrabold">Review &amp; decide</h2>
            <p className="text-[11px] text-neutral-500 mt-0.5">Your note is saved with the application and shown to the shop owner.</p>
            <label className="label mt-3">Note for the shop owner (optional)</label>
            <textarea className="input min-h-24 text-sm" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Please add your UPI ID and printer models, then resubmit." />
            {ob?.reviewed_at && <p className="text-[11px] text-neutral-400 mt-1">Last reviewed {new Date(ob.reviewed_at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</p>}

            <div className="grid gap-2 mt-4">
              {shop.kyc_status !== 'approved' && (
                <button disabled={busy != null} onClick={() => act('approve')} className="btn btn-primary h-11 text-sm">
                  {busy === 'approve' ? <Loader2 size={15} className="animate-spin" /> : <><CheckCircle2 size={15} />Approve &amp; activate shop</>}
                </button>
              )}
              {shop.kyc_status !== 'approved' && shop.kyc_status !== 'rejected' && (
                <button disabled={busy != null} onClick={() => act('request_changes')} className="btn btn-ghost h-11 text-sm">
                  {busy === 'request_changes' ? <Loader2 size={15} className="animate-spin" /> : <><PenLine size={15} />Request changes</>}
                </button>
              )}
              {shop.kyc_status !== 'rejected' && (
                <button disabled={busy != null} onClick={() => act('reject')} className="btn btn-ghost h-11 text-sm text-red-700">
                  {busy === 'reject' ? <Loader2 size={15} className="animate-spin" /> : <><XCircle size={15} />Reject application</>}
                </button>
              )}
              {shop.status === 'active' && (
                <button disabled={busy != null} onClick={() => act('suspend')} className="btn btn-ghost h-11 text-sm text-red-700">
                  {busy === 'suspend' ? <Loader2 size={15} className="animate-spin" /> : <><Ban size={15} />Suspend shop</>}
                </button>
              )}
              {shop.status === 'suspended' && (
                <button disabled={busy != null} onClick={() => act('activate')} className="btn btn-ghost h-11 text-sm">
                  {busy === 'activate' ? <Loader2 size={15} className="animate-spin" /> : <><Play size={15} />Reactivate shop</>}
                </button>
              )}
              {shop.status === 'paused' && shop.kyc_status === 'approved' && (
                <button disabled={busy != null} onClick={() => act('activate')} className="btn btn-ghost h-11 text-sm">
                  {busy === 'activate' ? <Loader2 size={15} className="animate-spin" /> : <><Play size={15} />Set live</>}
                </button>
              )}
            </div>
            <p className="text-[11px] text-neutral-400 mt-3 flex items-start gap-1.5"><Clock size={11} className="mt-0.5 shrink-0" />Approving makes the shop active and visible to customers. Suspending hides it without deleting data.</p>
          </section>

          <section className="card p-5">
            <h2 className="text-sm font-extrabold">Quick facts</h2>
            <div className="mt-2">
              <Row label="Services enabled" value={String(enabledServices.length)} />
              <Row label="Inventory items" value={String(inventory.length)} />
              <Row label="Rate-card rows" value={String(data.rate_count)} />
              <Row label="Team members" value={String(data.staff.length)} />
              <Row label="Submitted" value={ob?.submitted_at ? new Date(ob.submitted_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : new Date(shop.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })} />
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}
