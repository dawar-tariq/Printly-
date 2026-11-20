'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Check, ExternalLink, Eye, FileImage, FileText, Loader2, Printer, QrCode, RefreshCw, ShieldCheck, X } from 'lucide-react';
import { STANDEE_THEMES, type StandeeInfo, type StandeeTheme } from '@/lib/standee/shared';
import { cn } from '@/lib/utils';

type Snapshot = { info: StandeeInfo; revision: string; theme: StandeeTheme; preview: string };
type DownloadFormat = 'pdf' | 'png';

const outlineButton = 'btn h-11 whitespace-nowrap border border-neutral-200 bg-white px-3 text-xs text-neutral-800 hover:bg-neutral-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-700 sm:text-sm';

export default function ShopStandeePage() {
  const [theme, setTheme] = useState<StandeeTheme>('orange');
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState<DownloadFormat | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);
  const previewButtonRef = useRef<HTMLButtonElement>(null);

  const generate = useCallback(async (nextTheme: StandeeTheme) => {
    setLoading(true);
    setError(null);
    setShowPreview(false);
    setSnapshot(null);
    try {
      const response = await fetch(`/api/shop/standee?format=preview&theme=${encodeURIComponent(nextTheme)}`, { cache: 'no-store' });
      const result = await response.json().catch(() => null);
      if (!response.ok) throw new Error(result?.error?.message ?? 'Could not generate the standee. Please try again.');
      if (!result?.info || typeof result.revision !== 'string' || result.theme !== nextTheme ||
          typeof result.preview !== 'string' || !result.preview.startsWith('data:image/png;base64,')) {
        throw new Error('Could not load the standee preview. Please try again.');
      }
      setSnapshot(result as Snapshot);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not generate the standee. Please try again.');
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void generate('orange'); }, [generate]);
  useEffect(() => {
    if (!showPreview) return;
    closeRef.current?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setShowPreview(false); previewButtonRef.current?.focus(); }
      if (event.key === 'Tab') { event.preventDefault(); closeRef.current?.focus(); }
    };
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  }, [showPreview]);

  const exportUrl = (format: DownloadFormat | 'print') => snapshot
    ? `/api/shop/standee?format=${format}&theme=${encodeURIComponent(snapshot.theme)}&revision=${encodeURIComponent(snapshot.revision)}`
    : '#';

  const download = async (format: DownloadFormat) => {
    if (!snapshot) return;
    setDownloading(format);
    setError(null);
    try {
      const response = await fetch(exportUrl(format), { cache: 'no-store' });
      if (!response.ok) {
        const result = await response.json().catch(() => ({}));
        if (response.status === 409) setSnapshot(null);
        throw new Error(result?.error?.message ?? 'Could not download the standee. Please try again.');
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `printly-standee-${snapshot.info.short_code}.${format}`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not download the standee. Please try again.');
    } finally { setDownloading(null); }
  };

  const unavailable = loading || !!downloading;
  const disabled = !snapshot || unavailable;

  return (
    <div className="mx-auto max-w-6xl space-y-5 pb-12">
      <Link href="/shop/settings" className="inline-flex items-center gap-1.5 text-sm font-semibold text-neutral-600 hover:text-orange-700"><ArrowLeft size={16} /> Settings &amp; QR</Link>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[11px] font-extrabold uppercase tracking-[0.18em] text-orange-700">Your shop tools</p>
          <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-neutral-950 sm:text-3xl">QR standee</h1>
          <p className="mt-1.5 max-w-xl text-sm leading-relaxed text-neutral-600">A ready-to-print counter display, made with your shop&apos;s own ordering link.</p>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-orange-100 bg-orange-50 px-3 py-1.5 text-xs font-bold text-orange-800"><FileText size={14} /> A4 · Portrait</span>
      </div>

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <section className="card p-5 sm:p-6" aria-labelledby="standee-details-title">
          <div className="flex items-start gap-3">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-orange-100 text-orange-700"><QrCode size={21} /></span>
            <div><h2 id="standee-details-title" className="text-lg font-extrabold text-neutral-950">Your counter display</h2><p className="mt-1 text-sm leading-relaxed text-neutral-600">Customers can scan the code to open your shop&apos;s order page.</p></div>
          </div>

          {error && <div role="alert" className="mt-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>}
          {snapshot && (snapshot.info.status !== 'active' || snapshot.info.kyc_status !== 'approved') && (
            <div role="status" className="mt-5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-relaxed text-amber-900">Your shop isn&apos;t accepting orders yet. The QR is ready, but customers can order only when your shop is approved and active.</div>
          )}

          <div className="mt-5 rounded-2xl border border-orange-100 bg-[#fff9f4] p-4">
            <div className="flex items-center justify-between gap-3"><h3 className="text-xs font-extrabold uppercase tracking-wider text-neutral-500">Saved shop details</h3><span className="text-[11px] font-semibold text-neutral-500">From your profile</span></div>
            {snapshot ? <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
              <div className="min-w-0"><dt className="text-xs text-neutral-500">Shop name</dt><dd className="mt-0.5 break-words font-bold text-neutral-900">{snapshot.info.shop_name}</dd></div>
              <div className="min-w-0"><dt className="text-xs text-neutral-500">Owner</dt><dd className="mt-0.5 break-words font-bold text-neutral-900">{snapshot.info.owner_name}</dd></div>
              <div><dt className="text-xs text-neutral-500">Shop code</dt><dd className="mt-0.5 font-mono font-bold text-neutral-900">{snapshot.info.short_code}</dd></div>
              <div className="col-span-2 min-w-0"><dt className="text-xs text-neutral-500">Customer order URL</dt><dd className="mt-0.5"><a href={snapshot.info.order_url} target="_blank" rel="noreferrer" className="break-all text-xs font-semibold text-orange-800 underline decoration-orange-300 underline-offset-2 hover:text-orange-950">{snapshot.info.order_url} <ExternalLink size={12} className="inline" /></a></dd></div>
            </dl> : <p className="mt-3 text-sm text-neutral-500">{loading ? 'Loading your saved details…' : 'Generate a standee to load your saved details.'}</p>}
          </div>

          <fieldset className="mt-5" disabled={unavailable}>
            <legend className="text-sm font-bold text-neutral-900">Printly colour</legend>
            <p className="mt-1 text-xs text-neutral-500">The QR remains black on white in every style.</p>
            <div className="mt-2.5 flex flex-wrap gap-2">
              {(Object.entries(STANDEE_THEMES) as Array<[StandeeTheme, (typeof STANDEE_THEMES)[StandeeTheme]]>).map(([key, option]) => (
                <button key={key} type="button" aria-pressed={theme === key} onClick={() => { setTheme(key); void generate(key); }}
                  className={cn('inline-flex h-10 items-center gap-2 rounded-xl border px-3 text-xs font-bold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-700 disabled:opacity-50', theme === key ? 'border-orange-500 bg-orange-50 text-orange-900' : 'border-neutral-200 bg-white text-neutral-700 hover:bg-neutral-50')}>
                  <span className="h-4 w-4 rounded-full" style={{ backgroundColor: option.accent }} />{option.label}{theme === key && <Check size={13} />}
                </button>
              ))}
            </div>
          </fieldset>

          <button type="button" onClick={() => void generate(theme)} disabled={unavailable} className="btn btn-primary mt-5 h-12 w-full px-4 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-700">
            {loading ? <Loader2 size={17} className="animate-spin" /> : <RefreshCw size={17} />} Generate QR Standee
          </button>
          <p className="mt-2 text-center text-xs leading-relaxed text-neutral-500">Generate again after changing your shop or owner details.</p>

          <div className="mt-5 grid grid-cols-1 gap-2 min-[360px]:grid-cols-2">
            <button ref={previewButtonRef} type="button" disabled={disabled} onClick={() => setShowPreview(true)} className={outlineButton}><Eye size={16} />Preview Standee</button>
            {snapshot && !unavailable ? <a href={exportUrl('print')} target="_blank" rel="noopener noreferrer" className={outlineButton}><Printer size={16} />Print Standee</a> : <button type="button" disabled className={outlineButton}><Printer size={16} />Print Standee</button>}
            <button type="button" disabled={disabled} onClick={() => void download('pdf')} className={outlineButton}>{downloading === 'pdf' ? <Loader2 size={16} className="animate-spin" /> : <FileText size={16} />}Download PDF</button>
            <button type="button" disabled={disabled} onClick={() => void download('png')} className={outlineButton}>{downloading === 'png' ? <Loader2 size={16} className="animate-spin" /> : <FileImage size={16} />}Download PNG</button>
          </div>
          <div className="mt-5 flex items-start gap-2 rounded-xl bg-neutral-50 p-3 text-xs leading-relaxed text-neutral-600"><ShieldCheck size={16} className="mt-0.5 shrink-0 text-orange-700" /><p>Print on A4 at actual size (100%), with headers and footers off. Check the preview and test a scan after printing.</p></div>
        </section>

        <section id="standee-preview" className="overflow-hidden rounded-[1.25rem] border border-neutral-200 bg-[#f4f0eb]" aria-labelledby="preview-title">
          <div className="flex items-center justify-between gap-3 border-b border-neutral-200 bg-white px-5 py-4">
            <div><h2 id="preview-title" className="text-sm font-extrabold text-neutral-950">Standee preview</h2><p className="mt-0.5 text-xs text-neutral-500">Your actual shop details and QR code</p></div>
            <span className="rounded-full bg-neutral-100 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-neutral-600">A4</span>
          </div>
          <div className="flex min-h-[360px] items-start justify-center p-4 sm:p-7">
            {snapshot ? <div className="w-full max-w-[470px] bg-white shadow-[0_8px_32px_rgba(28,25,23,0.12)]">
              {/* The preview is rendered from the same A4 artwork as both downloads. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={snapshot.preview} alt={`A4 QR standee for ${snapshot.info.shop_name}`} className="block h-auto w-full" />
            </div> : <div className="grid min-h-[320px] w-full place-items-center text-center text-sm text-neutral-500"><div>{loading ? <Loader2 size={26} className="mx-auto animate-spin text-orange-700" /> : <QrCode size={26} className="mx-auto text-neutral-400" />}<p className="mt-3">{loading ? 'Preparing your standee…' : 'Your preview will appear here.'}</p></div></div>}
          </div>
          <p className="px-5 pb-4 text-center text-xs text-neutral-500">Preview and downloads use the same A4 layout.</p>
        </section>
      </div>

      {showPreview && snapshot && <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-neutral-950/75 p-3 sm:p-6" role="dialog" aria-modal="true" aria-labelledby="large-preview-title" onClick={(event) => { if (event.target === event.currentTarget) { setShowPreview(false); previewButtonRef.current?.focus(); } }}>
        <div className="w-full max-w-2xl overflow-hidden rounded-2xl bg-white shadow-2xl">
          <div className="flex items-center justify-between gap-3 border-b border-neutral-200 px-4 py-3"><div><h2 id="large-preview-title" className="font-extrabold text-neutral-900">Preview Standee</h2><p className="text-xs text-neutral-500">A4 portrait · {snapshot.info.short_code}</p></div><button ref={closeRef} type="button" aria-label="Close preview" onClick={() => { setShowPreview(false); previewButtonRef.current?.focus(); }} className="rounded-lg p-2 text-neutral-600 hover:bg-neutral-100"><X size={20} /></button></div>
          <div className="bg-neutral-100 p-3 sm:p-6">{/* eslint-disable-next-line @next/next/no-img-element */}<img src={snapshot.preview} alt={`Full preview of ${snapshot.info.shop_name} standee`} className="mx-auto block h-auto w-full max-w-[540px] bg-white shadow-md" /></div>
        </div>
      </div>}
    </div>
  );
}
