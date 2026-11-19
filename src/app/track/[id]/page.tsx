'use client';

import { useCallback, useEffect, useState } from 'react';
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
  const [track, setTrack] = useState<Track | null | 'loading'>('loading');
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [reviewed, setReviewed] = useState(false);
  const [reviewBusy, setReviewBusy] = useState(false);
  const [disputeOpen, setDisputeOpen] = useState(false);
  const [disputeType, setDisputeType] = useState('other');
  const [disputeText, setDisputeText] = useState('');
  const [disputeDone, setDisputeDone] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch(`/api/orders/${id}/track`, { cache: 'no-store' });
    if (res.ok) {
      const data = await res.json();
      setTrack(data.track);
    } else {
      setTrack(null);
    }
  }, [id]);

  useEffect(() => {
    load();
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, [load]);

  const submitReview = async () => {
    if (rating === 0) return;
    setReviewBusy(true);
    try {
      const res = await fetch(`/api/orders/${id}/review`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rating, comment }),
      });
      if (res.ok || res.status === 409) setReviewed(true);
    } finally { setReviewBusy(false); }
  };

  const submitDispute = async () => {
    if (disputeText.trim().length < 5) return;
    const res = await fetch('/api/disputes', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ order_id: id, type: disputeType, description: disputeText.trim() }),
    });
    if (res.ok) { setDisputeDone(true); setDisputeOpen(false); }
  };

  if (track === 'loading') {
    return <div className="min-h-screen grid place-items-center"><Loader2 className="animate-spin text-orange-600" size={32} /></div>;
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
        {/* Token card */}
        <section className="card mt-2 p-6 text-center">
          <div className="text-xs font-bold uppercase tracking-widest text-neutral-400">{track.shop_name}{track.shop_city ? ` · ${track.shop_city}` : ''}</div>
          {track.token ? (
            <>
              <div className="mt-2 text-[10px] uppercase tracking-[0.3em] text-neutral-400">Your token</div>
              <div className="text-7xl font-black tracking-tight text-orange-600 my-1">{track.token}</div>
            </>
          ) : awaitingConfirmation ? (
            <>
              <Hourglass size={40} className="mx-auto mt-3 text-orange-500" />
              <div className="mt-2 text-lg font-extrabold">Waiting for payment confirmation</div>
              <p className="text-sm text-neutral-500 mt-1 max-w-xs mx-auto">The shop is verifying your UPI payment. Your token appears here within a minute or two.</p>
            </>
          ) : (
            <div className="mt-3 text-lg font-extrabold">Order received</div>
          )}

          {/* payment state banners */}
          {awaitingConfirmation && (
            <div className="mt-4 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-xs px-4 py-2.5 flex items-center gap-2 text-left"><Wallet size={14} className="shrink-0" />You tapped “I’ve paid”. The shop will confirm once the money lands in their UPI.</div>
          )}
          {rejected && (
            <div className="mt-4 rounded-xl bg-red-50 border border-red-200 text-red-800 text-xs px-4 py-2.5 text-left">The shop could not verify your payment. Please check with the counter or pay again.</div>
          )}
          {codPending && (
            <div className="mt-4 rounded-xl bg-blue-50 border border-blue-200 text-blue-900 text-xs px-4 py-2.5 flex items-center gap-2 text-left"><Wallet size={14} className="shrink-0" />Cash on collection — pay ₹{(track.total_paise / 100).toFixed(2)} at the counter.</div>
          )}
          {confirmed && (
            <div className="mt-4 rounded-xl bg-green-50 border border-green-200 text-green-900 text-xs px-4 py-2.5 flex items-center gap-2 text-left"><CheckCircle2 size={14} className="shrink-0" />Payment confirmed{track.payment_method === 'upi' ? ' via UPI' : ''}. {track.rush ? 'Rush order — you’re first in line.' : ''}</div>
          )}
        </section>

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
                <button key={s} onClick={() => setRating(s)}>
                  <Star size={34} className={cn('transition-colors', rating >= s ? 'fill-amber-400 text-amber-400' : 'text-neutral-300')} />
                </button>
              ))}
            </div>
            <input value={comment} onChange={(e) => setComment(e.target.value)} className="input mt-3 text-sm" placeholder="Quick feedback for the shop (optional)" />
            <button onClick={submitReview} disabled={rating === 0 || reviewBusy} className="btn btn-primary h-11 px-6 mt-3">{reviewBusy ? <Loader2 size={17} className="animate-spin" /> : 'Submit rating'}</button>
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
            <textarea value={disputeText} onChange={(e) => setDisputeText(e.target.value)} className="input mt-2 min-h-24" placeholder="Describe the issue — the shop and Printly will see this." />
            <button onClick={submitDispute} disabled={disputeText.trim().length < 5} className="btn btn-dark w-full h-12 mt-3">Submit report</button>
          </div>
        </div>
      )}
    </div>
  );
}
