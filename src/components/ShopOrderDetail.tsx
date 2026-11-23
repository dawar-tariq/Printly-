'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  ChevronLeft, FileText, Download, Loader2, User, Phone, Mail, Clock, Printer, PackageCheck,
  Package, IndianRupee, Zap, CheckCircle2, StickyNote, ListChecks, History, Eye,
} from 'lucide-react';
import { PrintFileDialog } from '@/components/PrintFileDialog';
import { BrandArtwork } from '@/components/BrandArtwork';
import { isPreviewable, isWord } from '@/lib/document-shared';
import { formatPaiseExact, formatDateTime, timeAgo } from '@/lib/format';
import { cn } from '@/lib/utils';
import { SERVICE_LABEL } from '@/lib/constants';
import { duplexSheets } from '@/lib/duplex';

interface Detail {
  order: Record<string, unknown> & {
    id: string; token: string | null; status: string; payment_status: string; payment_method: string | null;
    customer_name: string; customer_phone: string; customer_email: string; notes: string;
    subtotal_paise: number; tax_paise: number; total_paise: number; rush: boolean; eta_minutes: number | null; utr: string | null; created_at: string;
    shops: { id: string; name: string; slug: string };
  };
  items: Array<{ id: string; file_id: string | null; service: string; paper_size: string; color: string; sides: string; paper_gsm: number; option: string | null; copies: number; pages: number; unit_price_paise: number; line_total_paise: number }>;
  files: Array<{ id: string; original_name: string; mime: string; size_bytes: number; page_count: number | null; source: string }>;
  events: Array<{ from_status: string | null; to_status: string | null; note: string | null; created_at: string }>;
  payment: { provider: string; amount_paise: number; status: string; utr: string | null; confirmed_at: string | null } | null;
}

