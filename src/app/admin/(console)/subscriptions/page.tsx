'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, CheckCircle2, CreditCard, Loader2, RefreshCw, Search, ShieldCheck } from 'lucide-react';
import { formatPaiseExact } from '@/lib/format';
import { paiseToInput, rupeesToPaise, subscriptionDate, subscriptionState, termLabel, type ShopSubscription, type SubscriptionPlan, type SubscriptionPurchase } from '@/lib/subscription';

type Shop = { id: string; name: string; short_code: string; status: string; subscription: ShopSubscription | null };
type Purchase = SubscriptionPurchase & { shop: { id: string; name: string; short_code: string } | null; subscription?: ShopSubscription | null };
type Data = { plan: SubscriptionPlan & { version: number }; shops: Shop[]; pending: Purchase[]; history: Purchase[]; pagination: { page: number; pages: number; count: number; pendingPage: number; pendingPages: number; pendingCount: number } };
type Form = { monthly: string; six: string; yearly: string; upi: string; name: string; warning: string };
const stateText = { active: 'Active', expiring: 'Expiring soon', expired: 'Expired', not_subscribed: 'Not subscribed', permanent: 'Permanent' };

function Pager({ page, pages, setPage }: { page: number; pages: number; setPage: (n: number) => void }) {
  if (pages <= 1 && page <= 1) return null;
  return <div className="mt-3 flex items-center justify-end gap-2 text-xs text-neutral-600"><button disabled={page <= 1} onClick={() => setPage(page - 1)} className="btn btn-ghost min-h-9 px-3 disabled:opacity-40">Previous</button><span>Page {page} of {pages}</span><button disabled={page >= pages} onClick={() => setPage(page + 1)} className="btn btn-ghost min-h-9 px-3 disabled:opacity-40">Next</button></div>;
}

