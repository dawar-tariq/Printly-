'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  ChevronLeft, FileText, Download, Loader2, User, Phone, Mail, Clock, Printer, PackageCheck,
  Package, IndianRupee, Zap, CheckCircle2, StickyNote, ListChecks, History,
} from 'lucide-react';
import { formatPaiseExact, formatDateTime, timeAgo } from '@/lib/format';
import { cn } from '@/lib/utils';
import { SERVICE_LABEL } from '@/lib/constants';

interface Detail {
  order: Record<string, unknown> & {
    id: string; token: string | null; status: string; payment_status: string; payment_method: string | null;
    customer_name: string; customer_phone: string; customer_email: string; notes: string;
    subtotal_paise: number; tax_paise: number; total_paise: number; rush: boolean; eta_minutes: number | null; utr: string | null; created_at: string;
    shops: { id: string; name: string; slug: string };
  };
  items: Array<{ id: string; service: string; paper_size: string; color: string; sides: string; paper_gsm: number; option: string | null; copies: number; pages: number; unit_price_paise: number; line_total_paise: number }>;
  files: Array<{ id: string; original_name: string; mime: string; size_bytes: number; page_count: number | null; source: string }>;
  events: Array<{ from_status: string | null; to_status: string | null; note: string | null; created_at: string }>;
  payment: { provider: string; amount_paise: number; status: string; utr: string | null; confirmed_at: string | null } | null;
}

