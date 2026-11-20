'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AlertTriangle, X } from 'lucide-react';
import { subscriptionDate, termLabel, type ShopSubscription } from '@/lib/subscription';
import { useSubscriptionState } from '@/lib/use-subscription-state';

/** A persistent banner plus a once-per-session reminder for the shop owner. */
export function SubscriptionNotice({ subscription: initialSubscription, warningDays: initialWarningDays, isOwner, lockOnExpire = true }: { subscription: ShopSubscription | null; warningDays: number; isOwner: boolean; lockOnExpire?: boolean }) {
  const router = useRouter();
  const [subscription, setSubscription] = useState(initialSubscription);
  const [warningDays, setWarningDays] = useState(initialWarningDays);
  const [open, setOpen] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const state = useSubscriptionState(subscription, warningDays);
  useEffect(() => { setSubscription(initialSubscription); setWarningDays(initialWarningDays); }, [initialSubscription, initialWarningDays]);
  useEffect(() => {
    if (!initialSubscription?.shop_id) return;
    let cancelled = false;
    const refresh = async () => {
      if (document.visibilityState === 'hidden') return;
      try {
        const response = await fetch(`/api/shop/subscription/status?shop_id=${encodeURIComponent(initialSubscription.shop_id)}`, { cache: 'no-store' });
        if (response.ok) {
          const result = await response.json();
          if (!cancelled) { setSubscription(result.subscription ?? null); setWarningDays(result.warning_days ?? initialWarningDays); }
        }
      } catch { /* Existing server/API checks remain authoritative while offline. */ }
    };
    const timer = window.setInterval(() => { void refresh(); }, 60_000);
    const onVisible = () => { if (document.visibilityState === 'visible') void refresh(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { cancelled = true; window.clearInterval(timer); document.removeEventListener('visibilitychange', onVisible); };
  }, [initialSubscription?.shop_id, initialWarningDays]);
  useEffect(() => { if (state.status !== 'expiring') setOpen(false); }, [state.status]);
  useEffect(() => {
    // A page left open past expiry must not keep presenting the dashboard.
    if (lockOnExpire && !state.active) router.replace('/shop/subscription');
  }, [lockOnExpire, state.active, router]);
  useEffect(() => {
    if (!isOwner || state.status !== 'expiring' || !subscription?.expires_at) return;
    const key = `printly-subscription-reminder:${subscription.shop_id}:${subscription.expires_at}`;
    try {
      if (sessionStorage.getItem(key)) return;
      sessionStorage.setItem(key, 'shown');
    } catch { /* Private browsing may disable storage; still show the reminder. */ }
    setOpen(true);
  }, [isOwner, state.status, subscription?.expires_at, subscription?.shop_id]);
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusable = () => Array.from(dialogRef.current?.querySelectorAll<HTMLElement>('a[href], button:not([disabled])') ?? []);
    focusable()[0]?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setOpen(false); return; }
      if (event.key !== 'Tab') return;
      const nodes = focusable();
      if (!nodes.length) return;
      const first = nodes[0], last = nodes[nodes.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => { window.removeEventListener('keydown', onKeyDown); previous?.focus(); };
  }, [open]);

  if (!isOwner || state.status !== 'expiring') return null;
  return (
    <>
      <div role="status" className="no-print mb-4 flex flex-wrap items-center gap-3 rounded-2xl border-2 border-amber-400 bg-amber-50 p-4 text-amber-950 shadow-sm">
        <AlertTriangle size={21} className="shrink-0" />
        <div className="min-w-0 flex-1 text-sm"><strong>Subscription expires in {state.daysRemaining} {state.daysRemaining === 1 ? 'day' : 'days'}.</strong> Renew before {subscriptionDate(subscription?.expires_at)} to keep accepting orders.</div>
        <Link href="/shop/subscription" className="btn btn-dark min-h-10 px-4 text-xs">Renew or check status</Link>
      </div>
      {open && <div ref={dialogRef} className="no-print fixed inset-0 z-50 flex items-center justify-center bg-neutral-950/70 p-4" role="dialog" aria-modal="true" aria-labelledby="subscription-reminder-title" aria-describedby="subscription-reminder-description">
        <div className="relative w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
          <button onClick={() => setOpen(false)} aria-label="Dismiss reminder" className="absolute right-4 top-4 rounded-lg p-2 text-neutral-500 hover:bg-neutral-100"><X size={18} /></button>
          <div className="grid h-11 w-11 place-items-center rounded-xl bg-amber-100 text-amber-800"><AlertTriangle size={22} /></div>
          <h2 id="subscription-reminder-title" className="mt-4 pr-8 text-xl font-extrabold">Your subscription is ending soon</h2>
          <p id="subscription-reminder-description" className="mt-2 text-sm leading-relaxed text-neutral-600">Your {termLabel(subscription?.term).toLowerCase()} access ends on {subscriptionDate(subscription?.expires_at)}. Renew now to avoid an interruption. UPI payments need independent Printly verification; renewal is not automatic.</p>
          <div className="mt-5 flex flex-wrap gap-2"><Link href="/shop/subscription" className="btn btn-primary min-h-11 px-5" onClick={() => setOpen(false)}>Review subscription</Link><button className="btn btn-ghost min-h-11 px-4" onClick={() => setOpen(false)}>Not now</button></div>
        </div>
      </div>}
    </>
  );
}