export default function AdminSubscriptionsPage() {
  const [data, setData] = useState<Data | null>(null);
  const [form, setForm] = useState<Form>({ monthly: '', six: '', yearly: '', upi: '', name: '', warning: '7' });
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pendingPage, setPendingPage] = useState(1);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [verified, setVerified] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const formLoaded = useRef(false);
  const formVersion = useRef<number | null>(null);

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams({ page: String(page), pending_page: String(pendingPage), q: search });
      const res = await fetch(`/api/admin/subscriptions?${params}`, { cache: 'no-store' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error?.message ?? 'Could not load subscriptions.');
      const next = body as Data;
      setData(next); setError('');
      if (!formLoaded.current) {
        formVersion.current = next.plan.version;
        setForm({ monthly: paiseToInput(next.plan.monthly_paise), six: paiseToInput(next.plan.six_months_paise), yearly: paiseToInput(next.plan.yearly_paise), upi: next.plan.upi_id ?? '', name: next.plan.payee_name ?? '', warning: String(next.plan.warning_days) });
        formLoaded.current = true;
      }
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not load subscriptions.'); }
  }, [page, pendingPage, search]);
  useEffect(() => { void load(); }, [load]);

  const post = async (url: string, body: Record<string, unknown>, message: string, method = 'POST') => {
    if (busy) return false;
    setBusy(url); setError(''); setNotice('');
    try {
      const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const result = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(result?.error?.message ?? 'Could not save the change.');
      setNotice(message);
      if (method === 'PUT') formLoaded.current = false;
      await load();
      return true;
    } catch (err) { setError(err instanceof Error ? err.message : 'Connection interrupted. Refresh before retrying.'); return false; }
    finally { setBusy(''); }
  };

  const savePlan = (event: React.FormEvent) => {
    event.preventDefault();
    const convert = (value: string) => value.trim() ? rupeesToPaise(value) : null;
    const monthly = convert(form.monthly), six = convert(form.six), yearly = convert(form.yearly);
    if ((form.monthly.trim() && monthly === null) || (form.six.trim() && six === null) || (form.yearly.trim() && yearly === null)) { setError('Use a positive price up to ₹10,00,000 with at most two decimal places, or leave the term blank to disable it.'); return; }
    const warning = Number(form.warning);
    if (!Number.isInteger(warning) || warning < 1 || warning > 30) { setError('Reminder days must be between 1 and 30.'); return; }
    if (!Number.isSafeInteger(formVersion.current) || formVersion.current === null) { setError('Could not verify the plan version. Reload the saved plan values.'); return; }
    void post('/api/admin/subscriptions', { expected_version: formVersion.current, monthly_paise: monthly, six_months_paise: six, yearly_paise: yearly, upi_id: form.upi.trim() || null, payee_name: form.name.trim() || null, warning_days: warning }, 'Subscription settings saved. New requests use these details; existing requests keep their original price and recipient.', 'PUT');
  };
  const review = (purchase: Purchase, action: 'approve' | 'reject') => {
    const note = notes[purchase.id]?.trim() ?? '';
    if (action === 'approve' && !verified[purchase.id]) { setError('Independently verify the transfer before approving.'); return; }
    if (action === 'reject' && note.length < 3) { setError('Enter a reason of at least three characters before rejecting.'); return; }
    const prompt = action === 'approve' ? `Have you independently confirmed ${formatPaiseExact(purchase.amount_paise)} was received at ${purchase.upi_id} with reference ${purchase.utr}? Approval grants ${termLabel(purchase.term)} access.` : 'Reject this payment report? The owner will see your reason.';
    if (window.confirm(prompt)) void post('/api/admin/subscriptions/review', { purchase_id: purchase.id, action, note }, action === 'approve' ? 'Payment approved and subscription updated.' : 'Payment report rejected. The owner can see your reason.');
  };
  const setPermanent = (shop: Shop, enabled: boolean) => {
    const prompt = enabled ? `Give ${shop.name} permanent free access without a purchase?` : `Remove permanent access for ${shop.name}? Any still-valid paid or transition period remains; otherwise the shop will be locked.`;
    if (window.confirm(prompt)) void post('/api/admin/subscriptions/permanent', { shop_id: shop.id, enabled, note: enabled ? 'Permanent access granted in admin console' : 'Permanent access revoked in admin console' }, enabled ? `Permanent access granted to ${shop.name}.` : `Permanent access revoked for ${shop.name}.`);
  };
  if (!data) return <div className="card p-8 text-center">{error ? <><p role="alert" className="text-sm text-red-700">{error}</p><button onClick={() => void load()} className="btn btn-ghost mt-4 min-h-10 px-4">Try again</button></> : <Loader2 className="mx-auto animate-spin text-indigo-600" />}</div>;

  return <div className="space-y-5 pb-10">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-widest text-indigo-700">Admin console</p><h1 className="mt-1 text-2xl font-extrabold">Subscription</h1><p className="mt-1 text-sm text-neutral-600">One all-features plan, with three durations and manual UPI verification.</p></div><button onClick={() => void load()} className="btn btn-ghost min-h-10 px-3 text-xs"><RefreshCw size={14} />Refresh</button></div>
    {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</div>}
    {notice && <div role="status" className="rounded-xl border border-green-200 bg-green-50 p-3 text-sm text-green-800">{notice}</div>}

    <section className="card p-5"><h2 className="flex items-center gap-2 text-lg font-extrabold"><CreditCard size={19} className="text-indigo-600" />Plan and payment settings</h2>
      <p className="mt-1 text-xs text-neutral-500">Set Printly’s own receiving UPI ID, payee name and prices. A blank price disables that term. Existing requests retain their original amount and recipient.</p>
      <form onSubmit={savePlan} className="mt-4 space-y-4"><div className="grid gap-3 sm:grid-cols-3">{([
        ['monthly', 'Monthly price (₹)'], ['six', 'Six-month price (₹)'], ['yearly', 'Yearly price (₹)'],
      ] as const).map(([key, label]) => <label key={key} className="text-xs font-bold text-neutral-700">{label}<input className="input mt-1 w-full text-sm" inputMode="decimal" placeholder="Not configured" value={form[key]} onChange={(event) => setForm({ ...form, [key]: event.target.value })} /></label>)}</div>
        <div className="grid gap-3 sm:grid-cols-3"><label className="text-xs font-bold text-neutral-700">Printly UPI ID<input className="input mt-1 w-full text-sm" placeholder="name@bank" value={form.upi} maxLength={100} onChange={(event) => setForm({ ...form, upi: event.target.value })} /></label><label className="text-xs font-bold text-neutral-700">UPI payee name<input className="input mt-1 w-full text-sm" placeholder="Payee name" value={form.name} maxLength={50} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label><label className="text-xs font-bold text-neutral-700">Warn before expiry (days)<input className="input mt-1 w-full text-sm" type="number" min={1} max={30} value={form.warning} onChange={(event) => setForm({ ...form, warning: event.target.value })} /></label></div>
        <div className="flex flex-wrap gap-2"><button disabled={!!busy} className="btn btn-primary min-h-11 px-5 text-sm">Save plan settings</button><button type="button" disabled={!!busy} className="btn btn-ghost min-h-11 px-4 text-xs" onClick={() => { if (window.confirm('Reload the saved plan values? Unsaved edits will be discarded.')) { formLoaded.current = false; void load(); } }}>Reload saved values</button></div>
      </form>
    </section>

    <section className="rounded-2xl border-2 border-amber-300 bg-amber-50 p-5"><h2 className="flex items-center gap-2 text-lg font-extrabold text-amber-950"><AlertTriangle size={19} />Verify payments ({data.pagination.pendingCount})</h2><p className="mt-1 text-xs leading-relaxed text-amber-900">A submitted reference is a claim, not proof of payment. Check the actual bank/UPI receipt, amount, reference and recipient independently before approving. No automatic billing or verification occurs.</p>
      <div className="mt-3 space-y-3">{data.pending.map((p) => <article key={p.id} className="rounded-xl border border-amber-200 bg-white p-4"><div className="flex flex-wrap justify-between gap-3"><div><h3 className="font-extrabold">{p.shop?.name ?? 'Shop'} <span className="font-mono text-xs text-neutral-500">{p.shop?.short_code}</span></h3><p className="mt-1 text-sm">{termLabel(p.term)} · <strong>{formatPaiseExact(p.amount_paise)}</strong></p><p className="mt-1 text-xs text-neutral-500">Submitted {subscriptionDate(p.submitted_at)} · request {p.id.slice(0, 8).toUpperCase()}</p></div><div className="text-sm"><p>Reference: <strong className="break-all font-mono">{p.utr}</strong></p><p className="mt-1 break-all text-xs text-neutral-600">Recipient: {p.payee_name} · {p.upi_id}</p></div></div>
        {p.subscription?.is_permanent && <p className="mt-3 rounded-lg bg-sky-50 p-2 text-xs text-sky-900">This shop already has permanent access. A verified approval adds a timed period underneath it; resolve any payment issue with the owner as appropriate.</p>}
        <label className="mt-3 flex items-start gap-2 text-xs font-semibold text-neutral-700"><input type="checkbox" className="mt-0.5" checked={!!verified[p.id]} onChange={(event) => setVerified({ ...verified, [p.id]: event.target.checked })} />I independently checked this exact transfer in the receiving account.</label>
        <label className="mt-3 block text-xs font-semibold text-neutral-700">Review note (required for rejection)<input className="input mt-1 w-full text-sm" maxLength={500} value={notes[p.id] ?? ''} onChange={(event) => setNotes({ ...notes, [p.id]: event.target.value })} placeholder="Reason for rejecting, or optional approval note" /></label>
        <div className="mt-3 flex flex-wrap gap-2"><button disabled={!!busy || !verified[p.id]} onClick={() => review(p, 'approve')} className="btn btn-primary min-h-10 px-4 text-xs disabled:opacity-50"><CheckCircle2 size={14} />Approve verified payment</button><button disabled={!!busy} onClick={() => review(p, 'reject')} className="btn btn-ghost min-h-10 px-4 text-xs text-red-700">Reject report</button></div>
      </article>)}{!data.pending.length && <p className="rounded-xl bg-white p-4 text-sm text-neutral-500">No payment reports awaiting review.</p>}</div>
      <Pager page={data.pagination.pendingPage} pages={data.pagination.pendingPages} setPage={setPendingPage} />
    </section>

    <section className="card p-5"><h2 className="flex items-center gap-2 text-lg font-extrabold"><ShieldCheck size={19} className="text-indigo-600" />Shop access</h2><p className="mt-1 text-xs text-neutral-500">Permanent access is free and can be granted for family or testing without a purchase. Revoking it restores any remaining underlying period.</p>
      <form className="mt-3 flex gap-2" onSubmit={(event) => { event.preventDefault(); setPage(1); setSearch(searchInput.trim()); }}><label className="sr-only" htmlFor="subscription-shop-search">Search shop name</label><input id="subscription-shop-search" className="input min-w-0 flex-1 text-sm" placeholder="Search shop name" value={searchInput} onChange={(event) => setSearchInput(event.target.value)} /><button className="btn btn-ghost min-h-10 px-3 text-xs"><Search size={14} />Search</button></form>
      <div className="mt-3 divide-y divide-neutral-100">{data.shops.map((shop) => {
        const state = subscriptionState(shop.subscription, data.plan.warning_days);
        return <div key={shop.id} className="flex flex-wrap items-center justify-between gap-3 py-3"><div className="min-w-0"><Link href={`/admin/shops/${shop.id}`} className="break-words text-sm font-extrabold text-indigo-700 hover:underline">{shop.name}</Link> <span className="font-mono text-xs text-neutral-400">{shop.short_code}</span><p className="mt-1 text-xs text-neutral-600"><strong>{stateText[state.status]}</strong> · {state.status === 'permanent' ? 'Permanent free subscription' : termLabel(shop.subscription?.term)}{shop.subscription?.expires_at && state.status !== 'permanent' ? ` · ends ${subscriptionDate(shop.subscription.expires_at)}` : ''}</p>{state.status === 'permanent' && shop.subscription?.expires_at && <p className="mt-1 text-xs text-neutral-500">Underlying period ends {subscriptionDate(shop.subscription.expires_at)}</p>}</div><button disabled={!!busy} onClick={() => setPermanent(shop, !shop.subscription?.is_permanent)} className="btn btn-ghost min-h-10 px-3 text-xs">{shop.subscription?.is_permanent ? 'Revoke permanent' : 'Grant permanent'}</button></div>;
      })}{!data.shops.length && <p className="py-4 text-sm text-neutral-500">No shops found.</p>}</div>
      <Pager page={data.pagination.page} pages={data.pagination.pages} setPage={setPage} />
    </section>

    <section className="card p-5"><h2 className="text-lg font-extrabold">Recent decisions</h2><p className="mt-1 text-xs text-neutral-500">The latest 20 approved or rejected subscription payment reports.</p><div className="mt-3 divide-y divide-neutral-100">{data.history.map((p) => <div key={p.id} className="flex flex-wrap justify-between gap-2 py-3 text-sm"><div><strong>{p.shop?.name ?? 'Shop'} · {termLabel(p.term)} · {formatPaiseExact(p.amount_paise)}</strong><p className="mt-1 text-xs text-neutral-500">{p.status === 'approved' ? 'Approved' : 'Rejected'} {subscriptionDate(p.reviewed_at)} · {p.utr}</p>{p.review_note && <p className="mt-1 text-xs text-neutral-600">{p.review_note}</p>}</div>{p.status === 'approved' && <p className="text-xs text-green-700">{subscriptionDate(p.period_start)} → {subscriptionDate(p.period_end)}</p>}</div>)}{!data.history.length && <p className="py-4 text-sm text-neutral-500">No decisions yet.</p>}</div></section>
  </div>;
}
