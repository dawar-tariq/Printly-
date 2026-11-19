'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import QRCode from 'qrcode';
import {
  Printer, Copy, ScanLine, BookOpen, Layers, UploadCloud, FileText, Loader2, CheckCircle2, XCircle,
  ChevronLeft, ShieldCheck, Smartphone, Banknote, Link2, FolderInput, Trash2, Zap, Wallet,
} from 'lucide-react';
import { Logo } from '@/components/Logo';
import { createBrowserSupabase } from '@/lib/supabase-client';
import { cn } from '@/lib/utils';
import { formatPaiseExact, formatPaise } from '@/lib/format';

type Service = 'print' | 'photocopy' | 'scan' | 'bind' | 'laminate';
type Step = 'service' | 'files' | 'options' | 'checkout' | 'upi';

interface UploadedFile {
  id: string;
  name: string;
  mime: string;
  size: number;
  page_count: number | null;
  source: 'upload' | 'dropbox';
  state: 'uploading' | 'ready' | 'error';
  error?: string;
}
interface ShopPublic {
  shop: { slug: string; name: string; city: string; upi_id: string | null; eta_minutes: number; rating_avg: number; rating_count: number; status: string };
  services: { service: string; enabled: boolean }[];
}
interface QuoteResp { quote: { lines: { service: string; description: string; unitPricePaise: number; qty: number; lineTotalPaise: number }[]; subtotalPaise: number; rushFeePaise: number; taxPaise: number; totalPaise: number }; rush: boolean }

const SERVICE_META: Record<Service, { label: string; icon: typeof Printer; blurb: string }> = {
  print: { label: 'Print', icon: Printer, blurb: 'PDF / Word / images' },
  photocopy: { label: 'Photocopy', icon: Copy, blurb: 'Class notes & forms' },
  scan: { label: 'Scan', icon: ScanLine, blurb: 'Physical → digital' },
  bind: { label: 'Binding', icon: BookOpen, blurb: 'Staple / spiral / hard' },
  laminate: { label: 'Lamination', icon: Layers, blurb: 'Cards & certificates' },
};