export default function OrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch(`/api/shop/orders/${id}`, { cache: 'no-store' });
    if (res.ok) setDetail(await res.json());
    else router.push('/shop');
  }, [id, router]);
  useEffect(() => { load(); }, [load]);

  const act = async (to: string) => {
    setBusy(true);
    try {
      const res = await fetch(`/api/shop/orders/${id}/status`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ to }),
      });
      if (!res.ok) { const d = await res.json().catch(() => ({})); alert(d?.error?.message ?? 'Failed'); }
      await load();
    } finally { setBusy(false); }
  };

  if (!detail) return <div className="grid place-items-center py-20"><Loader2 className="animate-spin text-orange-600" size={30} /></div>;
  const o = detail.order;

  const nextAction =
    o.status === 'queued' ? { to: 'printing', label: 'Start printing', icon: Printer }
    : o.status === 'printing' ? { to: 'ready', label: 'Mark ready', icon: PackageCheck }
    : o.status === 'ready' ? { to: 'collected', label: o.payment_method === 'cod' ? 'Cash received — complete' : 'Mark collected', icon: Package }
    : null;

  return (
    <div className="max-w-4xl mx-auto">
      <div className="flex items-center gap-2 no-print">
        <Link href="/shop" className="p-2 -ml-2 text-neutral-500 hover:text-neutral-800"><ChevronLeft size={22} /></Link>
        <div className="flex-1">
          <h1 className="font-extrabold text-lg leading-tight">Order {o.token ?? `#${o.id.slice(0, 8).toUpperCase()}`} {o.rush && <span className="chip bg-red-100 text-red-700 ml-1 align-middle"><Zap size={10} />RUSH</span>}</h1>
          <p className="text-[11px] text-neutral-500">{formatDateTime(o.created_at)}</p>
        </div>
        <button onClick={() => window.print()} className="btn btn-ghost h-9 px-3 text-xs"><Printer size={14} />Print slip</button>
        {nextAction && (
          <button disabled={busy} onClick={() => act(nextAction.to)} className="btn btn-primary h-10 px-4 text-sm">
            {busy ? <Loader2 size={16} className="animate-spin" /> : <><nextAction.icon size={16} />{nextAction.label}</>}
          </button>
        )}
      </div>

      <div className="grid md:grid-cols-5 gap-4 mt-3">
        {/* left: files + items */}
        <div className="md:col-span-3 space-y-4">
          <section className="card p-4">
            <h2 className="text-xs font-extrabold uppercase tracking-widest text-neutral-500 flex items-center gap-1.5"><FileText size={13} />Files ({detail.files.length})</h2>
            <ul className="mt-2 divide-y divide-neutral-100">
              {detail.files.map((f) => (
                <li key={f.id} className="py-2.5 flex items-center gap-3">
                  <FileText size={20} className="text-neutral-400 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold truncate">{f.original_name}</div>
                    <div className="text-[10px] text-neutral-400">{(f.size_bytes / 1024 / 1024).toFixed(2)} MB · {f.page_count ?? '?'} page(s) · {f.source === 'dropbox' ? 'via Dropbox' : 'uploaded'}</div>
                  </div>
                  <a href={`/api/shop/orders/${o.id}/files/${f.id}/download`} target="_blank" rel="noreferrer" className="btn btn-ghost h-9 px-3 text-xs"><Download size={14} />Download</a>
                </li>
              ))}
              {detail.files.length === 0 && <li className="py-4 text-sm text-neutral-400">No files attached.</li>}
            </ul>
          </section>

          <section className="card p-4">
            <h2 className="text-xs font-extrabold uppercase tracking-widest text-neutral-500 flex items-center gap-1.5"><ListChecks size={13} />Print spec</h2>
            <div className="overflow-x-auto mt-2">
              <table className="w-full text-xs">
                <thead className="text-left text-neutral-400"><tr><th className="py-1.5 pr-2">Item</th><th className="py-1.5 pr-2">Spec</th><th className="py-1.5 pr-2 text-right">Qty</th><th className="py-1.5 text-right">Amount</th></tr></thead>
                <tbody className="divide-y divide-neutral-100">
                  {detail.items.map((i) => (
                    <tr key={i.id}>
                      <td className="py-2 pr-2 font-semibold">{SERVICE_LABEL[i.service] ?? i.service}{i.option ? ` · ${i.option}` : ''}</td>
                      <td className="py-2 pr-2 text-neutral-600">{i.service === 'bind' || i.service === 'laminate' ? (i.paper_size ?? '') : `${i.paper_size} · ${i.color === 'color' ? 'Colour' : 'B&W'}${i.sides === 'duplex' ? ' · Duplex' : ''} · ${i.paper_gsm}gsm`}</td>
                      <td className="py-2 pr-2 text-right tabular-nums">{i.service === 'bind' ? `×${i.copies}` : `${i.pages}p ×${i.copies}`}</td>
                      <td className="py-2 text-right tabular-nums">{formatPaiseExact(i.line_total_paise)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="border-t border-neutral-100 mt-2 pt-2 text-xs text-neutral-600 space-y-1">
              <div className="flex justify-between"><span>Subtotal</span><span className="tabular-nums">{formatPaiseExact(o.subtotal_paise)}</span></div>
              <div className="flex justify-between"><span>GST (incl. rush fee)</span><span className="tabular-nums">{formatPaiseExact(o.tax_paise)}</span></div>
              <div className="flex justify-between font-extrabold text-sm text-neutral-900 pt-1 border-t border-neutral-100"><span>Total</span><span className="tabular-nums">{formatPaiseExact(o.total_paise)}</span></div>
            </div>
          </section>

          {o.notes && (
            <section className="card p-4"><h2 className="text-xs font-extrabold uppercase tracking-widest text-neutral-500 flex items-center gap-1.5"><StickyNote size={13} />Note from customer</h2><p className="text-sm mt-1.5">{o.notes}</p></section>
          )}
        </div>

        {/* right: customer + payment + timeline */}
        <div className="md:col-span-2 space-y-4">
          <section className="card p-4">
            <h2 className="text-xs font-extrabold uppercase tracking-widest text-neutral-500 flex items-center gap-1.5"><User size={13} />Customer</h2>
            <div className="mt-2 text-sm space-y-1.5">
              <div className="font-bold">{o.customer_name || 'Walk-in'}</div>
              <a href={`tel:${o.customer_phone}`} className="flex items-center gap-1.5 text-orange-800 font-semibold hover:underline"><Phone size={13} />{o.customer_phone}</a>
              {o.customer_email && <a href={`mailto:${o.customer_email}`} className="flex items-center gap-1.5 text-neutral-600 hover:underline"><Mail size={13} />{o.customer_email}</a>}
            </div>
          </section>

          <section className="card p-4">
            <h2 className="text-xs font-extrabold uppercase tracking-widest text-neutral-500 flex items-center gap-1.5"><IndianRupee size={13} />Payment</h2>
            <div className="mt-2 space-y-1.5 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-neutral-600">{o.payment_method === 'cod' ? 'Cash' : 'UPI'}</span>
                <span className={cn('chip', o.payment_status === 'confirmed' || o.payment_status === 'cod_collected' ? 'bg-green-100 text-green-800' : o.payment_status === 'cod_pending' || o.payment_status === 'submitted' ? 'bg-amber-100 text-amber-800' : 'bg-red-100 text-red-800')}>{o.payment_status.replace('_', ' ')}</span>
              </div>
              <div className="flex items-center justify-between"><span className="text-neutral-600">Amount</span><span className="font-extrabold tabular-nums">{formatPaiseExact(o.total_paise)}</span></div>
              {(detail.payment?.utr || o.utr) && <div className="flex items-center justify-between"><span className="text-neutral-600">UTR</span><span className="font-mono text-xs">{detail.payment?.utr ?? o.utr}</span></div>}
              {detail.payment?.confirmed_at && <div className="flex items-center justify-between"><span className="text-neutral-600">Confirmed</span><span>{timeAgo(detail.payment.confirmed_at)}</span></div>}
            </div>
          </section>

          <section className="card p-4">
            <h2 className="text-xs font-extrabold uppercase tracking-widest text-neutral-500 flex items-center gap-1.5"><History size={13} />Timeline</h2>
            <ol className="mt-2 space-y-2 text-xs">
              {detail.events.map((e, idx) => (
                <li key={idx} className="flex items-start gap-2">
                  <CheckCircle2 size={13} className="mt-0.5 text-green-600 shrink-0" />
                  <div>
                    <div className="font-semibold">{e.from_status ? `${e.from_status} → ` : ''}{e.to_status}</div>
                    {e.note && <div className="text-neutral-500">{e.note}</div>}
                    <div className="text-[10px] text-neutral-400">{formatDateTime(e.created_at)}</div>
                  </div>
                </li>
              ))}
              {detail.events.length === 0 && <li className="text-neutral-400">No events yet.</li>}
            </ol>
          </section>
        </div>
      </div>
    </div>
  );
}
