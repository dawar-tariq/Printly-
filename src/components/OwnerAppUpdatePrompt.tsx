'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Download, Smartphone, X } from 'lucide-react';
import { validNativeVersion, type OwnerAppRelease } from '@/lib/owner-app-release';

/** Website changes arrive normally; this only announces a newer signed APK. */
export function OwnerAppUpdatePrompt() {
  const [release, setRelease] = useState<Extract<OwnerAppRelease, { available: true }> | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const later = useCallback(() => {
    if (!release) return;
    try { window.localStorage.setItem('printly-owner-update-dismissed', `${release.versionCode}:${Date.now()}`); } catch { /* The prompt may reappear next time. */ }
    setRelease(null);
  }, [release]);

  useEffect(() => {
    let active = true;
    let version: number | null = null;
    try { version = validNativeVersion(window.localStorage.getItem('printly-owner-android-version')); } catch { return; }
    if (!version) return;
    fetch('/api/shop/app-release', { cache: 'no-store' }).then(async (response) => response.ok ? response.json() as Promise<OwnerAppRelease> : null).then((latest) => {
      if (!active || !latest?.available || latest.versionCode <= version!) return;
      try {
        const [dismissedVersion, dismissedAt] = (window.localStorage.getItem('printly-owner-update-dismissed') ?? '').split(':').map(Number);
        if (dismissedVersion === latest.versionCode && Number.isFinite(dismissedAt) && Date.now() - dismissedAt < 86_400_000) return;
      } catch { /* A prompt is safe even if storage is blocked. */ }
      setRelease(latest);
    }).catch(() => {});
    return () => { active = false; };
  }, []);
  // Move focus before the modal is painted, so the underlying page never
  // remains the initial keyboard target while the update dialog is visible.
  useLayoutEffect(() => {
    if (!release) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusable = () => Array.from(dialogRef.current?.querySelectorAll<HTMLElement>('a[href], button:not([disabled])') ?? []);
    focusable()[0]?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { later(); return; }
      if (event.key !== 'Tab') return;
      const nodes = focusable();
      if (!nodes.length) return;
      const first = nodes[0], last = nodes[nodes.length - 1];
      if (!dialogRef.current?.contains(document.activeElement)) { event.preventDefault(); (event.shiftKey ? last : first).focus(); }
      else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => { window.removeEventListener('keydown', onKeyDown); previous?.focus(); };
  }, [release, later]);
  if (!release) return null;
  return <div ref={dialogRef} className="fixed inset-0 z-[90] flex items-end justify-center bg-neutral-950/45 p-3 sm:items-center" role="dialog" aria-modal="true" aria-labelledby="owner-update-title" aria-describedby="owner-update-description">
    <div className="w-full max-w-md rounded-[1.6rem] bg-white p-5 shadow-xl"><div className="flex items-start justify-between"><span className="grid h-12 w-12 place-items-center rounded-2xl bg-orange-50 text-orange-700"><Smartphone size={23} /></span><button type="button" aria-label="Close update prompt" onClick={later} className="rounded-xl p-2 text-neutral-500"><X size={19} /></button></div>
      <h2 id="owner-update-title" className="mt-4 text-xl font-black tracking-tight">A new app version is available</h2><p id="owner-update-description" className="mt-2 text-sm leading-6 text-neutral-600">Version {release.versionName} is ready. Download it and follow Android’s install prompt. Your existing shop account and data stay on Printly.</p>
      {release.notes && <p className="mt-3 rounded-xl bg-orange-50 p-3 text-xs leading-5 text-orange-900">{release.notes}</p>}
      <a href={release.downloadUrl} rel="noopener noreferrer" className="btn btn-primary mt-5 min-h-12 w-full"><Download size={17} />Download update</a><button type="button" onClick={later} className="mt-3 min-h-10 w-full text-sm font-bold text-neutral-600">Remind me later</button>
    </div>
  </div>;
}
