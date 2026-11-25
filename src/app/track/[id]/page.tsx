'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import {
  Logo } from '@/components/Logo';
import { formatPaiseExact, formatDateTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import { lowBandwidth } from '@/lib/connection';
import { subscribeTrackingUpdates } from '@/lib/track-realtime';
import { useCustomerLanguage } from '@/lib/customer-language';
import { CustomerLanguagePicker } from '@/components/CustomerLanguagePicker';
import { OrderReference } from '@/components/OrderReference';
import {
  Loader2, Printer, CheckCircle2, Package, Store, Star, AlertTriangle, Wallet, X, Hourglass,
} from 'lucide-react';

interface Track {
  order_id: string; token: string | null; status: string; payment_status: string; payment_method: string | null;
  shop_name: string; shop_slug: string; shop_city: string; total_paise: number; eta_minutes: number | null;
  item_count: number; rush: boolean; created_at: string; ready_at: string | null; collected_at: string | null;
}

const AUTO_UPDATE = {
  en: 'Updates automatically while this page is open.',
  hi: 'यह पेज खुला रहने पर अपने-आप अपडेट होगा।',
  ur: 'یہ صفحہ کھلا رہنے پر خود بخود اپ ڈیٹ ہوگا۔',
} as const;

const STEPS = [
  { key: 'queued', label: 'In queue', icon: Store },
  { key: 'printing', label: 'Printing', icon: Printer },
  { key: 'ready', label: 'Ready', icon: Package },
  { key: 'collected', label: 'Collected', icon: CheckCircle2 },
];

export default function TrackPage() {
  const { language, setLanguage, t } = useCustomerLanguage();
  const { id } = useParams<{ id: string }>();
  const [track, setTrack] = useState<Track | null | 'loading' | 'unavailable'>('loading');
  const [trackError, setTrackError] = useState(false);
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [reviewed, setReviewed] = useState(false);
  const [reviewBusy, setReviewBusy] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [reportUtr, setReportUtr] = useState('');
  const [reportBusy, setReportBusy] = useState(false);
  const [reportMessage, setReportMessage] = useState<string | null>(null);
  const [disputeOpen, setDisputeOpen] = useState(false);
  const [disputeType, setDisputeType] = useState('other');
  const [disputeText, setDisputeText] = useState('');
  const [disputeDone, setDisputeDone] = useState(false);
  const [disputeBusy, setDisputeBusy] = useState(false);
  const [disputeError, setDisputeError] = useState<string | null>(null);
  const refreshSequence = useRef(0);
  const terminal = useRef(false);

  const load = useCallback(async () => {
    const sequence = ++refreshSequence.current;
    try {
      const res = await fetch(`/api/orders/${id}/track`, { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        if (!data?.track || typeof data.track !== 'object' || typeof data.track.order_id !== 'string' ||
            data.track.order_id.toLowerCase() !== id.toLowerCase() || typeof data.track.status !== 'string') {
          throw new Error('Invalid tracking response');
        }
        if (sequence !== refreshSequence.current) return;
        terminal.current = ['collected', 'cancelled', 'failed'].includes(data.track.status);
        setTrack(data.track); setTrackError(false);
      } else if (sequence !== refreshSequence.current) return;
      else if (res.status === 404) {
        setTrack(null); setTrackError(false);
      } else {
        throw new Error('Tracking refresh failed');
      }
    } catch {
      if (sequence !== refreshSequence.current) return;
      setTrack((previous) => previous && typeof previous === 'object' ? previous : 'unavailable');
      setTrackError(true);
    }
  }, [id]);

  useEffect(() => {
    // A client-side navigation to a different tracking link must not show the
    // previous order while the new one is loading.
    setTrack('loading'); setTrackError(false); terminal.current = false;
    setRating(0); setComment(''); setReviewed(false); setReviewError(null);
    setReportUtr(''); setReportMessage(null);
    setDisputeOpen(false); setDisputeType('other'); setDisputeText(''); setDisputeDone(false); setDisputeError(null);
    // Broadcast is only a hint; the tracking API remains authoritative. Even
    // forged/bursty hints cannot cause more than one extra fetch every 3s.
    // Poll while visible so disconnected or unconfigured Realtime still works.
    const refreshIfVisible = () => { if (document.visibilityState !== 'hidden') void load(); };
    let signalAt = Date.now();
    let scheduled: number | undefined;
    const signal = () => {
      if (document.visibilityState === 'hidden' || terminal.current) return;
      const wait = Math.max(0, 3_000 - (Date.now() - signalAt));
      if (scheduled !== undefined) return;
      scheduled = window.setTimeout(() => {
        scheduled = undefined;
        if (document.visibilityState !== 'hidden' && !terminal.current) { signalAt = Date.now(); void load(); }
      }, wait);
    };
    refreshIfVisible();
    const stopRealtime = subscribeTrackingUpdates(id, signal);
    const timer = window.setInterval(() => {
      if (!terminal.current && document.visibilityState !== 'hidden') void load();
    }, lowBandwidth() ? 60_000 : 15_000);
    document.addEventListener('visibilitychange', refreshIfVisible);
    return () => {
      refreshSequence.current++; stopRealtime(); window.clearInterval(timer); window.clearTimeout(scheduled);
      document.removeEventListener('visibilitychange', refreshIfVisible);
    };
  }, [load]);

  const submitReview = async () => {
    if (rating === 0 || reviewBusy) return;
    setReviewBusy(true); setReviewError(null);
    try {
      const res = await fetch(`/api/orders/${id}/review`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rating, comment }),
      });
      if (res.ok) setReviewed(true);
      else {
        const data = await res.json().catch(() => ({}));
        if (res.status === 409 && data?.error?.code === 'already_reviewed') setReviewed(true);
        else setReviewError(data?.error?.message ?? 'Could not submit your rating. Please try again.');
      }
    } catch { setReviewError('Could not submit your rating. Please check your connection and try again.'); }
    finally { setReviewBusy(false); }
  };

  const submitDispute = async () => {
    if (disputeText.trim().length < 5 || disputeBusy) return;
    setDisputeBusy(true); setDisputeError(null);
    try {
      const res = await fetch('/api/disputes', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ order_id: id, type: disputeType, description: disputeText.trim() }),
      });
      if (res.ok) { setDisputeDone(true); setDisputeOpen(false); }
      else {
        const data = await res.json().catch(() => ({}));
        setDisputeError(data?.error?.message ?? 'Could not submit your report. Please try again.');
      }
    } catch { setDisputeError('Could not submit your report. Please check your connection and try again.'); }
    finally { setDisputeBusy(false); }
  };

  const reportPayment = async () => {
    if (reportBusy) return;
    setReportBusy(true); setReportMessage(null);
    try {
      const res = await fetch(`/api/orders/${id}/payment-submitted`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ utr: reportUtr.trim() || undefined }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setReportMessage(data?.error?.message ?? 'Could not report the payment. Please retry or contact the shop.');
      } else {
        setReportMessage('Payment reported. The shop must still verify it.');
        // A failed refresh does not mean the payment report failed.
        await load().catch(() => {});
      }
    } catch { setReportMessage('Could not report the payment. Please retry or contact the shop before paying again.'); }
    finally { setReportBusy(false); }
  };

  if (track === 'loading') {
    return <div className="min-h-screen grid place-items-center"><Loader2 className="animate-spin text-orange-600" size={32} /></div>;
  }
  if (track === 'unavailable') {
    return (
      <div lang={language} dir={language === 'ur' ? 'rtl' : 'ltr'} className="min-h-screen grid place-items-center px-6 text-center">
        <div>
          <div className="mb-4"><CustomerLanguagePicker language={language} onChange={setLanguage} /></div>
          <h1 className="text-2xl font-extrabold">{t.trackingUnavailable}</h1>
          <p className="text-neutral-500 mt-2 text-sm">{t.checkConnection}</p>
          <button type="button" onClick={() => void load()} className="btn btn-dark h-11 px-6 mt-6">{t.tryAgain}</button>
        </div>
      </div>
    );
  }
  if (!track) {
    return (
      <div lang={language} dir={language === 'ur' ? 'rtl' : 'ltr'} className="min-h-screen grid place-items-center px-6 text-center">
        <div>
          <div className="mb-4"><CustomerLanguagePicker language={language} onChange={setLanguage} /></div>
          <h1 className="text-2xl font-extrabold">{t.orderNotFound}</h1>
          <p className="text-neutral-500 mt-2 text-sm">{t.checkLink}</p>
          <Link href="/" className="btn btn-dark h-11 px-6 mt-6">{t.goHome}</Link>
        </div>
      </div>
    );
  }

  const checkoutUnconfirmed = track.status === 'draft' && !track.payment_method;
  const awaitingConfirmation = track.payment_method === 'upi' && track.payment_status === 'submitted';
  const awaitingPayment = track.payment_method === 'upi' && track.payment_status === 'pending';
  const rejected = track.payment_status === 'rejected';
  const codPending = track.payment_method === 'cod' && track.payment_status === 'cod_pending';
  const confirmed = track.payment_status === 'confirmed' || track.payment_status === 'cod_collected';
  const activeIndex = STEPS.findIndex((s) => s.key === track.status);

  return (
    <div lang={language} dir={language === 'ur' ? 'rtl' : 'ltr'} className="min-h-screen bg-[radial-gradient(1200px_600px_at_50%_-10%,#ffedd5,transparent)]">
      <header className="max-w-lg mx-auto px-4 h-14 flex items-center justify-between">
        <Logo />
        <div className="flex items-center gap-2"><button type="button" onClick={() => void load()} className="text-xs font-bold text-orange-800 underline">{t.refreshTracking}</button><CustomerLanguagePicker language={language} onChange={setLanguage} /></div>
      </header>

      <main className="max-w-lg mx-auto px-4 pb-16">
        {language !== 'en' && <p className="text-xs text-neutral-600">{t.limitedTranslation}</p>}
        {trackError && <p role="status" className="mt-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900">Could not refresh the order. The information below may be out of date; we’ll keep trying.</p>}
        {/* Token card */}
        <section className="card mt-2 p-6 text-center">
          <div className="break-words [overflow-wrap:anywhere] text-xs font-bold uppercase tracking-widest text-neutral-400">{track.shop_name}{track.shop_city ? ` · ${track.shop_city}` : ''}</div>
          {track.token ? (
            <>
              <div className="mt-2 text-[10px] uppercase tracking-[0.3em] text-neutral-400">{t.yourToken}</div>
              <div className="text-7xl font-black tracking-tight text-orange-600 my-1">{track.token}</div>
            </>
          ) : awaitingConfirmation ? (
            <>
              <Hourglass size={40} className="mx-auto mt-3 text-orange-500" />
              <div className="mt-2 text-lg font-extrabold">{t.waitConfirm}</div>
              <p className="text-sm text-neutral-500 mt-1 max-w-xs mx-auto">{t.shopVerifying}</p>
            </>
          ) : awaitingPayment ? (
            <div className="mt-3 text-lg font-extrabold">{t.notReported}</div>
          ) : checkoutUnconfirmed ? (
            <div className="mt-3 text-lg font-extrabold">{t.checkoutUnconfirmed}</div>
          ) : (
            <div className="mt-3 text-lg font-extrabold">{t.orderReceived}</div>
          )}

          <p className="mt-3 text-xs text-neutral-500">{t.saveTracking}</p>
          <p className="mt-1 text-xs font-semibold text-orange-800">{AUTO_UPDATE[language]}</p>
          <div className="mt-4"><OrderReference key={track.order_id} id={track.order_id} language={language} /></div>

          {/* payment state banners */}
          {checkoutUnconfirmed && <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-left text-xs text-amber-900">{t.checkoutUnconfirmedHelp}</div>}
          {awaitingPayment && (
            <div className="mt-4 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-xs px-4 py-2.5 text-left">{t.pendingHelp}</div>
          )}
          {awaitingConfirmation && (
            <div className="mt-4 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-xs px-4 py-2.5 flex items-center gap-2 text-left"><Wallet size={14} className="shrink-0" />{t.submittedHelp}</div>
          )}
          {rejected && (
            <div className="mt-4 rounded-xl bg-red-50 border border-red-200 text-red-800 text-xs px-4 py-2.5 text-left">{t.rejectedHelp}</div>
          )}
          {codPending && (
            <div className="mt-4 rounded-xl bg-blue-50 border border-blue-200 text-blue-900 text-xs px-4 py-2.5 flex items-center gap-2 text-left"><Wallet size={14} className="shrink-0" />{t.cashDue.replace('{amount}', `₹${(track.total_paise / 100).toFixed(2)}`)}</div>
          )}
          {confirmed && (
            <div className="mt-4 rounded-xl bg-green-50 border border-green-200 text-green-900 text-xs px-4 py-2.5 flex items-center gap-2 text-left"><CheckCircle2 size={14} className="shrink-0" />{t.paymentConfirmed}{track.payment_method === 'upi' ? ' via UPI' : ''}. {track.rush ? 'The shop has been told this is a rush order.' : ''}</div>
          )}
        </section>

        {track.status === 'draft' && track.payment_method === 'upi' && (awaitingPayment || rejected) && (
          <section className="card mt-4 p-4 text-sm">
            <h2 className="font-extrabold">{t.alreadySent}</h2>
            <p className="mt-1 text-xs leading-relaxed text-neutral-600">{t.reportHelp} {rejected && language === 'en' && 'Do not pay twice.'}</p>
            <label className="label mt-3">{t.reference}
              <input value={reportUtr} onChange={(event) => setReportUtr(event.target.value)} maxLength={40} className="input" placeholder="e.g. 426178900123" />
            </label>
            <button type="button" disabled={reportBusy} onClick={() => void reportPayment()} className="btn btn-primary mt-3 min-h-11 w-full px-4 text-sm">
              {reportBusy ? t.reporting : t.reportPayment}
            </button>
            {reportMessage && <p role="status" className="mt-2 text-xs text-neutral-700">{reportMessage}</p>}
            <p className="mt-2 text-xs text-neutral-500">{t.expiredHelp} <Link className="font-bold text-orange-800 underline" href={`/s/${encodeURIComponent(track.shop_slug)}`}>{t.shopDetails}</Link></p>
          </section>
        )}

        {/* Stepper */}
        {track.token && (
          <section className="card mt-4 p-5">
            <div className="flex items-center justify-between">
              {STEPS.map((s, i) => {
                const Icon = s.icon;
                const reached = activeIndex >= i;
                const current = activeIndex === i;
                return (
                  <div key={s.key} className="flex flex-col items-center gap-1.5 flex-1 relative">
                    {i < STEPS.length - 1 && <div className={cn('absolute top-5 left-1/2 w-full h-0.5 -z-0', activeIndex > i ? 'bg-orange-500' : 'bg-neutral-200')} />}
                    <div className={cn('relative z-10 w-10 h-10 rounded-full grid place-items-center border-2 transition-colors',
                      reached ? 'bg-orange-600 border-orange-600 text-white' : 'bg-white border-neutral-200 text-neutral-400',
                      current && 'ring-4 ring-orange-600/20')}>
                      <Icon size={18} />
                    </div>
                    <span className={cn('text-[10px] font-bold', reached ? 'text-orange-800' : 'text-neutral-400')}>{s.key === 'queued' ? t.queue : s.key === 'printing' ? t.printing : s.key === 'ready' ? t.ready : t.collected}</span>
                  </div>
                );
              })}
            </div>
            <div className="mt-4 text-center text-xs text-neutral-500">
              {track.status === 'ready' && <span className="font-bold text-green-700">Your order is ready — show token {track.token} at the counter.</span>}
              {track.status === 'printing' && <>Printing now{track.eta_minutes ? ` · ~${track.eta_minutes} min` : ''}</>}
              {track.status === 'queued' && <>In the queue{track.eta_minutes ? ` · ~${track.eta_minutes} min` : ''}</>}
              {track.status === 'collected' && <>Order collected. Thanks for using Printly!</>}
              {track.status === 'cancelled' && <span className="text-red-600 font-semibold">This order was cancelled.</span>}
            </div>
            <div className="mt-3 text-center text-[10px] text-neutral-400">Placed {formatDateTime(track.created_at)} · {track.item_count} item(s) · {formatPaiseExact(track.total_paise)}</div>
          </section>
        )}

        {/* Review (after collection) */}
        {track.status === 'collected' && !reviewed && (
          <section className="card mt-4 p-5">
            <h2 className="font-bold">Rate your experience</h2>
            <div className="flex items-center gap-2 mt-2">
              {[1, 2, 3, 4, 5].map((s) => (
                <button key={s} type="button" aria-label={`${s} ${s === 1 ? 'star' : 'stars'}`} aria-pressed={rating === s} onClick={() => setRating(s)}>
                  <Star size={34} className={cn('transition-colors', rating >= s ? 'fill-amber-400 text-amber-400' : 'text-neutral-300')} />
                </button>
              ))}
            </div>
            <input aria-label="Feedback for the shop (optional)" maxLength={500} value={comment} onChange={(e) => setComment(e.target.value)} className="input mt-3 text-sm" placeholder="Quick feedback for the shop (optional)" />
            <button onClick={submitReview} disabled={rating === 0 || reviewBusy} className="btn btn-primary h-11 px-6 mt-3">{reviewBusy ? <Loader2 size={17} className="animate-spin" /> : 'Submit rating'}</button>
            {reviewError && <p role="alert" className="mt-2 text-xs text-red-700">{reviewError}</p>}
          </section>
        )}
        {reviewed && <div className="card mt-4 p-4 text-center text-sm font-semibold text-green-700">Thanks for the feedback!</div>}

        <div className="mt-5 text-center text-xs text-neutral-600">Need to write to Printly? <Link href="/support" className="font-bold text-orange-800 underline">{t.supportLink}</Link>. Save your support code to check replies.</div>
        {/* Dispute */}
        <div className="mt-5 text-center">
          {!disputeDone ? (
            <button onClick={() => setDisputeOpen(true)} className="text-xs text-neutral-400 hover:text-red-600 inline-flex items-center gap-1"><AlertTriangle size={12} /> Something wrong with this order?</button>
          ) : (
            <span className="text-xs text-green-700 font-semibold">Report received — we’ll look into it.</span>
          )}
        </div>
      </main>

      {/* dispute modal */}
      {disputeOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 grid place-items-end sm:place-items-center" onClick={() => setDisputeOpen(false)}>
          <div className="bg-white w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between"><h3 className="font-extrabold text-lg">Report an issue</h3><button onClick={() => setDisputeOpen(false)}><X size={20} /></button></div>
            <label className="label mt-4">What happened?</label>
            <select value={disputeType} onChange={(e) => setDisputeType(e.target.value)} className="input">
              <option value="missing_pages">Missing pages</option>
              <option value="quality">Print quality</option>
              <option value="overcharge">Overcharged</option>
              <option value="other">Something else</option>
            </select>
            <textarea aria-label="Describe the issue" maxLength={1000} value={disputeText} onChange={(e) => setDisputeText(e.target.value)} className="input mt-2 min-h-24" placeholder="Describe the issue — the shop and Printly will see this." />
            <button onClick={submitDispute} disabled={disputeBusy || disputeText.trim().length < 5} className="btn btn-dark w-full h-12 mt-3">{disputeBusy ? 'Submitting…' : 'Submit report'}</button>
            {disputeError && <p role="alert" className="mt-2 text-xs text-red-700">{disputeError}</p>}
          </div>
        </div>
      )}
    </div>
  );
}
