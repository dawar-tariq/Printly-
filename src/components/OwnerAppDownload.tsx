'use client';

import { useEffect, useState } from 'react';
import { Download, ShieldCheck, Smartphone } from 'lucide-react';
import { parseOwnerAppRelease, type OwnerAppRelease } from '@/lib/owner-app-release';

type LoadState =
  | { status: 'loading' | 'unavailable' | 'error' }
  | { status: 'ready'; release: Extract<OwnerAppRelease, { available: true }> };

/** The link stays absent until the server advertises complete, safe release metadata. */
export function OwnerAppDownload() {
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setState({ status: 'loading' });
    fetch('/api/shop/app-release', { cache: 'no-store', signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error('unavailable');
        const data: unknown = await response.json();
        const site = process.env.NEXT_PUBLIC_SITE_URL || window.location.origin;
        const release = parseOwnerAppRelease(data, site);
        if (!release) throw new Error('invalid release metadata');
        if (!controller.signal.aborted) setState(release.available ? { status: 'ready', release } : { status: 'unavailable' });
      })
      .catch(() => { if (!controller.signal.aborted) setState({ status: 'error' }); });
    return () => controller.abort();
  }, [attempt]);

  return <section className="rounded-[1.35rem] border border-[#eee4db] bg-white p-4 sm:p-5" aria-labelledby="owner-app-download-title">
    <div className="flex items-start gap-3">
      <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-orange-50 text-orange-700"><Smartphone size={23} /></span>
      <div><h2 id="owner-app-download-title" className="font-extrabold">Printly for Shops · Android</h2><p className="mt-1 text-sm leading-6 text-neutral-600">Manage orders, inventory and your shop using your existing Printly account.</p></div>
    </div>
    {state.status === 'ready' ? <>
      <a href={state.release.downloadUrl} rel="noopener noreferrer" referrerPolicy="no-referrer" className="btn btn-primary mt-5 min-h-12 w-full px-4">
        <Download size={17} />Download Android APK · {state.release.versionName}
      </a>
      <p className="mt-2 break-all text-[11px] leading-4 text-neutral-500">File SHA-256: {state.release.sha256}</p>
      {state.release.notes && <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-neutral-600">{state.release.notes}</p>}
      <div className="mt-5 rounded-xl bg-orange-50 p-4 text-sm leading-6 text-neutral-700">
        <h3 className="font-bold text-neutral-900">Install on your Android phone</h3>
        <ol className="mt-2 list-decimal space-y-1 pl-5">
          <li>Download the APK above, then open it from your phone’s downloads.</li>
          <li>Android may ask you to allow this browser to install apps. Allow it only if you trust the download; you can turn that permission off afterwards.</li>
          <li>Confirm the installation and sign in with your existing shop account.</li>
        </ol>
        <p className="mt-2 text-xs leading-5">This is a direct download, not a Google Play installation. Keep Play Protect enabled; Android may show an additional warning.</p>
      </div>
    </> : <div role="status" className="mt-5 rounded-xl bg-neutral-50 p-4 text-sm leading-6 text-neutral-600">
      {state.status === 'loading' ? 'Checking for the Android app…' : state.status === 'unavailable'
        ? 'The Android app is not available for download yet. Please check back later.'
        : <>Could not check the Android app. <button type="button" onClick={() => setAttempt((value) => value + 1)} className="font-bold text-orange-800 underline">Try again</button></>}
    </div>}
    <p className="mt-4 flex items-start gap-1.5 text-xs leading-5 text-neutral-500"><ShieldCheck size={15} className="mt-0.5 shrink-0" />Some presentation details can change without reinstalling. New app features and security fixes require an update that you approve.</p>
  </section>;
}
