'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { Wrench } from 'lucide-react';
import { BrandArtwork } from '@/components/BrandArtwork';
import {
  isAdminPage, MAINTENANCE_CHECK_INTERVAL_MS, MAINTENANCE_COPY,
  MAINTENANCE_PAYMENT_NOTE, MAINTENANCE_STATUS_PATH, type MaintenanceNotice,
} from '@/lib/maintenance';

/** Also notify people who already had a page open when maintenance started. */
export function MaintenanceGuard({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() || '/';
  const adminPage = isAdminPage(pathname);
  const [notice, setNotice] = useState<MaintenanceNotice | null>(null);
  const [checking, setChecking] = useState(false);
  const checkRef = useRef<() => void>(() => {});
  const titleRef = useRef<HTMLHeadingElement>(null);
  const visible = !adminPage && notice !== null;

  useEffect(() => {
    if (adminPage) {
      setNotice(null);
      return;
    }
    let disposed = false;
    let pending: AbortController | null = null;
    const check = async () => {
      if (pending) return;
      const controller = new AbortController();
      pending = controller;
      setChecking(true);
      try {
        const response = await fetch(MAINTENANCE_STATUS_PATH, { cache: 'no-store', signal: controller.signal });
        const data = await response.json().catch(() => null);
        if (disposed) return;
        if (response.ok && data?.maintenance === false) setNotice(null);
        else if (response.status === 503 && data?.error?.code === 'maintenance') setNotice('maintenance');
        else setNotice('unavailable');
      } catch {
        if (!disposed && !controller.signal.aborted) setNotice('unavailable');
      } finally {
        if (pending === controller) pending = null;
        if (!disposed) setChecking(false);
      }
    };
    checkRef.current = () => { void check(); };
    const checkIfVisible = () => { if (document.visibilityState !== 'hidden') void check(); };
    checkIfVisible();
    const timer = window.setInterval(checkIfVisible, MAINTENANCE_CHECK_INTERVAL_MS);
    document.addEventListener('visibilitychange', checkIfVisible);
    window.addEventListener('focus', checkIfVisible);
    return () => {
      disposed = true;
      pending?.abort();
      checkRef.current = () => {};
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', checkIfVisible);
      window.removeEventListener('focus', checkIfVisible);
    };
  }, [adminPage]);

  useEffect(() => {
    if (!visible) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    titleRef.current?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus();
    };
  }, [visible]);

  const copy = notice ? MAINTENANCE_COPY[notice] : null;
  return (
    <>
      <div inert={visible || undefined} aria-hidden={visible || undefined}>{children}</div>
      {visible && copy && (
        <div className="fixed inset-0 z-[9999] overflow-y-auto bg-[#fbfaf8] px-5 py-10 text-center text-stone-900" role="alertdialog" aria-modal="true" aria-labelledby="maintenance-title" aria-describedby="maintenance-message">
          <div className="mx-auto flex min-h-full max-w-[580px] flex-col justify-center">
            <div className="flex justify-center" role="img" aria-label="Printly">
              <BrandArtwork className="h-[34px] w-auto" />
            </div>
            <div className="mt-8 rounded-[28px] border border-[#e9e5df] bg-white px-5 py-10 shadow-[0_20px_60px_rgba(65,38,16,0.07)] sm:px-7">
              <div className="mx-auto mb-6 grid h-[66px] w-[66px] place-items-center rounded-[22px] bg-orange-50 text-orange-700"><Wrench size={30} aria-hidden="true" /></div>
              <span className="inline-block rounded-full bg-orange-100 px-3 py-2 text-[11px] font-extrabold uppercase leading-none tracking-wider text-amber-700">{copy.label}</span>
              <h1 id="maintenance-title" ref={titleRef} tabIndex={-1} className="mt-[18px] text-3xl font-extrabold leading-tight tracking-tight outline-none sm:text-[38px]">{copy.title}</h1>
              <p id="maintenance-message" className="mt-3 text-[15px] leading-relaxed text-stone-600">{copy.message}</p>
              <p className="mx-auto mt-6 max-w-[410px] rounded-[14px] bg-amber-50 px-4 py-3.5 text-left text-[13px] leading-relaxed text-amber-900">{MAINTENANCE_PAYMENT_NOTE}</p>
              <button type="button" onClick={() => checkRef.current()} disabled={checking} className="mt-[26px] inline-flex min-h-12 items-center justify-center rounded-[14px] bg-stone-900 px-6 text-sm font-bold text-white hover:bg-stone-700 focus-visible:outline-3 focus-visible:outline-offset-4 focus-visible:outline-orange-400 disabled:opacity-50">{checking ? 'Checking…' : 'Try again'}</button>
            </div>
            <p className="mt-6 text-xs text-stone-500">Thank you for your patience. &nbsp;·&nbsp; <a className="underline underline-offset-2" href="/admin/login">Administrator sign in</a></p>
          </div>
        </div>
      )}
    </>
  );
}
