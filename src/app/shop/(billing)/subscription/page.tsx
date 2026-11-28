'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import QRCode from 'qrcode';
import { AlertTriangle, ArrowRight, CheckCircle2, Clock3, CreditCard, Loader2, RefreshCw, ShieldCheck, Sparkles, TicketPercent } from 'lucide-react';
import { OfferBanners } from '@/components/subscription/OfferBanners';
import { SavingsBreakdown } from '@/components/subscription/SavingsBreakdown';
import { formatPaiseExact } from '@/lib/format';
import { buildUpiIntent } from '@/lib/upi';
import { planSavings, subscriptionQuoteSchema, termMonths, type SubscriptionQuote, type VisibleAnnouncement } from '@/lib/subscription-offers';
import { clearSubscriptionRequestKey, ensureSubscriptionRequestKey, readSubscriptionRequestKey } from '@/lib/subscription-request-client';
import { SUBSCRIPTION_TERMS, subscriptionDate, termLabel, type ShopSubscription, type SubscriptionPlan, type SubscriptionPurchase, type SubscriptionTerm } from '@/lib/subscription';
import { useSubscriptionState } from '@/lib/use-subscription-state';
import styles from '../billing-pages.module.css';

type Data = { shop: { id: string; name: string; short_code: string }; is_owner: boolean; subscription: ShopSubscription | null; plan: SubscriptionPlan; purchases: SubscriptionPurchase[]; announcements?: VisibleAnnouncement[]; offers_unavailable?: boolean };
const statusText = { active: 'Active', expiring: 'Expiring soon', expired: 'Expired', not_subscribed: 'Not subscribed', permanent: 'Permanent access' };
const purchaseText = { initiated: 'Payment not reported', submitted: 'Awaiting verification', approved: 'Approved', rejected: 'Not approved', cancelled: 'Cancelled' };

function PaymentQr({ purchase, shopCode }: { purchase: SubscriptionPurchase; shopCode: string }) {
  const [qr, setQr] = useState('');
  const isolatedTest = process.env.NEXT_PUBLIC_PRINTLY_ISOLATED_TEST === '1';
  const intent = !isolatedTest && purchase.upi_id && purchase.payee_name && purchase.amount_paise > 0
    ? buildUpiIntent({ upiId: purchase.upi_id, payeeName: purchase.payee_name, amountPaise: purchase.amount_paise, note: `Printly ${shopCode} ${purchase.id.slice(0, 8)}` }) : null;
  useEffect(() => {
    let alive = true;
    if (intent) QRCode.toDataURL(intent.link, { width: 280, margin: 3, errorCorrectionLevel: 'M' }).then((url) => { if (alive) setQr(url); }).catch(() => { if (alive) setQr(''); });
    return () => { alive = false; };
  }, [intent?.link]);
  if (isolatedTest) return <p role="status" className="rounded-xl bg-white p-4 text-sm font-bold text-amber-950">SIMULATED PAYMENT ONLY. Do not send money. Payment QR and UPI app links are disabled on this test site.</p>;
  if (!intent) return <p className="rounded-xl bg-white p-4 text-sm text-red-800">Payment details are unavailable. Do not pay; contact Printly for help.</p>;
  return <div className="flex flex-col items-center gap-2 rounded-xl bg-white p-3 text-center">
    {qr ? <img src={qr} alt="UPI payment QR code" width={240} height={240} className="h-48 w-48 sm:h-60 sm:w-60" /> : <p className="py-4 text-xs text-neutral-500">Use the UPI ID or app link below.</p>}
    <a href={intent.link} className="btn btn-dark min-h-11 w-full px-4 text-sm">Open UPI app</a>
  </div>;
}