export default function OrderWizard() {
  const { slug } = useParams<{ slug: string }>();
  const router = useRouter();
  const [shopData, setShopData] = useState<ShopPublic | null>(null);
  const [step, setStep] = useState<Step>('service');
  const [service, setService] = useState<Service>('print');
  const [orderId, setOrderId] = useState<string | null>(null);
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [dropboxLink, setDropboxLink] = useState('');
  const [dropboxBusy, setDropboxBusy] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);

  // options
  const [copies, setCopies] = useState(1);
  const [color, setColor] = useState<'bw' | 'color'>('bw');
  const [size, setSize] = useState<'A4' | 'A3' | 'A5' | 'Legal'>('A4');
  const [sides, setSides] = useState<'single' | 'duplex'>('single');
  const [gsm, setGsm] = useState(80);
  const [binding, setBinding] = useState<'none' | 'staple' | 'spiral' | 'hard'>('none');
  const [bindingMain, setBindingMain] = useState<'staple' | 'spiral' | 'hard'>('spiral');
  const [lamination, setLamination] = useState(false);

  // checkout
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [notes, setNotes] = useState('');
  const [rush, setRush] = useState(false);
  const [method, setMethod] = useState<'upi' | 'cod'>('upi');
  const [busy, setBusy] = useState(false);
  const [quote, setQuote] = useState<QuoteResp | null>(null);

  // upi screen
  const [upi, setUpi] = useState<{ link: string; pa: string; pn: string; am: string; tn: string; shop_name: string; total_paise: number } | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [utr, setUtr] = useState('');
  const [secondsLeft, setSecondsLeft] = useState(300);

  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch(`/api/shops/${slug}/public`).then((r) => (r.ok ? r.json() : null)).then(setShopData);
  }, [slug]);

  const ensureOrder = useCallback(async (): Promise<string | null> => {
    if (orderId) return orderId;
    const res = await fetch('/api/orders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ shop_slug: slug }) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { setBanner(data?.error?.message ?? 'Could not start order'); return null; }
    setOrderId(data.order_id);
    return data.order_id;
  }, [orderId, slug]);

  const uploadOne = useCallback(async (file: File) => {
    const oid = await ensureOrder();
    if (!oid) return;
    const localId = crypto.randomUUID();
    setFiles((f) => [...f, { id: localId, name: file.name, mime: file.type || 'application/octet-stream', size: file.size, page_count: null, source: 'upload', state: 'uploading' }]);
    try {
      const presign = await fetch(`/api/orders/${oid}/files`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: file.name, mime: file.type || 'application/octet-stream', size: file.size }),
      });
      const pdata = await presign.json();
      if (!presign.ok) throw new Error(pdata?.error?.message ?? 'Upload rejected');

      const supabase = createBrowserSupabase();
      const { error } = await supabase.storage.from('order-files').uploadToSignedUrl(pdata.path, pdata.token, file);
      if (error) throw new Error(error.message);

      const fin = await fetch(`/api/orders/${oid}/files/${pdata.file_id}/finalize`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: pdata.path, original_name: file.name, mime: file.type || 'application/octet-stream', size_bytes: file.size, source: 'upload' }),
      });
      const fdata = await fin.json();
      if (!fin.ok) throw new Error(fdata?.error?.message ?? 'Could not read file');

      setFiles((f) => f.map((x) => (x.id === localId ? { ...x, id: fdata.file_id, page_count: fdata.page_count, state: 'ready' } : x)));
    } catch (e) {
      setFiles((f) => f.map((x) => (x.id === localId ? { ...x, state: 'error', error: e instanceof Error ? e.message : 'Upload failed' } : x)));
    }
  }, [ensureOrder]);

  const importDropbox = useCallback(async (links: string[]) => {
    const oid = await ensureOrder();
    if (!oid) return;
    setDropboxBusy(true);
    setBanner(null);
    try {
      const res = await fetch(`/api/orders/${oid}/import-dropbox`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ links }),
      });
      const data = await res.json();
      for (const r of data?.results ?? []) {
        if (r.ok) {
          setFiles((f) => [...f, { id: r.file_id!, name: r.name ?? 'Dropbox file', mime: 'application/pdf', size: 0, page_count: r.page_count ?? 1, source: 'dropbox', state: 'ready' }]);
        } else {
          setBanner(`Dropbox import failed: ${r.error}`);
        }
      }
    } finally {
      setDropboxBusy(false);
      setDropboxLink('');
    }
  }, [ensureOrder]);

  const openDropboxChooser = useCallback(() => {
    const appKey = process.env.NEXT_PUBLIC_DROPBOX_APP_KEY;
    const cb = (result: Array<{ link: string; name: string }> | null) => {
      if (result && result.length) importDropbox(result.map((r) => r.link));
    };
    const w = window as unknown as { Dropbox?: { choose: (o: object) => void } };
    const launch = () => w.Dropbox?.choose({ success: cb, linkType: 'direct', multiselect: true, extensions: ['.pdf', '.doc', '.docx', '.jpg', '.jpeg', '.png'] });
    if (w.Dropbox) return launch();
    const s = document.createElement('script');
    s.src = 'https://www.dropbox.com/static/api/2/chooser.js';
    s.id = 'dropbox-chooser';
    s.setAttribute('data-app-key', appKey!);
    document.body.appendChild(s);
    s.onload = launch;
  }, [importDropbox]);

  const buildItems = useCallback(() => {
    const ready = files.filter((f) => f.state === 'ready');
    const items: Array<Record<string, unknown>> = [];
    for (const f of ready) {
      const pages = f.page_count ?? 1;
      if (service === 'bind') {
        items.push({ file_id: f.id, service: 'bind', option: bindingMain, copies, pages: 1 });
        continue;
      }
      if (service === 'laminate') {
        items.push({ file_id: f.id, service: 'laminate', paper_size: size, copies, pages });
        continue;
      }
      items.push({
        file_id: f.id, service,
        paper_size: size, color, sides: service === 'scan' ? null : sides, paper_gsm: service === 'scan' ? null : gsm,
        copies, pages,
      });
      if ((service === 'print' || service === 'photocopy') && binding !== 'none') {
        items.push({ file_id: f.id, service: 'bind', option: binding, copies, pages: 1 });
      }
      if ((service === 'print' || service === 'photocopy') && lamination) {
        items.push({ file_id: f.id, service: 'laminate', paper_size: size, copies, pages });
      }
    }
    return items;
  }, [files, service, copies, color, sides, gsm, size, binding, lamination, bindingMain]);

  const pushItems = useCallback(async () => {
    const oid = await ensureOrder();
    if (!oid) return false;
    const items = buildItems();
    const res = await fetch(`/api/orders/${oid}/items`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setBanner(data?.error?.message ?? 'Could not save items');
      return false;
    }
    return true;
  }, [buildItems, ensureOrder]);

  const loadQuote = useCallback(async () => {
    if (!orderId) return;
    const res = await fetch(`/api/orders/${orderId}/quote`, { cache: 'no-store' });
    if (res.ok) setQuote(await res.json());
  }, [orderId]);

  // refresh quote when arriving at checkout
  useEffect(() => { if (step === 'checkout') loadQuote(); }, [step, loadQuote, rush]);

  const totalPages = useMemo(() => files.filter((f) => f.state === 'ready').reduce((a, f) => a + (f.page_count ?? 1), 0), [files]);
  const readyCount = files.filter((f) => f.state === 'ready').length;
  const hasDropboxChooser = !!process.env.NEXT_PUBLIC_DROPBOX_APP_KEY;

  const submitPayment = useCallback(async () => {
    if (!orderId) return;
    setBusy(true);
    setBanner(null);
    try {
      const ok = await pushItems();
      if (!ok) return;
      const contactOk = name.trim().length > 0 && phone.replace(/\D/g, '').length >= 8;
      if (!contactOk) { setBanner('Please enter your name and a valid phone number'); return; }
      const res = await fetch(`/api/orders/${orderId}/pay`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method, customer_name: name.trim(), customer_phone: phone.trim(), customer_email: email.trim(), notes: notes.trim(), rush }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setBanner(data?.error?.message ?? 'Could not place order'); return; }
      if (data.mode === 'cod') {
        router.push(`/track/${orderId}`);
        return;
      }
      setUpi(data);
      setStep('upi');
      try { setQrDataUrl(await QRCode.toDataURL(data.link, { width: 560, margin: 1, errorCorrectionLevel: 'M' })); } catch { setQrDataUrl(null); }
      setSecondsLeft(300);
    } finally {
      setBusy(false);
    }
  }, [orderId, pushItems, name, phone, email, notes, method, rush, router]);

  useEffect(() => {
    if (step !== 'upi') return;
    const t = setInterval(() => setSecondsLeft((s) => (s > 0 ? s - 1 : 0)), 1000);
    return () => clearInterval(t);
  }, [step]);

  const confirmPaid = useCallback(async () => {
    if (!orderId) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/orders/${orderId}/payment-submitted`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ utr: utr.trim() || undefined }),
      });
      if (res.ok) router.push(`/track/${orderId}`);
      else { const d = await res.json().catch(() => ({})); setBanner(d?.error?.message ?? 'Something went wrong'); }
    } finally { setBusy(false); }
  }, [orderId, utr, router]);

  /* ---------- render ---------- */
  const stepIndex = { service: 0, files: 1, options: 2, checkout: 3, upi: 4 }[step];
  const shopName = shopData?.shop.name ?? '…';

  return (
    <div className="min-h-screen bg-[radial-gradient(1200px_600px_at_50%_-10%,#ffedd5,transparent)]">
      <header className="max-w-lg mx-auto px-4 h-14 flex items-center justify-between no-print">
        {step === 'service' ? <Logo /> : (
          <button onClick={() => { const prev: Record<Step, Step | null> = { service: null, files: 'service', options: 'files', checkout: 'options', upi: null }; const p = prev[step]; if (p) setStep(p); }} className="p-2 -ml-2 text-neutral-500"><ChevronLeft size={22} /></button>
        )}
        <span className="text-xs font-semibold text-neutral-500 max-w-[60%] truncate">{shopName}</span>
      </header>

      {/* progress dots */}
      <div className="max-w-lg mx-auto px-4 flex items-center gap-1.5 mt-1">
        {['Service', 'Files', 'Options', 'Pay'].map((label, i) => (
          <div key={label} className="flex items-center gap-1.5 flex-1">
            <div className={cn('h-1.5 rounded-full flex-1 transition-colors', i <= Math.min(stepIndex, 3) ? 'bg-orange-600' : 'bg-neutral-200')} />
          </div>
        ))}
      </div>

      {banner && (
        <div className="max-w-lg mx-auto px-4 mt-3">
          <div className="rounded-xl bg-red-50 border border-red-200 text-red-800 text-sm px-4 py-2.5 flex items-start gap-2"><XCircle size={16} className="mt-0.5 shrink-0" />{banner}<button onClick={() => setBanner(null)} className="ml-auto text-red-400">✕</button></div>
        </div>
      )}

      <main className="max-w-lg mx-auto px-4 mt-4 pb-20">
        {/* STEP 1 — service */}
        {step === 'service' && (
          <section>
            <h1 className="text-2xl font-extrabold tracking-tight">What do you need?</h1>
            <p className="text-sm text-neutral-500 mt-1">Pick a service to get started.</p>
            <div className="grid grid-cols-2 gap-3 mt-5">
              {(Object.keys(SERVICE_META) as Service[])
                .filter((s) => !shopData || shopData.services.length === 0 || shopData.services.some((x) => x.service === s && x.enabled))
                .map((s) => {
                  const M = SERVICE_META[s];
                  const Icon = M.icon;
                  const activeSel = service === s;
                  return (
                    <button key={s} onClick={() => setService(s)} className={cn('card p-4 text-left transition-all border-2', activeSel ? 'border-orange-600 ring-2 ring-orange-600/20' : 'border-transparent')}>
                      <Icon size={26} className="text-orange-700" />
                      <div className="mt-2 font-bold">{M.label}</div>
                      <div className="text-[11px] text-neutral-500">{M.blurb}</div>
                    </button>
                  );
                })}
            </div>
            <button onClick={async () => { await ensureOrder(); setStep('files'); }} className="btn btn-primary w-full h-13 py-4 text-lg mt-6">Continue</button>
          </section>
        )}

        {/* STEP 2 — files */}
        {step === 'files' && (
          <section>
            <h1 className="text-2xl font-extrabold tracking-tight">Add your files</h1>
            <p className="text-sm text-neutral-500 mt-1">PDF, Word or images · max 25 MB each · up to 10 files</p>

            <input ref={fileInput} type="file" multiple accept=".pdf,.doc,.docx,.jpg,.jpeg,.png,application/pdf,image/*" className="hidden"
              onChange={(e) => { Array.from(e.target.files ?? []).forEach(uploadOne); e.target.value = ''; }} />

            <button onClick={() => fileInput.current?.click()} className="mt-5 w-full rounded-2xl border-2 border-dashed border-orange-300 bg-orange-50/60 hover:bg-orange-50 transition-colors py-10 grid place-items-center">
              <UploadCloud size={36} className="text-orange-600" />
              <span className="mt-2 font-bold text-orange-900">Tap to upload from device</span>
              <span className="text-xs text-orange-800/60 mt-1">Gallery, Drive downloads, file manager…</span>
            </button>

            {/* Dropbox import */}
            <div className="mt-3 card p-3">
              <div className="flex items-center gap-2 text-sm font-bold text-neutral-700"><FolderInput size={16} /> Import from Dropbox</div>
              <div className="mt-2 flex gap-2">
                <input value={dropboxLink} onChange={(e) => setDropboxLink(e.target.value)} placeholder="Paste a Dropbox share link…" className="input h-11 flex-1 text-sm" inputMode="url" />
                <button onClick={() => importDropbox([dropboxLink.trim()])} disabled={dropboxBusy || !dropboxLink.trim()} className="btn btn-dark h-11 px-4 text-sm">
                  {dropboxBusy ? <Loader2 size={16} className="animate-spin" /> : 'Add'}
                </button>
              </div>
              {hasDropboxChooser && (
                <button onClick={openDropboxChooser} className="mt-2 text-xs text-blue-700 font-semibold hover:underline flex items-center gap-1"><Link2 size={12} /> Browse my Dropbox…</button>
              )}
              <p className="mt-1.5 text-[11px] text-neutral-400">Link must allow anyone with the link to view — we copy the file to the shop, then it never leaves their counter.</p>
            </div>

            {/* file list */}
            <ul className="mt-4 space-y-2">
              {files.map((f) => (
                <li key={f.id} className="card px-4 py-3 flex items-center gap-3">
                  <FileText size={22} className="text-neutral-500 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold truncate">{f.name}</div>
                    <div className="text-[11px] text-neutral-400">
                      {f.state === 'uploading' && 'Uploading…'}
                      {f.state === 'ready' && `${f.page_count ?? '?'} page${(f.page_count ?? 1) > 1 ? 's' : ''} · ${f.source === 'dropbox' ? 'from Dropbox' : 'uploaded'}`}
                      {f.state === 'error' && <span className="text-red-600">{f.error}</span>}
                    </div>
                  </div>
                  {f.state === 'uploading' && <Loader2 size={18} className="animate-spin text-orange-600 shrink-0" />}
                  {f.state === 'ready' && <CheckCircle2 size={18} className="text-green-600 shrink-0" />}
                  <button onClick={() => setFiles((all) => all.filter((x) => x.id !== f.id))} className="p-2 text-neutral-400 hover:text-red-600"><Trash2 size={17} /></button>
                </li>
              ))}
            </ul>

            <button disabled={readyCount === 0} onClick={async () => { const ok = await pushItems(); if (ok) setStep('options'); }} className="btn btn-primary w-full py-4 text-lg mt-6">
              Continue {readyCount > 0 && `· ${totalPages} page${totalPages !== 1 ? 's' : ''}`}
            </button>
          </section>
        )}

        {/* STEP 3 — options */}
        {step === 'options' && (
          <section>
            <h1 className="text-2xl font-extrabold tracking-tight">Options</h1>
            <p className="text-sm text-neutral-500 mt-1">Applied to all {readyCount} file{readyCount !== 1 ? 's' : ''} · {totalPages} total pages</p>

            <div className="card mt-5 p-4 space-y-5">
              {/* copies */}
              <div className="flex items-center justify-between">
                <div><div className="font-semibold text-sm">Copies</div><div className="text-[11px] text-neutral-400">Sets to print</div></div>
                <div className="flex items-center gap-3">
                  <button className="w-9 h-9 rounded-lg bg-neutral-100 font-bold text-lg" onClick={() => setCopies(Math.max(1, copies - 1))}>−</button>
                  <span className="w-8 text-center font-extrabold text-lg">{copies}</span>
                  <button className="w-9 h-9 rounded-lg bg-neutral-100 font-bold text-lg" onClick={() => setCopies(Math.min(99, copies + 1))}>+</button>
                </div>
              </div>

              {service !== 'bind' && service !== 'laminate' && (
                <>
                  {/* color */}
                  <div>
                    <label className="label">Colour</label>
                    <div className="grid grid-cols-2 gap-2">
                      {(['bw', 'color'] as const).map((c) => (
                        <button key={c} onClick={() => setColor(c)} className={cn('h-11 rounded-xl border-2 font-semibold text-sm', color === c ? 'border-orange-600 bg-orange-50 text-orange-900' : 'border-neutral-200')}>{c === 'bw' ? 'Black & White' : 'Colour'}</button>
                      ))}
                    </div>
                  </div>
                  {/* size */}
                  <div>
                    <label className="label">Paper size</label>
                    <div className="grid grid-cols-4 gap-2">
                      {(['A4', 'A3', 'A5', 'Legal'] as const).map((s) => (
                        <button key={s} onClick={() => setSize(s)} className={cn('h-11 rounded-xl border-2 font-semibold text-sm', size === s ? 'border-orange-600 bg-orange-50 text-orange-900' : 'border-neutral-200')}>{s}</button>
                      ))}
                    </div>
                  </div>
                  {service !== 'scan' && (
                    <>
                      {/* sides */}
                      <div>
                        <label className="label">Sides</label>
                        <div className="grid grid-cols-2 gap-2">
                          {(['single', 'duplex'] as const).map((s) => (
                            <button key={s} onClick={() => setSides(s)} className={cn('h-11 rounded-xl border-2 font-semibold text-sm capitalize', sides === s ? 'border-orange-600 bg-orange-50 text-orange-900' : 'border-neutral-200')}>{s === 'single' ? 'Single side' : 'Double (duplex)'}</button>
                          ))}
                        </div>
                      </div>
                      {/* gsm */}
                      <div>
                        <label className="label">Paper quality</label>
                        <select value={gsm} onChange={(e) => setGsm(Number(e.target.value))} className="input">
                          {[70, 75, 80, 90, 100].map((g) => <option key={g} value={g}>{g} GSM{g === 80 ? ' (standard)' : g >= 90 ? ' (thick)' : ''}</option>)}
                        </select>
                      </div>
                    </>
                  )}
                  {/* add-ons for print/photocopy */}
                  {(service === 'print' || service === 'photocopy') && (
                    <>
                      <div>
                        <label className="label">Binding (add-on)</label>
                        <div className="grid grid-cols-4 gap-2">
                          {(['none', 'staple', 'spiral', 'hard'] as const).map((b) => (
                            <button key={b} onClick={() => setBinding(b)} className={cn('h-11 rounded-xl border-2 font-semibold text-xs capitalize', binding === b ? 'border-orange-600 bg-orange-50 text-orange-900' : 'border-neutral-200')}>{b}</button>
                          ))}
                        </div>
                      </div>
                      <button onClick={() => setLamination(!lamination)} className={cn('w-full flex items-center justify-between rounded-xl border-2 px-4 py-3 text-left', lamination ? 'border-orange-600 bg-orange-50' : 'border-neutral-200')}>
                        <span><span className="font-semibold text-sm">Add lamination</span><br /><span className="text-[11px] text-neutral-500">Every sheet, both sides</span></span>
                        <span className={cn('w-6 h-6 rounded-md border-2 grid place-items-center', lamination ? 'bg-orange-600 border-orange-600 text-white' : 'border-neutral-300')}>{lamination && '✓'}</span>
                      </button>
                    </>
                  )}
                </>
              )}

              {/* bind as service — choose type */}
              {service === 'bind' && (
                <div>
                  <label className="label">Binding type</label>
                  <div className="grid grid-cols-3 gap-2">
                    {(['staple', 'spiral', 'hard'] as const).map((b) => (
                      <button key={b} onClick={() => setBindingMain(b)} className={cn('h-12 rounded-xl border-2 font-semibold text-sm capitalize', bindingMain === b ? 'border-orange-600 bg-orange-50 text-orange-900' : 'border-neutral-200')}>{b === 'hard' ? 'Hard cover' : b}</button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <button onClick={async () => { const ok = await pushItems(); if (ok) setStep('checkout'); }} className="btn btn-primary w-full py-4 text-lg mt-6">Continue to payment</button>
          </section>
        )}

        {/* STEP 4 — checkout */}
        {step === 'checkout' && (
          <section>
            <h1 className="text-2xl font-extrabold tracking-tight">Almost there</h1>
            <p className="text-sm text-neutral-500 mt-1">Where do we send the token?</p>

            <div className="card mt-4 p-4 space-y-3">
              <div><label className="label">Your name *</label><input value={name} onChange={(e) => setName(e.target.value)} className="input" placeholder="e.g. Aisha Khan" autoComplete="name" /></div>
              <div><label className="label">Phone *</label><input value={phone} onChange={(e) => setPhone(e.target.value)} className="input" placeholder="97970 00000" inputMode="numeric" autoComplete="tel" /></div>
              <div><label className="label">Email (for the receipt)</label><input value={email} onChange={(e) => setEmail(e.target.value)} className="input" placeholder="you@example.com" inputMode="email" type="email" /></div>
              <div><label className="label">Notes for the shop</label><input value={notes} onChange={(e) => setNotes(e.target.value)} className="input" placeholder="e.g. double-sided, spiral on left edge…" /></div>
            </div>

            {/* rush */}
            <button onClick={() => setRush(!rush)} className={cn('w-full mt-3 flex items-center justify-between rounded-xl border-2 px-4 py-3 text-left', rush ? 'border-orange-600 bg-orange-50' : 'border-neutral-200 bg-white')}>
              <span><span className="font-semibold text-sm flex items-center gap-1.5"><Zap size={14} className="text-orange-600" />Rush order (+10%)</span><br /><span className="text-[11px] text-neutral-500">Shop prioritises you in the queue</span></span>
              <span className={cn('w-6 h-6 rounded-md border-2 grid place-items-center', rush ? 'bg-orange-600 border-orange-600 text-white' : 'border-neutral-300')}>{rush && '✓'}</span>
            </button>

            {/* order summary */}
            {quote && (
              <div className="card mt-3 p-4 text-sm">
                <div className="flex items-center justify-between font-bold"><span>Order summary</span><span>{readyCount} file{readyCount !== 1 ? 's' : ''}</span></div>
                <ul className="mt-2 space-y-1 text-neutral-600">
                  {quote.quote.lines.map((l, i) => (
                    <li key={i} className="flex justify-between gap-4"><span className="truncate">{l.description}</span><span className="tabular-nums">{formatPaise(l.lineTotalPaise)}</span></li>
                  ))}
                </ul>
                <div className="border-t border-neutral-100 mt-2 pt-2 space-y-1 text-neutral-600">
                  <div className="flex justify-between"><span>Subtotal</span><span className="tabular-nums">{formatPaise(quote.quote.subtotalPaise)}</span></div>
                  {quote.quote.rushFeePaise > 0 && <div className="flex justify-between"><span>Rush fee</span><span className="tabular-nums">{formatPaise(quote.quote.rushFeePaise)}</span></div>}
                  <div className="flex justify-between"><span>GST (incl.)</span><span className="tabular-nums">{formatPaise(quote.quote.taxPaise)}</span></div>
                </div>
                <div className="border-t border-neutral-200 mt-2 pt-2 flex justify-between items-baseline">
                  <span className="font-extrabold">Total payable</span>
                  <span className="text-2xl font-extrabold tabular-nums text-orange-700">{formatPaiseExact(quote.quote.totalPaise)}</span>
                </div>
              </div>
            )}

            {/* method tabs */}
            <div className="grid grid-cols-2 gap-2 mt-3">
              {(['upi', 'cod'] as const).map((m) => (
                <button key={m} onClick={() => setMethod(m)} className={cn('h-12 rounded-xl border-2 font-bold text-sm flex items-center justify-center gap-2', method === m ? 'border-orange-600 bg-orange-50 text-orange-900' : 'border-neutral-200 bg-white')}>
                  {m === 'upi' ? <><Wallet size={16} /> UPI · Pay now</> : <><Banknote size={16} /> Cash at counter</>}
                </button>
              ))}
            </div>

            <button disabled={busy} onClick={submitPayment} className="btn btn-primary w-full py-4 text-lg mt-4">
              {busy ? <Loader2 size={20} className="animate-spin" /> : method === 'upi' ? 'Proceed to pay' : 'Place order (Cash on collection)'}
            </button>
            <p className="mt-2 text-center text-[11px] text-neutral-400 flex items-center justify-center gap-1"><ShieldCheck size={12} /> Payment goes directly to the shop’s UPI · Printly never holds your money</p>
          </section>
        )}

        {/* STEP 5 — UPI gateway-styled screen */}
        {step === 'upi' && upi && (
          <section className="-mt-1">
            <div className="rounded-3xl overflow-hidden shadow-2xl">
              <div className="bg-neutral-950 text-white px-6 pt-6 pb-5 text-center relative">
                <div className="text-[10px] uppercase tracking-[0.2em] text-neutral-400">Secure UPI checkout</div>
                <div className="mt-1 text-sm text-neutral-300">Paying to</div>
                <div className="text-xl font-extrabold tracking-tight">{upi.shop_name}</div>
                <div className="mt-3 text-5xl font-black tabular-nums tracking-tight">₹{(upi.total_paise / 100).toFixed(2)}</div>
                <div className="mt-1 text-[11px] text-neutral-500">Amount locked for this order · cannot be changed</div>
                <div className="absolute top-4 right-4 text-right">
                  <div className="text-[10px] text-neutral-500 uppercase">Expires</div>
                  <div className="font-mono font-bold text-orange-400">{String(Math.floor(secondsLeft / 60)).padStart(2, '0')}:{String(secondsLeft % 60).padStart(2, '0')}</div>
                </div>
              </div>

              <div className="bg-white px-6 py-6 text-center border-x border-neutral-100">
                {qrDataUrl
                  ? <img src={qrDataUrl} alt="UPI QR" className="w-56 h-56 mx-auto rounded-2xl border border-neutral-200" />
                  : <div className="w-56 h-56 mx-auto skeleton" />}
                <div className="mt-3 text-xs text-neutral-500">Scan with any UPI app</div>
                <div className="mt-1 flex items-center justify-center gap-4 text-[10px] font-bold text-neutral-400">
                  <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-blue-600 inline-block" />GPay</span>
                  <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-purple-600 inline-block" />PhonePe</span>
                  <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-sky-500 inline-block" />Paytm</span>
                  <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-green-600 inline-block" />BHIM</span>
                </div>
                <a href={upi.link} className="btn btn-dark w-full h-12 mt-4"><Smartphone size={17} /> Open UPI app & pay</a>
                <div className="mt-2 text-[11px] font-mono text-neutral-400 break-all">{upi.pa}</div>
              </div>

              <div className="bg-neutral-50 border border-neutral-100 px-6 py-5 rounded-b-3xl">
                <label className="label">UPI reference / UTR (optional)</label>
                <input value={utr} onChange={(e) => setUtr(e.target.value)} className="input text-center font-mono tracking-wider" placeholder="e.g. 426178900123" inputMode="numeric" />
                <button disabled={busy} onClick={confirmPaid} className="btn btn-primary w-full h-13 py-4 text-lg mt-3">
                  {busy ? <Loader2 size={20} className="animate-spin" /> : <>I&apos;ve paid ₹{(upi.total_paise / 100).toFixed(2)}</>}
                </button>
                <p className="mt-2 text-center text-[10px] text-neutral-400">The shop confirms your payment, then your order enters the print queue. Keep this screen open.</p>
              </div>
            </div>
            <button onClick={() => router.push(`/track/${orderId}`)} className="w-full text-center text-sm text-neutral-500 mt-4 hover:underline">I paid — take me to tracking</button>
          </section>
        )}
      </main>
    </div>
  );
}