export function ShopOrderDetail({ backHref = '/shop' }: { backHref?: string }) {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [busy, setBusy] = useState(false);
  const [reportUtr, setReportUtr] = useState('');
  const [reportMessage, setReportMessage] = useState<string | null>(null);
  const [printFile, setPrintFile] = useState<Detail['files'][number] | null>(null);
  const [checkedFiles, setCheckedFiles] = useState<string[]>([]);

  const load = useCallback(async () => {
    const res = await fetch(`/api/shop/orders/${id}`, { cache: 'no-store' });
    if (res.ok) setDetail(await res.json());
    else router.push(backHref);
  }, [id, router, backHref]);
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

  const recordCustomerReport = async () => {
    if (busy || !window.confirm('Has the customer told you they sent this payment? This only records their report. You must verify the transfer separately before confirming it.')) return;
    setBusy(true); setReportMessage(null);
    try {
      const res = await fetch(`/api/shop/orders/${id}/confirm-payment`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'report', utr: reportUtr.trim() || undefined }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setReportMessage(data?.error?.message ?? 'Could not record the report. Please retry.');
      } else {
        setReportMessage('Customer report recorded. Verify the transfer before confirming payment.');
        await load().catch(() => {});
      }
    } catch { setReportMessage('Could not record the report. Check the order before retrying.'); }
    finally { setBusy(false); }
  };

  const decidePayment = async (action: 'confirm' | 'reject') => {
    const message = action === 'confirm'
      ? 'Have you independently verified that this customer’s UPI transfer reached your account? A payment report alone is not proof.'
      : 'Mark this customer payment as not received? The customer can report it again.';
    if (busy || !window.confirm(message)) return;
    setBusy(true); setReportMessage(null);
    try {
      const res = await fetch(`/api/shop/orders/${id}/confirm-payment`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) setReportMessage(body?.error?.message ?? 'Could not update payment. Please retry.');
      else { setReportMessage(action === 'confirm' ? 'Payment confirmed and order queued.' : 'Payment marked not received.'); await load(); }
    } catch { setReportMessage('Connection interrupted. Refresh the order before trying again.'); }
    finally { setBusy(false); }
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
      <div className="flex flex-wrap items-center gap-2 no-print">
        <Link href={backHref} aria-label="Back to orders" className="-ml-2 shrink-0 p-2 text-neutral-500 hover:text-neutral-800"><ChevronLeft size={22} /></Link>
        <div className="min-w-0 flex-1 basis-[calc(100%-3rem)] sm:basis-auto">
          <h1 className="break-words font-extrabold text-lg leading-tight">Order {o.token ?? `#${o.id.slice(0, 8).toUpperCase()}`} {o.rush && <span className="chip bg-red-100 text-red-700 ml-1 align-middle"><Zap size={10} />RUSH</span>}</h1>
          <p className="text-[11px] text-neutral-500">{formatDateTime(o.created_at)}</p>
        </div>
        <div className="flex flex-wrap gap-2 pl-8 sm:pl-0">
          <button onClick={() => window.print()} className="btn btn-ghost min-h-10 px-3 text-xs"><Printer size={14} />Print slip</button>
          {nextAction && <button disabled={busy} onClick={() => act(nextAction.to)} className="btn btn-primary min-h-10 px-4 text-sm">
            {busy ? <Loader2 size={16} className="animate-spin" /> : <><nextAction.icon size={16} />{nextAction.label}</>}
          </button>}
          {o.status === 'queued' && <button disabled={busy} onClick={() => { if (window.confirm('Cancel this order? Any payment or refund must be handled separately; cancelling does not send a refund.')) void act('cancelled'); }} className="btn btn-ghost min-h-10 px-3 text-xs text-red-700">Cancel order</button>}
        </div>
      </div>
      <div className="hidden print:block"><div role="img" aria-label="Printly"><BrandArtwork className="mb-3 h-8 w-auto" /></div><h1 className="text-lg font-extrabold">Order {o.token ?? `#${o.id.slice(0, 8).toUpperCase()}`}</h1><p className="text-xs">{formatDateTime(o.created_at)} · {o.shops.name}</p></div>

      <div className="grid grid-cols-1 md:grid-cols-5 gap-4 mt-3">
        {/* left: files + items */}
        <div className="min-w-0 md:col-span-3 space-y-4">
          <section className="card p-4">
            <h2 className="text-xs font-extrabold uppercase tracking-widest text-neutral-500 flex items-center gap-1.5"><FileText size={13} />Files ({detail.files.length})</h2>
            <ul className="mt-2 divide-y divide-neutral-100">
              {detail.files.map((f) => (
                <li key={f.id} className="py-3">
                  <div className="flex min-w-0 items-start gap-3">
                    <FileText size={20} className="mt-0.5 shrink-0 text-neutral-400" />
                    <div className="min-w-0 flex-1">
                      <div className="break-all text-sm font-semibold">{f.original_name}</div>
                      <div className="text-[11px] text-neutral-500">{(f.size_bytes / 1024 / 1024).toFixed(2)} MB · {f.page_count === null ? 'page count supplied by customer' : `${f.page_count} page(s)`} · {f.source === 'dropbox' ? 'via Dropbox' : 'uploaded'}</div>
                      {isWord(f.mime) && <p className="mt-1 text-xs text-amber-800">Word preview is unavailable. Download it and check the page count and layout in Word before printing.</p>}
                      {checkedFiles.includes(f.id) && <p className="mt-1 text-xs font-semibold text-green-700">Physical print checked during this visit</p>}
                    </div>
                  </div>
                  <div className="no-print mt-2 flex flex-wrap gap-2 pl-8">
                    {isPreviewable(f.mime) && <button type="button" onClick={() => setPrintFile(f)} className="btn btn-primary min-h-10 px-3 text-xs"><Eye size={14} />Preview &amp; print</button>}
                    <a href={`/api/shop/orders/${o.id}/files/${f.id}/download`} target="_blank" rel="noreferrer" className="btn btn-ghost min-h-10 px-3 text-xs"><Download size={14} />Download</a>
                  </div>
                </li>
              ))}
              {detail.files.length === 0 && <li className="py-4 text-sm text-neutral-400">No files attached.</li>}
            </ul>
          </section>

          <section className="card p-4">
            <h2 className="text-xs font-extrabold uppercase tracking-widest text-neutral-500 flex items-center gap-1.5"><ListChecks size={13} />Print spec</h2>
            <div className="mt-2 max-w-full overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="text-left text-neutral-400"><tr><th className="py-1.5 pr-2">Item</th><th className="py-1.5 pr-2">Spec</th><th className="py-1.5 pr-2 text-right">Qty</th><th className="py-1.5 text-right">Amount</th></tr></thead>
                <tbody className="divide-y divide-neutral-100">
                  {detail.items.map((i) => (
                    <tr key={i.id}>
                      <td className="py-2 pr-2 font-semibold">
                        {SERVICE_LABEL[i.service] ?? i.service}{i.option ? ` · ${i.option}` : ''}
                        {i.file_id && <span className="block max-w-40 break-all text-[10px] font-normal text-neutral-500">{detail.files.find((file) => file.id === i.file_id)?.original_name ?? 'File unavailable'}</span>}
                      </td>
                      <td className="py-2 pr-2 text-neutral-600">{i.service === 'bind' || i.service === 'laminate' ? (i.paper_size ?? '') : `${i.paper_size} · ${i.color === 'color' ? 'Colour' : 'B&W'}${i.sides === 'duplex' ? ' · Duplex' : ''} · ${i.paper_gsm}gsm`}</td>
                      <td className="py-2 pr-2 text-right tabular-nums">
                        {i.service === 'bind' ? `×${i.copies}` : `${i.pages}p ×${i.copies}`}
                        {(i.service === 'print' || i.service === 'photocopy') && i.sides === 'duplex' && <span className="block text-[10px] text-neutral-500">{duplexSheets(i.pages, i.copies)} sheets needed</span>}
                      </td>
                      <td className="py-2 text-right tabular-nums">{formatPaiseExact(i.line_total_paise)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {detail.items.some((item) => (item.service === 'print' || item.service === 'photocopy') && item.sides === 'duplex') && <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-relaxed text-amber-950">
              <strong>Double-sided instructions:</strong> print each whole file in order, with pages 1/2, 3/4 and so on on opposite sides. Leave an odd last page’s back blank. Start each file and copy on a fresh sheet; print copies separately if needed. Select two-sided and one page per side in the printer dialog, check the flip edge, and inspect the paper. Sheet counts above describe paper needed, not necessarily the billing unit.
            </div>}
            <div className="border-t border-neutral-100 mt-2 pt-2 text-xs text-neutral-600 space-y-1">
              <div className="flex justify-between"><span>Subtotal</span><span className="tabular-nums">{formatPaiseExact(o.subtotal_paise)}</span></div>
              <div className="flex justify-between"><span>GST + any rush fee</span><span className="tabular-nums">{formatPaiseExact(o.tax_paise)}</span></div>
              <div className="flex justify-between font-extrabold text-sm text-neutral-900 pt-1 border-t border-neutral-100"><span>Total</span><span className="tabular-nums">{formatPaiseExact(o.total_paise)}</span></div>
            </div>
          </section>

          {o.notes && (
            <section className="card p-4"><h2 className="text-xs font-extrabold uppercase tracking-widest text-neutral-500 flex items-center gap-1.5"><StickyNote size={13} />Note from customer</h2><p className="mt-1.5 break-words text-sm">{o.notes}</p></section>
          )}
        </div>

        {/* right: customer + payment + timeline */}
        <div className="min-w-0 md:col-span-2 space-y-4">
          <section className="card p-4">
            <h2 className="text-xs font-extrabold uppercase tracking-widest text-neutral-500 flex items-center gap-1.5"><User size={13} />Customer</h2>
            <div className="mt-2 text-sm space-y-1.5">
              <div className="break-words font-bold">{o.customer_name || 'Walk-in'}</div>
              <a href={`tel:${o.customer_phone}`} className="flex items-start gap-1.5 break-all text-orange-800 font-semibold hover:underline"><Phone size={13} className="mt-1 shrink-0" />{o.customer_phone}</a>
              {o.customer_email && <a href={`mailto:${o.customer_email}`} className="flex items-start gap-1.5 break-all text-neutral-600 hover:underline"><Mail size={13} className="mt-1 shrink-0" />{o.customer_email}</a>}
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
              {(detail.payment?.utr || o.utr) && <div className="flex items-start justify-between gap-3"><span className="shrink-0 text-neutral-600">UTR</span><span className="min-w-0 break-all text-right font-mono text-xs">{detail.payment?.utr ?? o.utr}</span></div>}
              {detail.payment?.confirmed_at && <div className="flex items-center justify-between"><span className="text-neutral-600">Confirmed</span><span>{timeAgo(detail.payment.confirmed_at)}</span></div>}
            </div>
            {o.status === 'draft' && o.payment_method === 'upi' && (o.payment_status === 'pending' || o.payment_status === 'rejected') && (
              <div className="no-print mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3">
                <p className="text-xs leading-relaxed text-amber-900">If the customer contacted you because they cannot report their payment, record their claim here. This does not confirm payment.</p>
                <label className="label mt-2">Customer’s UTR / reference (optional)
                  <input value={reportUtr} onChange={(event) => setReportUtr(event.target.value)} maxLength={40} className="input mt-1 text-sm" />
                </label>
                <button type="button" disabled={busy} onClick={() => void recordCustomerReport()} className="btn btn-ghost mt-2 min-h-10 w-full px-3 text-xs">Record customer’s payment report</button>
              </div>
            )}
            {o.status === 'draft' && o.payment_method === 'upi' && o.payment_status === 'submitted' && <div className="no-print mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3">
              <p className="text-xs text-amber-900">The customer reported a payment. Independently check your receiving account before confirming.</p>
              <div className="mt-3 flex flex-wrap gap-2"><button disabled={busy} onClick={() => void decidePayment('confirm')} className="btn btn-primary min-h-10 px-3 text-xs">Payment received</button><button disabled={busy} onClick={() => void decidePayment('reject')} className="btn btn-ghost min-h-10 px-3 text-xs text-red-700">Not received</button></div>
            </div>}
            {reportMessage && <p role="status" className="no-print mt-2 text-xs text-neutral-700">{reportMessage}</p>}
          </section>

          <section className="card p-4">
            <h2 className="text-xs font-extrabold uppercase tracking-widest text-neutral-500 flex items-center gap-1.5"><History size={13} />Timeline</h2>
            <ol className="mt-2 space-y-2 text-xs">
              {detail.events.map((e, idx) => (
                <li key={idx} className="flex items-start gap-2">
                  <CheckCircle2 size={13} className="mt-0.5 text-green-600 shrink-0" />
                  <div className="min-w-0 flex-1 break-words">
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
      {printFile && <PrintFileDialog url={`/api/shop/orders/${o.id}/files/${printFile.id}/preview`} mime={printFile.mime} name={printFile.original_name}
        specs={detail.items.filter((item) => item.file_id === printFile.id)} onClose={() => setPrintFile(null)}
        onChecked={() => setCheckedFiles((files) => files.includes(printFile.id) ? files : [...files, printFile.id])} />}
    </div>
  );
}