export default function ShopSubscriptionPage() {
  const isolatedTest = process.env.NEXT_PUBLIC_PRINTLY_ISOLATED_TEST === '1';
  const router = useRouter();
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [reference, setReference] = useState('');
  const [selected, setSelected] = useState<SubscriptionTerm | null>(null);
  const [code, setCode] = useState('');
  const [quote, setQuote] = useState<SubscriptionQuote | null>(null);
  const [needsRefresh, setNeedsRefresh] = useState(false);
  const reviewRef = useRef<HTMLElement | null>(null);
  const loadSequence = useRef(0);
  const state = useSubscriptionState(data?.subscription, data?.plan.warning_days ?? 7);
  const load = useCallback(async () => {
    const sequence = ++loadSequence.current;
    try {
      const res = await fetch('/api/shop/subscription', { cache: 'no-store' });
      const body = await res.json().catch(() => ({}));
      if (sequence !== loadSequence.current) return;
      if (!res.ok) throw new Error(body?.error?.message ?? 'Could not load subscription details.');
      const next = body as Data;
      setData(next); setError(''); setNeedsRefresh(false);
      const key = readSubscriptionRequestKey(next.shop.id);
      const recovered = key && next.purchases.find((purchase) => purchase.request_key === key);
      if (key && recovered) {
        clearSubscriptionRequestKey(next.shop.id, key);
        setSelected(null); setQuote(null);
        setNotice(recovered.amount_paise === 0 && recovered.status === 'approved'
          ? `Recovered your earlier request: ${termLabel(recovered.term)} access was activated for free. Check the period in your history.`
          : 'Recovered your earlier subscription request. Check its status below before taking any further action.');
      }
    } catch (err) { if (sequence === loadSequence.current) setError(err instanceof Error ? err.message : 'Could not load subscription details.'); }
  }, []);
  useEffect(() => {
    if (!selected) return;
    const target = reviewRef.current;
    if (!target) return;
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    target.scrollIntoView?.({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
    target.focus({ preventScroll: true });
  }, [selected]);
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

  const getQuote = async (term: SubscriptionTerm, enteredCode: string) => {
    if (busy) return;
    const normalized = enteredCode.trim().toUpperCase();
    setSelected(term); setQuote(null); setError(''); setNotice('');
    if (normalized && !/^[A-Z0-9][A-Z0-9_-]{2,31}$/.test(normalized)) {
      setError('Promo codes must be 3–32 letters, numbers, hyphens or underscores.'); return;
    }
    setBusy(true);
    try {
      const res = await fetch('/api/shop/subscription', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'quote', term, code: normalized || null }) });
      const result = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(result?.error?.message ?? 'Could not check the price.');
      const parsed = subscriptionQuoteSchema.safeParse(result.result);
      if (!parsed.success || parsed.data.term !== term || parsed.data.promo_code !== (normalized || null)) throw new Error('Could not confirm this quote. Please try again.');
      setCode(normalized); setQuote(parsed.data);
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not check the price. Please try again.'); }
    finally { setBusy(false); }
  };

  const start = async () => {
    if (!data || !quote || !selected || busy || needsRefresh) return;
    let requestKey: string;
    try { requestKey = ensureSubscriptionRequestKey(data.shop.id); }
    catch { setError('Enable essential browser storage to start a subscription safely, then try again.'); return; }
    setBusy(true); setError(''); setNotice('');
    try {
      const res = await fetch('/api/shop/subscription', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'start', term: selected, code: quote.promo_code, request_key: requestKey, expected_quote: quote }) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (['quote_changed', 'promo_unavailable', 'promo_term', 'promo_limit', 'promo_too_small'].includes(body?.error?.code)) setQuote(null);
        throw new Error(body?.error?.message ?? 'Could not confirm the request. Refresh its status before retrying.');
      }
      const result = body?.result;
      const purchase = result?.purchase as SubscriptionPurchase | undefined;
      if (!purchase || typeof purchase.id !== 'string' || !['monthly', 'six_months', 'yearly'].includes(purchase.term) ||
        !['initiated', 'submitted', 'approved', 'rejected', 'cancelled'].includes(purchase.status) || !Number.isSafeInteger(purchase.amount_paise)) {
        throw new Error('Could not confirm the request. Refresh its status before retrying.');
      }
      clearSubscriptionRequestKey(data.shop.id, requestKey);
      setNeedsRefresh(true); setSelected(null); setQuote(null); setCode('');
      setNotice(result.different_selection
        ? `An earlier request was recovered for ${termLabel(purchase.term)}. Check its status below before starting another.`
        : purchase.amount_paise === 0 && purchase.status === 'approved'
          ? `${termLabel(purchase.term)} access activated for free. Your new period is shown below.`
          : result.existing ? 'Your existing request is shown below. Check its status before taking any further action.'
            : isolatedTest ? 'Test request created. Do not send a real payment.' : 'Request created. Review the recipient and exact amount before paying.');
      await load(); router.refresh();
    } catch (err) {
      // Keep the same key on an uncertain outcome. Refreshing or retrying can
      // recover the original result without granting a second free term.
      const message = err instanceof Error ? err.message : 'Connection interrupted.';
      setError(`${message} If the outcome is uncertain, refresh status or retry here before starting another request.`);
    } finally { setBusy(false); }
  };
  if (!data) return <div className="card p-8 text-center">{error ? <><p role="alert" className="text-sm text-red-700">{error}</p><button onClick={() => void load()} className="btn btn-ghost mt-4 min-h-10 px-4">Try again</button></> : <Loader2 className="mx-auto animate-spin text-orange-600" />}</div>;

  const open = data.purchases.find((p) => p.status === 'initiated' || p.status === 'submitted');
  const readyToPay = !!data.plan.upi_id && !!data.plan.payee_name;
  const priceFor = (term: SubscriptionTerm) => term === 'monthly' ? data.plan.monthly_paise : term === 'six_months' ? data.plan.six_months_paise : data.plan.yearly_paise;

  return <div className="mx-auto max-w-6xl space-y-6 pb-10">
    <div className={styles.hero}>
      <div><p className="text-xs font-bold uppercase tracking-[0.18em] text-orange-700">Printly for shops</p><h1 className="mt-1 text-3xl font-extrabold tracking-tight">Your subscription</h1><p className="mt-1 text-sm text-neutral-600">One plan. All your tools. More ways to save.</p></div>
      <button onClick={() => { void load(); router.refresh(); }} className="btn btn-ghost min-h-10 px-3 text-xs"><RefreshCw size={14} />Refresh status</button>
    </div>
    {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</div>}
    {notice && <div role="status" className="rounded-xl border border-green-200 bg-green-50 p-3 text-sm text-green-800">{notice}</div>}

    <section className={styles.access}>
      <div className="relative flex flex-wrap items-start justify-between gap-5 overflow-hidden p-5 sm:p-7">
        <div aria-hidden="true" className="pointer-events-none absolute -right-8 -top-24 h-52 w-52 rounded-full bg-orange-400/20 blur-3xl" />
        <div className="relative"><p className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.16em] text-orange-200"><ShieldCheck size={17} />Your Printly access</p>
          <div className="mt-3 flex flex-wrap items-center gap-2"><h2 className="text-xl font-extrabold">{state.status === 'permanent' ? 'Permanent free subscription' : termLabel(data.subscription?.term)}</h2><span className={`chip ${state.active ? 'bg-emerald-100 text-emerald-900' : 'bg-orange-100 text-orange-900'}`}>{statusText[state.status]}</span></div>
          <p className="mt-2 text-sm text-neutral-300">{data.subscription?.expires_at && state.status !== 'permanent' ? <>Access ends {subscriptionDate(data.subscription.expires_at)}</> : state.status === 'permanent' ? 'No renewal required.' : 'Choose a term below to get started.'}</p>
          {state.status === 'permanent' && data.subscription?.expires_at && <p className="mt-1 text-xs text-neutral-400">If permanent access is removed, any remaining paid or transition period ends {subscriptionDate(data.subscription.expires_at)}.</p>}
        </div>
        {state.active && <Link href="/shop" className="relative inline-flex min-h-10 items-center gap-2 rounded-xl bg-white/10 px-4 text-xs font-bold text-white hover:bg-white/20">Open dashboard <ArrowRight size={14} /></Link>}
      </div>
      {!state.active && <div className="flex items-start gap-2 bg-amber-100 p-4 text-sm text-amber-950"><AlertTriangle size={18} className="mt-0.5 shrink-0" /><div><strong>Dashboard and new customer orders are paused.</strong> Paid renewals activate after verification; an eligible fully discounted term activates immediately. You can still <Link href="/shop/recovery" className="font-bold underline">handle open orders and payment issues</Link>.</div></div>}
      {state.status === 'expiring' && <div className="bg-amber-100 p-4 text-sm text-amber-950"><strong>Expires in {state.daysRemaining} {state.daysRemaining === 1 ? 'day' : 'days'}.</strong> Renew early; a new term is added after your current access ends.</div>}
    </section>

    <OfferBanners announcements={data.announcements ?? []} />
    {data.offers_unavailable && <p className="text-xs text-neutral-500">Offers and updates are temporarily unavailable. You can still review subscription terms.</p>}
    {!data.is_owner && <div className="rounded-xl border border-sky-200 bg-sky-50 p-4 text-sm text-sky-900">Only the shop owner can start a subscription or submit a payment reference. Please ask the owner to renew.</div>}
    {open && <section className="rounded-2xl border-2 border-orange-300 bg-orange-50 p-5">
      <h2 className="flex items-center gap-2 text-lg font-extrabold"><CreditCard size={20} />{open.status === 'initiated' ? isolatedTest ? 'Simulate a payment' : 'Complete your UPI payment' : 'Payment report submitted'}</h2>
      <p className="mt-1 text-sm text-neutral-700">{termLabel(open.term)} · <strong>{formatPaiseExact(open.amount_paise)}</strong> · Request {open.id.slice(0, 8).toUpperCase()}</p>
      {open.promo_code && <p className="mt-1 text-xs font-semibold text-orange-800">Promo {open.promo_code} · {formatPaiseExact(open.discount_paise ?? 0)} off the term price</p>}
      {open.status === 'initiated' ? <div className="mt-4 grid gap-4 md:grid-cols-[240px_1fr]">
        {state.status === 'permanent' ? <div className="rounded-xl bg-white p-4 text-sm font-semibold text-green-800">Permanent access is now enabled. Do not pay for this request.</div> : data.is_owner ? <PaymentQr purchase={open} shopCode={data.shop.short_code} /> : <div className="rounded-xl bg-white p-4 text-sm text-neutral-700">The shop owner can complete this request.</div>}
        <div className="min-w-0 space-y-3 text-sm">
          {isolatedTest ? <p className="font-bold text-amber-950">Test request only. Use a synthetic reference; do not send money.</p> : <>
            {state.status === 'permanent' ? <p>If you already paid before permanent access was granted, submit the reference below so Printly can review it. Otherwise cancel this unpaid request.</p> : data.is_owner ? <p>Pay <strong>{formatPaiseExact(open.amount_paise)}</strong> to the Printly UPI recipient below. Check the payee in your UPI app before sending.</p> : <p>Ask the shop owner to complete this request and submit the payment reference.</p>}
            <div className="rounded-xl bg-white p-3"><div className="text-xs text-neutral-500">Recipient</div><div className="break-all font-bold">{open.payee_name} · {open.upi_id}</div></div>
            <p className="text-xs leading-relaxed text-amber-950"><strong>Already paid?</strong> Do not pay again or cancel. Enter the transaction reference from your UPI app below. Submitting a reference does not activate access; Printly must verify the transfer independently.</p>
          </>}
          <form onSubmit={(event) => { event.preventDefault(); void act({ action: 'submit', purchase_id: open.id, utr: reference }, 'Payment report submitted. Your subscription will activate only after Printly verifies and approves it.'); }}>
            <label htmlFor="subscription-reference" className="label">{isolatedTest ? 'Synthetic test reference' : 'UPI transaction reference / UTR'}</label>
            <input id="subscription-reference" className="input mt-1 w-full font-mono" required minLength={6} maxLength={40} value={reference} onChange={(event) => setReference(event.target.value)} placeholder={isolatedTest ? 'e.g. TEST123456' : 'Reference from your UPI app'} disabled={!data.is_owner || busy} />
            <div className="mt-3 flex flex-wrap gap-2"><button disabled={!data.is_owner || busy} className="btn btn-primary min-h-11 px-4">{busy ? <Loader2 size={16} className="animate-spin" /> : 'Submit payment reference'}</button>
              <button type="button" disabled={!data.is_owner || busy} className="btn btn-ghost min-h-11 px-4 text-xs" onClick={() => { if (window.confirm('Cancel this request only if you have NOT sent a payment. If you already paid, submit the reference or contact Printly instead. Cancel?')) void act({ action: 'cancel', purchase_id: open.id }, 'Unpaid request cancelled.'); }}>Cancel unpaid request</button></div>
          </form>
        </div>
      </div> : <div className="mt-4 rounded-xl bg-white p-4 text-sm"><p className="flex items-center gap-2 font-bold text-amber-800"><Clock3 size={16} />Awaiting independent verification</p><p className="mt-2">Reference: <strong className="break-all font-mono">{open.utr}</strong></p><p className="mt-2 text-xs text-neutral-600">{isolatedTest ? 'Test report only. No payment should have been sent.' : 'Please do not pay again. Printly will compare the reference, amount and recipient with the actual transfer before activating the term. Refresh this page to check for a decision.'}</p></div>}
    </section>}

    <section>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-2"><div><p className="text-xs font-bold uppercase tracking-[0.16em] text-orange-700">Made for your shop</p><h2 className="mt-1 text-xl font-extrabold tracking-tight">Choose your term</h2><p className="mt-1 text-xs text-neutral-500">The same features in every term. No automatic recurring billing.</p></div><span className="flex items-center gap-1.5 text-xs font-semibold text-neutral-500"><CheckCircle2 size={14} className="text-emerald-600" />All features included</span></div>
      <div className="grid gap-3 md:grid-cols-3">{SUBSCRIPTION_TERMS.map((term) => {
        const amount = priceFor(term.value);
        const difference = planSavings(data.plan.monthly_paise, term.value, amount)?.termDifference;
        return <div key={term.value} className={`flex flex-col rounded-2xl border p-5 shadow-sm ${styles.term} ${selected === term.value ? 'border-orange-500 bg-orange-50/60 ring-1 ring-orange-500' : 'border-neutral-200 bg-white'}`}>
          <div className="flex items-start justify-between gap-2"><div><h3 className="font-extrabold">{term.label}</h3><p className="mt-1 text-xs text-neutral-500">{term.duration} of full access</p></div>{difference != null && difference > 0 && term.value !== 'monthly' && <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[0.65rem] font-extrabold text-emerald-700">SAVE {formatPaiseExact(difference)}</span>}</div>
          <p className="mt-6 text-3xl font-extrabold tracking-tight">{amount == null ? 'Not configured' : formatPaiseExact(amount)}</p><p className="mt-1 text-xs text-neutral-500">one-time base price</p>
          {term.value !== 'monthly' && difference != null && <p className="mt-3 min-h-8 text-xs leading-5 text-neutral-600">{difference > 0 ? `Save ${formatPaiseExact(difference)}` : difference < 0 ? `${formatPaiseExact(-difference)} more` : 'Same price'} compared with {termMonths(term.value)} monthly terms.</p>}
          <div className="mt-auto pt-5"><button disabled={!data.is_owner || busy || needsRefresh || !!open || state.status === 'permanent' || amount == null} onClick={() => void getQuote(term.value, code)}
            className={`btn min-h-11 w-full px-3 text-sm disabled:cursor-not-allowed disabled:opacity-50 ${selected === term.value ? 'btn-primary' : 'btn-ghost'}`}>{selected === term.value ? 'Selected' : state.active ? `Renew ${term.label.toLowerCase()}` : `Choose ${term.label.toLowerCase()}`}</button></div>
        </div>;
      })}</div>
      {!readyToPay && <p className="mt-3 text-xs text-amber-800">Subscription payments are not configured yet. A fully discounted eligible term can still activate without payment.</p>}
      {open && <p className="mt-3 text-xs text-neutral-500">Finish the current request above before choosing another term. Its price and recipient cannot be changed.</p>}
      {state.status === 'permanent' && <p className="mt-3 text-xs text-neutral-500">Your permanent access does not require payment.</p>}
      {needsRefresh && <p className="mt-3 text-xs text-amber-800">Refresh your subscription status before starting another request.</p>}
    </section>

    {selected && !open && state.status !== 'permanent' && <section ref={reviewRef} tabIndex={-1} aria-label="Review your subscription" className="grid scroll-mt-5 overflow-hidden rounded-[1.5rem] border border-orange-200 bg-white shadow-[0_8px_30px_rgba(40,25,15,0.05)] lg:grid-cols-[1fr_0.85fr]">
      <div className="p-5 sm:p-7"><p className="flex items-center gap-1.5 text-xs font-extrabold uppercase tracking-[0.16em] text-orange-700"><Sparkles size={14} />Make it yours</p><h2 className="mt-2 text-xl font-extrabold">Review your {termLabel(selected).toLowerCase()} term</h2><p className="mt-1 text-sm leading-6 text-neutral-600">Have a code? Apply it here. We’ll check eligibility and show the amount before you continue.</p>
        <form className="mt-5" onSubmit={(event) => { event.preventDefault(); void getQuote(selected, code); }}><label htmlFor="subscription-promo" className="label">Promo code</label><div className="flex flex-wrap gap-2"><div className="relative min-w-[12rem] flex-1"><TicketPercent size={17} className="pointer-events-none absolute left-3 top-3 text-neutral-400" /><input id="subscription-promo" className="input w-full font-mono uppercase" style={{ paddingLeft: '2.5rem' }} value={code} maxLength={32} autoComplete="off" disabled={busy} onChange={(event) => { setCode(event.target.value); setQuote(null); }} placeholder="Enter code" /></div><button disabled={busy} className="btn btn-dark min-h-11 px-5 text-sm">{code.trim() ? 'Apply code' : 'Refresh quote'}</button></div></form>
        {quote?.promo_code && <p className="mt-3 flex items-center gap-1.5 text-xs font-bold text-emerald-700"><CheckCircle2 size={14} />{quote.promo_code} applied to this term</p>}
        {!quote && <p className="mt-3 text-xs text-neutral-500">Apply the code or refresh the quote to review your current total.</p>}
      </div>
      <div className="border-t border-orange-100 bg-[#fffaf4] p-5 sm:p-7 lg:border-l lg:border-t-0">
        <h3 className="text-sm font-extrabold uppercase tracking-wider text-neutral-700">Your price breakdown</h3>
        {quote ? <><div className="mt-4 flex justify-between gap-4 text-sm"><span className="text-neutral-600">Term base price</span><strong>{formatPaiseExact(quote.base_paise)}</strong></div>
          <div className="my-4"><SavingsBreakdown base={quote.base_paise} reference={quote.monthly_reference_paise} discount={quote.discount_paise} /></div>
          <div className="flex items-end justify-between gap-4 border-t border-orange-200 pt-4"><span className="text-sm font-bold">You pay</span><strong className="text-2xl font-extrabold">{formatPaiseExact(quote.amount_paise)}</strong></div>
          <p className="mt-3 text-xs leading-5 text-neutral-600">{isolatedTest ? 'Test request only. Do not make a real payment.' : quote.amount_paise === 0 ? 'No UPI payment or manual approval needed. Confirming immediately adds this term.' : 'A one-time UPI payment and independent Printly verification are required before this term activates.'}</p>
          <button onClick={() => void start()} disabled={busy || needsRefresh || (quote.amount_paise > 0 && !readyToPay)} className="btn btn-primary mt-4 min-h-11 w-full px-4 text-sm">{busy ? <Loader2 size={16} className="animate-spin" /> : quote.amount_paise === 0 ? 'Activate for free' : isolatedTest ? 'Continue to simulated payment' : 'Continue to UPI payment'} <ArrowRight size={16} /></button>
        </> : <p className="mt-4 text-sm text-neutral-500">Your current quote will appear here.</p>}
      </div>
    </section>}

    <section className="card p-5 sm:p-6"><h2 className="text-lg font-extrabold">Subscription history</h2><p className="mt-1 text-xs text-neutral-500">Most recent 50 requests. Savings use the prices recorded when each request was created.</p>
      <div className="mt-3 divide-y divide-neutral-100">{data.purchases.map((p) => <div key={p.id} className="flex flex-wrap justify-between gap-3 py-4 text-sm"><div><strong>{termLabel(p.term)} · {formatPaiseExact(p.amount_paise)}</strong><p className="mt-1 text-xs text-neutral-500">{subscriptionDate(p.created_at)} · {p.amount_paise === 0 && p.status === 'approved' ? 'Activated with promo' : purchaseText[p.status]}{p.utr ? ` · ${p.utr}` : ''}{p.promo_code ? ` · Code ${p.promo_code}` : ''}</p><SavingsBreakdown base={p.base_amount_paise} reference={p.monthly_reference_paise} discount={p.discount_paise} compact />{p.status === 'approved' && <p className="mt-1 text-xs text-green-700">Added: {subscriptionDate(p.period_start)} to {subscriptionDate(p.period_end)}</p>}{p.status === 'rejected' && p.review_note && <p className="mt-1 text-xs text-red-700">Printly: {p.review_note}</p>}</div><span className="font-mono text-xs text-neutral-400">{p.id.slice(0, 8).toUpperCase()}</span></div>)}{!data.purchases.length && <p className="py-4 text-sm text-neutral-500">No subscription requests yet.</p>}</div>
    </section>
  </div>;
}
