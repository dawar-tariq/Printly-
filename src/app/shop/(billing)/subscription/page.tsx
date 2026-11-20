'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import QRCode from 'qrcode';
import { AlertTriangle, CheckCircle2, Clock3, CreditCard, Loader2, RefreshCw, ShieldCheck } from 'lucide-react';
import { formatPaiseExact } from '@/lib/format';
import { buildUpiIntent } from '@/lib/upi';
import { SUBSCRIPTION_TERMS, subscriptionDate, termLabel, type ShopSubscription, type SubscriptionPlan, type SubscriptionPurchase, type SubscriptionTerm } from '@/lib/subscription';
import { useSubscriptionState } from '@/lib/use-subscription-state';

type Data = { shop: { id: string; name: string; short_code: string }; is_owner: boolean; subscription: ShopSubscription | null; plan: SubscriptionPlan; purchases: SubscriptionPurchase[] };
const statusText = { active: 'Active', expiring: 'Expiring soon', expired: 'Expired', not_subscribed: 'Not subscribed', permanent: 'Permanent access' };
const purchaseText = { initiated: 'Payment not reported', submitted: 'Awaiting verification', approved: 'Approved', rejected: 'Not approved', cancelled: 'Cancelled' };

function PaymentQr({ purchase, shopCode }: { purchase: SubscriptionPurchase; shopCode: string }) {
  const [qr, setQr] = useState('');
  const intent = buildUpiIntent({ upiId: purchase.upi_id, payeeName: purchase.payee_name, amountPaise: purchase.amount_paise, note: `Printly ${shopCode} ${purchase.id.slice(0, 8)}` });
  useEffect(() => {
    let alive = true;
    QRCode.toDataURL(intent.link, { width: 280, margin: 3, errorCorrectionLevel: 'M' }).then((url) => { if (alive) setQr(url); }).catch(() => { if (alive) setQr(''); });
    return () => { alive = false; };
  }, [intent.link]);
  return <div className="flex flex-col items-center gap-2 rounded-xl bg-white p-3 text-center">
    {qr ? <img src={qr} alt="UPI payment QR code" width={240} height={240} className="h-48 w-48 sm:h-60 sm:w-60" /> : <p className="py-4 text-xs text-neutral-500">Use the UPI ID or app link below.</p>}
    <a href={intent.link} className="btn btn-dark min-h-11 w-full px-4 text-sm">Open UPI app</a>
  </div>;
}

