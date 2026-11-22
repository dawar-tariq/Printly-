'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import {
  Logo } from '@/components/Logo';
import { formatPaiseExact, formatDateTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import {
  Loader2, Printer, CheckCircle2, Package, Store, Star, AlertTriangle, Wallet, X, Hourglass,
} from 'lucide-react';

interface Track {
  order_id: string; token: string | null; status: string; payment_status: string; payment_method: string;
  shop_name: string; shop_slug: string; shop_city: string; total_paise: number; eta_minutes: number | null;
  item_count: number; rush: boolean; created_at: string; ready_at: string | null; collected_at: string | null;
}

const STEPS = [
  { key: 'queued', label: 'In queue', icon: Store },
  { key: 'printing', label: 'Printing', icon: Printer },
  { key: 'ready', label: 'Ready', icon: Package },
  { key: 'collected', label: 'Collected', icon: CheckCircle2 },
];

export default function TrackPage() {
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
    setTrack('loading'); setTrackError(false);
    setRating(0); setComment(''); setReviewed(false); setReviewError(null);
    setReportUtr(''); setReportMessage(null);
    setDisputeOpen(false); setDisputeType('other'); setDisputeText(''); setDisputeDone(false); setDisputeError(null);
    // Do not keep polling in background tabs. Refresh immediately when the
    // customer returns, and otherwise use a modest interval while visible.
    const refreshIfVisible = () => { if (document.visibilityState !== 'hidden') void load(); };
    refreshIfVisible();
    const timer = window.setInterval(refreshIfVisible, 15_000);
    document.addEventListener('visibilitychange', refreshIfVisible);
    return () => { refreshSequence.current++; window.clearInterval(timer); document.removeEventListener('visibilitychange', refreshIfVisible); };
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
      <div className="min-h-screen grid place-items-center px-6 text-center">
        <div>
          <h1 className="text-2xl font-extrabold">Tracking is temporarily unavailable</h1>
          <p className="text-neutral-500 mt-2 text-sm">Please check your connection and try again. Your order may still be in progress.</p>
          <button type="button" onClick={() => void load()} className="btn btn-dark h-11 px-6 mt-6">Try again</button>
        </div>
      </div>
    );
  }
  if (!track) {
    return (
      <div className="min-h-screen grid place-items-center px-6 text-center">
        <div>
          <h1 className="text-2xl font-extrabold">Order not found</h1>
          <p className="text-neutral-500 mt-2 text-sm">Check the link — it may be mistyped.</p>
          <Link href="/" className="btn btn-dark h-11 px-6 mt-6">Go home</Link>
        </div>
      </div>
    );
  }

  const awaitingConfirmation = track.payment_method === 'upi' && track.payment_status === 'submitted';
  const awaitingPayment = track.payment_method === 'upi' && track.payment_status === 'pending';
  const rejected = track.payment_status === 'rejected';
  const codPending = track.payment_method === 'cod' && track.payment_status === 'cod_pending';
  const confirmed = track.payment_status === 'confirmed' || track.payment_status === 'cod_collected';
  const activeIndex = STEPS.findIndex((s) => s.key === track.status);

  return (
    <div className="min-h-screen bg-[radial-gradient(1200px_600px_at_50%_-10%,#ffedd5,transparent)]">
      <header className="max-w-lg mx-auto px-4 h-14 flex items-center justify-between">
        <Logo />
        <span className="text-xs text-neutral-400">Order tracking</span>
      </header>

      <main className="max-w-lg mx-auto px-4 pb-16">
        {trackError && <p role="status" className="mt-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900">Could not refresh the order. The information below may be out of date; we’ll keep trying.</p>}
        {/* Token card */}
        <section className="card mt-2 p-6 text-center">
          <div className="break-words [overflow-wrap:anywhere] text-xs font-bold uppercase tracking-widest text-neutral-400">{track.shop_name}{track.shop_city ? ` · ${track.shop_city}` : ''}</div>
          {track.token ? (
            <>
              <div className="mt-2 text-[10px] uppercase tracking-[0.3em] text-neutral-400">Your token</div>
              <div className="text-7xl font-black tracking-tight text-orange-600 my-1">{track.token}</div>
            </>
          ) : awaitingConfirmation ? (
            <>
              <Hourglass size={40} className="mx-auto mt-3 text-orange-500" />
              <div className="mt-2 text-lg font-extrabold">Waiting for payment confirmation</div>
              <p className="text-sm text-neutral-500 mt-1 max-w-xs mx-auto">The shop is verifying your UPI payment. Your token will appear here once the shop confirms it.</p>
            </>
          ) : awaitingPayment ? (
            <div className="mt-3 text-lg font-extrabold">Payment not reported yet</div>
          ) : (
            <div className="mt-3 text-lg font-extrabold">Order received</div>
          )}

          <p className="mt-3 text-xs text-neutral-500">Save this tracking link to check your order later.</p>

          {/* payment state banners */}
          {awaitingPayment && (
            <div className="mt-4 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-xs px-4 py-2.5 text-left">If you already paid, report it below from the browser you used to order, or contact the shop with your payment reference.</div>
          )}
          {awaitingConfirmation && (
            <div className="mt-4 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-xs px-4 py-2.5 flex items-center gap-2 text-left"><Wallet size={14} className="shrink-0" />A payment report was sent. The shop still needs to verify the transfer.</div>
          )}
          {rejected && (
            <div className="mt-4 rounded-xl bg-red-50 border border-red-200 text-red-800 text-xs px-4 py-2.5 text-left">The shop could not verify your payment. Please check with the counter before paying again.</div>
          )}
          {codPending && (
            <div className="mt-4 rounded-xl bg-blue-50 border border-blue-200 text-blue-900 text-xs px-4 py-2.5 flex items-center gap-2 text-left"><Wallet size={14} className="shrink-0" />Cash on collection — pay ₹{(track.total_paise / 100).toFixed(2)} at the counter.</div>
          )}
          {confirmed && (
            <div className="mt-4 rounded-xl bg-green-50 border border-green-200 text-green-900 text-xs px-4 py-2.5 flex items-center gap-2 text-left"><CheckCircle2 size={14} className="shrink-0" />Payment confirmed{track.payment_method === 'upi' ? ' via UPI' : ''}. {track.rush ? 'The shop has been told this is a rush order.' : ''}</div>
          )}
        </section>

        {track.status === 'draft' && track.payment_method === 'upi' && (awaitingPayment || rejected) && (
          <section className="card mt-4 p-4 text-sm">
            <h2 className="font-extrabold">Already sent the payment?</h2>
            <p className="mt-1 text-xs leading-relaxed text-neutral-600">Only report a payment you have sent. The shop must still verify it. {rejected && 'Contact the shop before trying again; do not pay twice.'}</p>
            <label className="label mt-3">UPI reference / UTR (optional)
              <input value={reportUtr} onChange={(event) => setReportUtr(event.target.value)} maxLength={40} className="input" placeholder="e.g. 426178900123" />
            </label>
            <button type="button" disabled={reportBusy} onClick={() => void reportPayment()} className="btn btn-primary mt-3 min-h-11 w-full px-4 text-sm">
              {reportBusy ? 'Reporting…' : 'Report payment to shop'}
            </button>
            {reportMessage && <p role="status" className="mt-2 text-xs text-neutral-700">{reportMessage}</p>}
            <p className="mt-2 text-xs text-neutral-500">If your order session has expired, contact the shop and share this tracking link and your payment reference. <Link className="font-bold text-orange-800 underline" href={`/s/${encodeURIComponent(track.shop_slug)}`}>View shop details</Link></p>
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
                    <span className={cn('text-[10px] font-bold', reached ? 'text-orange-800' : 'text-neutral-400')}>{s.label}</span>
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
