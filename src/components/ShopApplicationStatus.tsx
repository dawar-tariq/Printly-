'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

type Props = { shopId: string; status: string; shopStatus: string; reviewNote?: string; canAccessDashboard: boolean };

/** The server remains authoritative. Local storage only remembers whether this
 * browser has seen a pending application; it never grants shop access. */
export function ShopApplicationStatus({ shopId, status, shopStatus, reviewNote, canAccessDashboard }: Props) {
  const router = useRouter();
  const [celebrate, setCelebrate] = useState(false);
  const key = `printly-application-seen:${shopId}`;

  useEffect(() => {
    setCelebrate(false);
    try {
      if (status === 'pending' || status === 'changes_requested') localStorage.setItem(key, '1');
      else if (status === 'approved' && localStorage.getItem(key) === '1') setCelebrate(true);
    } catch { /* The status remains useful when storage is unavailable. */ }
  }, [key, status]);

  useEffect(() => {
    if (status !== 'pending') return;
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') router.refresh(); }, 30000);
    return () => window.clearInterval(timer);
  }, [status, router]);

  if (status === 'approved' && !celebrate) return null;
  if (!['pending', 'approved', 'changes_requested', 'rejected'].includes(status)) return null;
  const approved = status === 'approved';
  const dismiss = () => {
    try { localStorage.removeItem(key); } catch { /* best effort */ }
    setCelebrate(false);
    if (canAccessDashboard) { router.push('/shop'); router.refresh(); }
  };
  return <section aria-label="Shop application status" aria-live="polite" className="mb-4 rounded-2xl border border-orange-200 bg-white p-5 shadow-sm">
    <p className="text-xs font-bold uppercase tracking-wide text-orange-700">Your application</p>
    <h2 className="mt-2 text-xl font-extrabold">{approved ? 'Congratulations, your shop is verified!' : status === 'pending' ? 'Your application is under review' : status === 'changes_requested' ? 'More information is needed' : 'Application not approved'}</h2>
    <ol className="mt-4 grid grid-cols-3 gap-2 text-xs font-semibold" aria-label="Verification progress">
      <li className="border-t-4 border-green-600 pt-2">Application received</li>
      <li className={`border-t-4 pt-2 ${status === 'pending' || status === 'changes_requested' || approved ? 'border-orange-500' : 'border-neutral-300'}`} aria-current={status === 'pending' ? 'step' : undefined}>Under review</li>
      <li className={`border-t-4 pt-2 ${approved ? 'border-green-600' : 'border-neutral-300'}`} aria-current={approved ? 'step' : undefined}>Verified</li>
    </ol>
    <p className="mt-4 text-sm text-neutral-600">{approved
      ? shopStatus !== 'active' ? 'Verification is complete, but your shop is not active. Contact support before taking orders.' : canAccessDashboard ? 'Your shop is verified. Open your dashboard to manage your shop.' : 'Your shop is verified. An active subscription is still required before taking orders.'
      : status === 'pending' ? 'Our team is reviewing your shop details. This page checks for updates while it is open.'
      : status === 'changes_requested' ? (reviewNote || 'Please contact support for the details needed to continue your review.')
      : (reviewNote || 'Please contact support if you have questions about the decision.')}</p>
    {status === 'changes_requested' && <p className="mt-3 text-sm"><Link href={canAccessDashboard ? '/shop/settings' : '/support'} className="font-bold text-orange-700 underline">{canAccessDashboard ? 'Update shop details' : 'Contact support'}</Link></p>}
    {status === 'rejected' && <Link href="/support" className="mt-3 inline-block text-sm font-bold text-orange-700 underline">Contact support</Link>}
    {status === 'pending' && <button type="button" onClick={() => router.refresh()} className="btn btn-dark mt-4 min-h-10 px-4">Check status</button>}
    {celebrate && <button type="button" onClick={dismiss} className="btn btn-primary mt-4 min-h-10 px-4">{canAccessDashboard ? 'Continue to dashboard' : 'Continue'}</button>}
  </section>;
}