export default function ShopSubscriptionPage() {
  const router = useRouter();
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [reference, setReference] = useState('');
  const loadSequence = useRef(0);
  const state = useSubscriptionState(data?.subscription, data?.plan.warning_days ?? 7);
  const load = useCallback(async () => {
    const sequence = ++loadSequence.current;
    try {
      const res = await fetch('/api/shop/subscription', { cache: 'no-store' });
      const body = await res.json().catch(() => ({}));
      if (sequence !== loadSequence.current) return;
      if (!res.ok) throw new Error(body?.error?.message ?? 'Could not load subscription details.');
      setData(body as Data); setError('');
    } catch (err) { if (sequence === loadSequence.current) setError(err instanceof Error ? err.message : 'Could not load subscription details.'); }
  }, []);
  useEffect(() => {
    void load();
    // Keep payment instructions and approval status current in an open tab.
    const refreshIfVisible = () => { if (document.visibilityState === 'visible') void load(); };
    const timer = window.setInterval(refreshIfVisible, 60_000);
    document.addEventListener('visibilitychange', refreshIfVisible);
    return () => { ++loadSequence.current; window.clearInterval(timer); document.removeEventListener('visibilitychange', refreshIfVisible); };
  }, [load]);

  const act = async (body: Record<string, unknown>, success: string) => {
    if (busy) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const res = await fetch('/api/shop/subscription', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const result = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(result?.error?.message ?? 'Could not update the request.');
      setNotice(success); setReference('');
      await load(); router.refresh();
    } catch (err) { setError(err instanceof Error ? err.message : 'Connection interrupted. Refresh your request before trying again.'); }
    finally { setBusy(false); }
  };
  if (!data) return <div className="card p-8 text-center">{error ? <><p role="alert" className="text-sm text-red-700">{error}</p><button onClick={() => void load()} className="btn btn-ghost mt-4 min-h-10 px-4">Try again</button></> : <Loader2 className="mx-auto animate-spin text-orange-600" />}</div>;

  const open = data.purchases.find((p) => p.status === 'initiated' || p.status === 'submitted');
  const readyToPay = !!data.plan.upi_id && !!data.plan.payee_name;
  const priceFor = (term: SubscriptionTerm) => term === 'monthly' ? data.plan.monthly_paise : term === 'six_months' ? data.plan.six_months_paise : data.plan.yearly_paise;

  return <div className="space-y-5 pb-10">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><p className="text-xs font-bold uppercase tracking-widest text-orange-700">Printly for shops</p><h1 className="mt-1 text-2xl font-extrabold">Subscription</h1><p className="mt-1 text-sm text-neutral-600">One plan. Every Printly feature, for the term you choose.</p></div>
      <button onClick={() => { void load(); router.refresh(); }} className="btn btn-ghost min-h-10 px-3 text-xs"><RefreshCw size={14} />Refresh status</button>
    </div>
    {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</div>}
    {notice && <div role="status" className="rounded-xl border border-green-200 bg-green-50 p-3 text-sm text-green-800">{notice}</div>}

    <section className="card overflow-hidden">
      <div className="flex flex-wrap items-start justify-between gap-4 p-5">
        <div><div className="flex flex-wrap items-center gap-2"><ShieldCheck className="text-orange-700" size={20} /><h2 className="text-lg font-extrabold">Current access</h2><span className={`chip ${state.active ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>{statusText[state.status]}</span></div>
          <p className="mt-2 text-sm text-neutral-700"><strong>{state.status === 'permanent' ? 'Permanent free subscription' : termLabel(data.subscription?.term)}</strong>{data.subscription?.expires_at && state.status !== 'permanent' ? <> · ends {subscriptionDate(data.subscription.expires_at)}</> : null}</p>
          {state.status === 'permanent' && data.subscription?.expires_at && <p className="mt-1 text-xs text-neutral-500">If permanent access is removed, any remaining paid or transition period ends {subscriptionDate(data.subscription.expires_at)}.</p>}
        </div>
        {state.active && <Link href="/shop" className="btn btn-ghost min-h-10 px-4 text-xs">Open dashboard</Link>}
      </div>
      {!state.active && <div className="flex items-start gap-2 border-t border-amber-200 bg-amber-50 p-4 text-sm text-amber-950"><AlertTriangle size={18} className="mt-0.5 shrink-0" /><div><strong>Dashboard and new customer orders are paused.</strong> Renew to restore access after payment is verified. You can still <Link href="/shop/recovery" className="font-bold underline">handle open orders and payment issues</Link>.</div></div>}
      {state.status === 'expiring' && <div className="border-t border-amber-200 bg-amber-50 p-4 text-sm text-amber-950"><strong>Expires in {state.daysRemaining} {state.daysRemaining === 1 ? 'day' : 'days'}.</strong> Renew early; approved time is added after your current access ends.</div>}
    </section>

    {!data.is_owner && <div className="rounded-xl border border-sky-200 bg-sky-50 p-4 text-sm text-sky-900">Only the shop owner can start a subscription or submit a payment reference. Please ask the owner to renew.</div>}
    {open && <section className="rounded-2xl border-2 border-orange-300 bg-orange-50 p-5">
      <h2 className="flex items-center gap-2 text-lg font-extrabold"><CreditCard size={20} />{open.status === 'initiated' ? 'Complete your UPI payment' : 'Payment report submitted'}</h2>
      <p className="mt-1 text-sm text-neutral-700">{termLabel(open.term)} · <strong>{formatPaiseExact(open.amount_paise)}</strong> · Request {open.id.slice(0, 8).toUpperCase()}</p>
      {open.status === 'initiated' ? <div className="mt-4 grid gap-4 md:grid-cols-[240px_1fr]">
        {state.status === 'permanent' ? <div className="rounded-xl bg-white p-4 text-sm font-semibold text-green-800">Permanent access is now enabled. Do not pay for this request.</div> : data.is_owner ? <PaymentQr purchase={open} shopCode={data.shop.short_code} /> : <div className="rounded-xl bg-white p-4 text-sm text-neutral-700">The shop owner can complete this request.</div>}
        <div className="min-w-0 space-y-3 text-sm">
          {state.status === 'permanent' ? <p>If you already paid before permanent access was granted, submit the reference below so Printly can review it. Otherwise cancel this unpaid request.</p> : data.is_owner ? <p>Pay <strong>{formatPaiseExact(open.amount_paise)}</strong> to the Printly UPI recipient below. Check the payee in your UPI app before sending.</p> : <p>Ask the shop owner to complete this request and submit the payment reference.</p>}
          <div className="rounded-xl bg-white p-3"><div className="text-xs text-neutral-500">Recipient</div><div className="break-all font-bold">{open.payee_name} · {open.upi_id}</div></div>
          <p className="text-xs leading-relaxed text-amber-950"><strong>Already paid?</strong> Do not pay again or cancel. Enter the transaction reference from your UPI app below. Submitting a reference does not activate access; Printly must verify the transfer independently.</p>
          <form onSubmit={(event) => { event.preventDefault(); void act({ action: 'submit', purchase_id: open.id, utr: reference }, 'Payment report submitted. Your subscription will activate only after Printly verifies and approves it.'); }}>
            <label htmlFor="subscription-reference" className="label">UPI transaction reference / UTR</label>
            <input id="subscription-reference" className="input mt-1 w-full font-mono" required minLength={6} maxLength={40} value={reference} onChange={(event) => setReference(event.target.value)} placeholder="Reference from your UPI app" disabled={!data.is_owner || busy} />
            <div className="mt-3 flex flex-wrap gap-2"><button disabled={!data.is_owner || busy} className="btn btn-primary min-h-11 px-4">{busy ? <Loader2 size={16} className="animate-spin" /> : 'Submit payment reference'}</button>
              <button type="button" disabled={!data.is_owner || busy} className="btn btn-ghost min-h-11 px-4 text-xs" onClick={() => { if (window.confirm('Cancel this request only if you have NOT sent a payment. If you already paid, submit the reference or contact Printly instead. Cancel?')) void act({ action: 'cancel', purchase_id: open.id }, 'Unpaid request cancelled.'); }}>Cancel unpaid request</button></div>
          </form>
        </div>
      </div> : <div className="mt-4 rounded-xl bg-white p-4 text-sm"><p className="flex items-center gap-2 font-bold text-amber-800"><Clock3 size={16} />Awaiting independent verification</p><p className="mt-2">Reference: <strong className="break-all font-mono">{open.utr}</strong></p><p className="mt-2 text-xs text-neutral-600">Please do not pay again. Printly will compare the reference, amount and recipient with the actual transfer before activating the term. Refresh this page to check for a decision.</p></div>}
    </section>}

    <section>
      <div className="mb-3"><h2 className="text-lg font-extrabold">Choose your term</h2><p className="text-xs text-neutral-500">All terms include the same features. No automatic recurring billing.</p></div>
      <div className="grid gap-3 md:grid-cols-3">{SUBSCRIPTION_TERMS.map((term) => {
        const amount = priceFor(term.value);
        return <div key={term.value} className="card flex flex-col p-5"><h3 className="font-extrabold">{term.label}</h3><p className="mt-1 text-xs text-neutral-500">{term.duration} · all features</p><p className="mt-4 text-2xl font-extrabold">{amount == null ? 'Not configured' : formatPaiseExact(amount)}</p><p className="mt-1 flex items-center gap-1 text-xs text-neutral-500"><CheckCircle2 size={13} className="text-green-600" />One-time payment</p><button disabled={!data.is_owner || busy || !!open || state.status === 'permanent' || amount == null || !readyToPay} onClick={() => void act({ action: 'start', term: term.value }, 'Request created. Review the recipient and amount before paying.')}
          className="btn btn-ghost mt-5 min-h-11 w-full px-3 text-sm disabled:cursor-not-allowed disabled:opacity-50">{state.active ? `Renew ${term.label.toLowerCase()}` : `Choose ${term.label.toLowerCase()}`}</button></div>;
      })}</div>
      {!readyToPay && <p className="mt-3 text-xs text-amber-800">Subscription payments are not configured yet. Please contact Printly.</p>}
      {open && <p className="mt-3 text-xs text-neutral-500">Finish the current request above before choosing another term.</p>}
      {state.status === 'permanent' && <p className="mt-3 text-xs text-neutral-500">Your permanent access does not require payment.</p>}
    </section>

    <section className="card p-5"><h2 className="text-lg font-extrabold">Payment history</h2><p className="mt-1 text-xs text-neutral-500">Most recent 50 requests. Approved periods are added to any remaining access.</p>
      <div className="mt-3 divide-y divide-neutral-100">{data.purchases.map((p) => <div key={p.id} className="flex flex-wrap justify-between gap-3 py-3 text-sm"><div><strong>{termLabel(p.term)} · {formatPaiseExact(p.amount_paise)}</strong><p className="mt-1 text-xs text-neutral-500">{subscriptionDate(p.created_at)} · {purchaseText[p.status]}{p.utr ? ` · ${p.utr}` : ''}</p>{p.status === 'approved' && <p className="mt-1 text-xs text-green-700">Added: {subscriptionDate(p.period_start)} to {subscriptionDate(p.period_end)}</p>}{p.status === 'rejected' && p.review_note && <p className="mt-1 text-xs text-red-700">Printly: {p.review_note}</p>}</div><span className="font-mono text-xs text-neutral-400">{p.id.slice(0, 8).toUpperCase()}</span></div>)}{!data.purchases.length && <p className="py-4 text-sm text-neutral-500">No subscription payments yet.</p>}</div>
    </section>
  </div>;
}
