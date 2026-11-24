'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import QRCode from 'qrcode';
import {
  Printer, Copy, ScanLine, BookOpen, Layers, UploadCloud, FileText, Loader2, CheckCircle2, XCircle,
  ChevronLeft, ShieldCheck, Smartphone, Banknote, Link2, FolderInput, Trash2, Zap, Wallet, Eye, RefreshCw,
} from 'lucide-react';
import { Logo } from '@/components/Logo';
import { CustomerLanguagePicker } from '@/components/CustomerLanguagePicker';
import { useCustomerLanguage } from '@/lib/customer-language';
import { BrandedQr } from '@/components/BrandedQr';
import { BrandMark } from '@/components/BrandArtwork';
import { DocumentEditor } from '@/components/DocumentEditor';
import { paymentQrPlan } from '@/lib/payment-qr';
import { fileMime, isPreviewable, isWord, MAX_DOCUMENT_BYTES, MAX_DOCUMENT_PAGES } from '@/lib/document-shared';
import { createBrowserSupabase } from '@/lib/supabase-client';
import { createResumableTransfer, type ResumableTransfer } from '@/lib/resumable-upload';
import { cn } from '@/lib/utils';
import { formatPaiseExact } from '@/lib/format';
import { duplexSheets } from '@/lib/duplex';
import { rateUnitLabel } from '@/lib/rate-display';
import { rememberCheckout, rememberedCheckout, forgetCheckout, type PendingCheckout } from '@/lib/checkout-recovery-client';
import type { Quote } from '@/lib/pricing';

type Service = 'print' | 'photocopy' | 'scan' | 'bind' | 'laminate';
type Step = 'service' | 'files' | 'options' | 'checkout' | 'recovery' | 'upi';

interface UploadedFile {
  id: string;
  name: string;
  mime: string;
  size: number;
  page_count: number | null;
  source: 'upload' | 'dropbox';
  state: 'uploading' | 'verifying' | 'ready' | 'removing' | 'error';
  progress?: number;
  transferComplete?: boolean;
  removalFailed?: boolean;
  mustRemove?: boolean;
  error?: string;
  localFile?: File;
  pendingId?: string;
  pendingPath?: string;
}
interface ShopPublic {
  shop: { slug: string; name: string; city: string; upi_id: string | null; eta_minutes: number; rating_avg: number; rating_count: number; status: string; is_open: boolean };
  accepting_orders: boolean;
  services: { service: string; enabled: boolean }[];
}
interface QuoteResp { quote: Quote; rush: boolean; quote_token: string }
interface UpiData { link: string; pa: string; pn: string; am: string; tn: string; shop_name: string; total_paise: number }

const SERVICE_META: Record<Service, { label: string; icon: typeof Printer; blurb: string }> = {
  print: { label: 'Print', icon: Printer, blurb: 'PDF / Word / images' },
  photocopy: { label: 'Photocopy', icon: Copy, blurb: 'Class notes & forms' },
  scan: { label: 'Scan', icon: ScanLine, blurb: 'Physical → digital' },
  bind: { label: 'Binding', icon: BookOpen, blurb: 'Staple / spiral / hard' },
  laminate: { label: 'Lamination', icon: Layers, blurb: 'Cards & certificates' },
};

export default function OrderWizard() {
  const { slug } = useParams<{ slug: string }>();
  // A shop change starts a separate wizard; never carry a draft to another shop.
  return <OrderWizardForShop key={slug} slug={slug} />;
}

function OrderWizardForShop({ slug }: { slug: string }) {
  const { language, setLanguage, t } = useCustomerLanguage();
  const router = useRouter();
  const [shopData, setShopData] = useState<ShopPublic | null>(null);
  const [step, setStep] = useState<Step>('service');
  const [service, setService] = useState<Service | null>(null);
  const [shopLoading, setShopLoading] = useState(true);
  const [orderId, setOrderId] = useState<string | null>(null);
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [editingFile, setEditingFile] = useState<UploadedFile | null>(null);
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
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [quoteRefresh, setQuoteRefresh] = useState(0);
  const checkoutInFlight = useRef(false);
  // An ambiguous checkout response must remain retryable even if the shop closes.
  const [recoveryPossible, setRecoveryPossible] = useState(false);
  const [recoveryChecked, setRecoveryChecked] = useState(false);
  const [savedCheckout, setSavedCheckout] = useState<PendingCheckout | null>(null);
  const [recoverySaved, setRecoverySaved] = useState(true);
  const checkoutRetry = useRef<{ method: 'upi' | 'cod'; customer_name: string; customer_phone: string; customer_email: string; notes: string; rush: boolean; quote_token: string } | null>(null);

  // upi screen
  const [upi, setUpi] = useState<UpiData | null>(null);
  const [recoveredUpi, setRecoveredUpi] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [qrBrandInside, setQrBrandInside] = useState(true);
  const [qrFailed, setQrFailed] = useState(false);
  const [utr, setUtr] = useState('');

  const fileInput = useRef<HTMLInputElement>(null);
  // Refs, not rendered state, coordinate simultaneous calls before React rerenders.
  const draft = useRef<{ slug: string; id: string | null; pending: Promise<string | null> | null }>({ slug, id: null, pending: null });
  const importingDropbox = useRef(false);
  const transfers = useRef(new Map<string, { transfer: ResumableTransfer; fileId: string; path: string; uploaded: boolean }>());
  const cancelledTransfers = useRef(new Set<string>());
  const activeTransfers = useRef(new Set<string>());
  const uploadGeneration = useRef(0);
  if (draft.current.slug !== slug) draft.current = { slug, id: null, pending: null };
  useEffect(() => {
    const current = transfers.current;
    return () => {
      // An order/presign request may still be pending when this wizard unmounts.
      // Its eventual response must not start an invisible transfer or finalize.
      uploadGeneration.current++;
      for (const attempt of current.values()) void attempt.transfer.abort().catch(() => {});
      current.clear();
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setShopLoading(true);
    setShopData(null);
    setService(null);
    setOrderId(null);
    setFiles([]);
    setEditingFile(null);
    setStep('service');
    fetch(`/api/shops/${encodeURIComponent(slug)}/public`, { signal: controller.signal })
      .then((r) => { if (!r.ok) throw new Error('Shop unavailable'); return r.json(); })
      .then(setShopData)
      .catch(() => { if (!controller.signal.aborted) setBanner('Could not load this shop. Please check the link and try again.'); })
      .finally(() => { if (!controller.signal.aborted) setShopLoading(false); });
    return () => controller.abort();
  }, [slug]);

  // A reload can recover an already-started checkout without retaining the
  // customer's contact details. This lookup never creates a new payment.
  useEffect(() => {
    const saved = rememberedCheckout(slug);
    if (saved) { setSavedCheckout(saved); setOrderId(saved.order_id); setStep('recovery'); }
    setRecoveryChecked(true);
  }, [slug]);

  // An already-open wizard refreshes the owner's setting without disturbing the
  // draft or an in-progress UPI screen. The database remains authoritative.
  useEffect(() => {
    let live = true;
    let sequence = 0;
    const refreshAvailability = async () => {
      if (document.visibilityState !== 'visible') return;
      const current = ++sequence;
      try {
        const response = await fetch(`/api/shops/${encodeURIComponent(slug)}/public`, { cache: 'no-store' });
        if (!response.ok) return;
        const next = await response.json() as ShopPublic;
        if (live && current === sequence && typeof next?.accepting_orders === 'boolean' && typeof next?.shop?.is_open === 'boolean') setShopData(next);
      } catch { /* The order API still checks availability on every checkout. */ }
    };
    const timer = window.setInterval(() => void refreshAvailability(), 30_000);
    document.addEventListener('visibilitychange', refreshAvailability);
    return () => { live = false; window.clearInterval(timer); document.removeEventListener('visibilitychange', refreshAvailability); };
  }, [slug]);

  const markClosed = useCallback(() => {
    setShopData((current) => current ? { ...current, accepting_orders: false, shop: { ...current.shop, is_open: false } } : current);
  }, []);

  const ensureOrder = useCallback((): Promise<string | null> => {
    const current = draft.current;
    if (current.id) return Promise.resolve(current.id);
    if (current.pending) return current.pending;
    const pending = (async () => {
      try {
        const res = await fetch('/api/orders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ shop_slug: slug }) });
        const data = await res.json().catch(() => ({}));
        if (draft.current !== current) return null;
        if (!res.ok || typeof data.order_id !== 'string') { if (data?.error?.code === 'shop_closed') markClosed(); setBanner(data?.error?.message ?? 'Could not start order'); return null; }
        current.id = data.order_id;
        setOrderId(data.order_id);
        return data.order_id;
      } finally { current.pending = null; }
    })();
    current.pending = pending;
    return pending;
  }, [slug, markClosed]);

  const removeUpload = useCallback(async (oid: string, fileId: string, path?: string) => {
    const response = await fetch(`/api/orders/${oid}/files/${fileId}`, {
      method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(path ? { path } : {}),
    });
    if (!response.ok) {
      const result = await response.json().catch(() => ({}));
      throw new Error(result?.error?.message ?? 'Could not remove this file. Please retry.');
    }
  }, []);

  const uploadOne = useCallback(async (file: File, retry?: UploadedFile) => {
    const localId = retry?.id ?? crypto.randomUUID();
    if (activeTransfers.current.has(localId)) return;
    activeTransfers.current.add(localId);
    const generation = uploadGeneration.current;
    const stopped = () => uploadGeneration.current !== generation || cancelledTransfers.current.has(localId);
    const mime = fileMime(file.name, file.type || 'application/octet-stream');
    cancelledTransfers.current.delete(localId);
    if (retry) setFiles((all) => all.map((entry) => entry.id === localId ? { ...entry, state: 'uploading', error: undefined } : entry));
    else setFiles((all) => [...all, { id: localId, name: file.name, mime, size: file.size, page_count: null, source: 'upload', state: 'uploading', progress: 0, localFile: file }]);
    let pendingId = retry?.pendingId;
    let pendingPath = retry?.pendingPath;
    let mustRemove = false;
    try {
      const oid = await ensureOrder();
      if (stopped()) return;
      if (!oid) throw new Error('Could not start the order. Please try again.');
      if (!isPreviewable(mime) && !isWord(mime)) throw new Error('Only PDF, Word, JPEG and PNG files are supported.');
      if (!file.size || file.size > MAX_DOCUMENT_BYTES) throw new Error('File must be non-empty and no larger than 25 MB.');
      let attempt = transfers.current.get(localId);
      if (!attempt) {
        // Never abandon a known pending path if setup failed before the
        // resumable transfer was created. Tombstone and clean it first.
        if (pendingId && pendingPath) {
          await removeUpload(oid, pendingId, pendingPath);
          if (stopped()) return;
          pendingId = undefined; pendingPath = undefined;
        }
        // A retry after an interrupted transfer reuses its existing path and
        // token. Only a new attempt obtains another signed link.
        const presign = await fetch(`/api/orders/${oid}/files`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: file.name, mime, size: file.size }),
        });
        const pdata = await presign.json().catch(() => ({}));
        if (stopped()) return;
        if (!presign.ok || typeof pdata.file_id !== 'string' || typeof pdata.path !== 'string' || typeof pdata.token !== 'string') throw new Error(pdata?.error?.message ?? 'Upload rejected');
        pendingId = pdata.file_id; pendingPath = pdata.path;
        setFiles((all) => all.map((entry) => entry.id === localId ? { ...entry, pendingId, pendingPath } : entry));
        const transfer = createResumableTransfer({ file, mime, path: pdata.path, token: pdata.token, onProgress: (sent, total) => {
          if (stopped()) return;
          const progress = total > 0 ? Math.min(100, Math.floor(sent * 100 / total)) : 0;
          setFiles((all) => all.map((entry) => entry.id === localId && entry.state === 'uploading' && entry.progress !== progress ? { ...entry, progress } : entry));
        } });
        attempt = { transfer, fileId: pdata.file_id, path: pdata.path, uploaded: false };
        transfers.current.set(localId, attempt);
      }
      pendingId = attempt.fileId; pendingPath = attempt.path;
      if (!attempt.uploaded) { await attempt.transfer.start(); attempt.uploaded = true; }
      if (stopped()) return;
      setFiles((all) => all.map((entry) => entry.id === localId ? { ...entry, progress: 100, transferComplete: true, state: 'verifying' } : entry));
      const finalize = () => fetch(`/api/orders/${oid}/files/${attempt!.fileId}/finalize`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: attempt!.path, original_name: file.name, mime }),
      });
      // Finalization is idempotent: a lost response must not create another upload.
      let fin: Response;
      try { fin = await finalize(); } catch {
        if (stopped()) return;
        fin = await finalize();
      }
      if (stopped()) return;
      const fdata = await fin.json().catch(() => ({}));
      if (!fin.ok) {
        // Validation may have tombstoned the object, but cleanup can fail.
        // Retain its ID/path until the explicit removal succeeds.
        if (fin.status === 422) mustRemove = true;
        throw new Error(fdata?.error?.message ?? 'Could not verify the file. Please retry.');
      }
      if (stopped()) return;
      transfers.current.delete(localId);
      setFiles((all) => all.map((entry) => entry.id === localId ? { ...entry, id: fdata.file_id, page_count: fdata.page_count, state: 'ready', localFile: undefined, pendingId: undefined, pendingPath: undefined } : entry));
    } catch (err) {
      if (!stopped()) setFiles((all) => all.map((entry) => entry.id === localId ? { ...entry, state: 'error', pendingId, pendingPath, mustRemove, error: err instanceof Error ? err.message : 'Upload failed' } : entry));
    } finally { activeTransfers.current.delete(localId); }
  }, [ensureOrder, removeUpload]);

  const removeFile = useCallback(async (file: UploadedFile) => {
    cancelledTransfers.current.add(file.id);
    setFiles((all) => all.map((entry) => entry.id === file.id ? { ...entry, state: 'removing' } : entry));
    try {
      const attempt = transfers.current.get(file.id);
      if (attempt) await attempt.transfer.abort();
      if (orderId && (file.state === 'ready' || file.pendingId)) await removeUpload(orderId, file.pendingId ?? file.id, file.pendingPath);
      transfers.current.delete(file.id);
      setFiles((all) => all.filter((entry) => entry.id !== file.id));
    } catch (err) {
      setBanner(err instanceof Error ? err.message : 'Could not remove this file. Please retry.');
      // The server may already have detached the file even if storage cleanup
      // failed. Keep checkout disabled until removal is successfully retried.
      setFiles((all) => all.map((entry) => entry.id === file.id ? { ...file, state: 'error', removalFailed: true, pendingId: file.pendingId ?? (file.state === 'ready' ? file.id : undefined), error: 'Removal was not completed. Please retry removal.' } : entry));
    }
  }, [orderId, removeUpload]);

  const importDropbox = useCallback(async (links: string[]) => {
    if (importingDropbox.current) return;
    const available = Math.max(0, 10 - files.length);
    if (!available) { setBanner('You can add up to 10 files.'); return; }
    if (links.length > available) setBanner(`Only ${available} more file(s) can be added.`);
    importingDropbox.current = true;
    setDropboxBusy(true);
    try {
      const oid = await ensureOrder();
      if (!oid) return;
      const res = await fetch(`/api/orders/${oid}/import-dropbox`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ links: links.slice(0, available) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error?.message ?? 'Dropbox import failed.');
      for (const r of data.results ?? []) {
        if (r.ok) {
          setFiles((all) => [...all, { id: r.file_id, name: r.name ?? 'Dropbox file', mime: r.mime, size: r.size, page_count: r.page_count, source: 'dropbox', state: 'ready' }]);
        } else setBanner(`Dropbox import failed: ${r.error}`);
      }
      setDropboxLink('');
    } catch (err) { setBanner(err instanceof Error ? err.message : 'Dropbox import failed. Please retry.'); }
    finally { importingDropbox.current = false; setDropboxBusy(false); }
  }, [ensureOrder, files.length]);

  const saveEditedFile = useCallback(async (file: UploadedFile, edited: Blob) => {
    if (!orderId) throw new Error('The order session has expired. Please start a new order.');
    const endpoint = `/api/orders/${orderId}/files/${file.id}/edit`;
    let path: string | null = null;
    try {
      const prepare = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ size: edited.size }) });
      const token = await prepare.json().catch(() => ({}));
      if (!prepare.ok) throw new Error(token?.error?.message ?? 'Could not prepare the edited file.');
      path = token.path;
      const { error } = await createBrowserSupabase().storage.from('order-files').uploadToSignedUrl(token.path, token.token, edited, { contentType: file.mime });
      if (error) throw new Error(error.message);
      const finish = () => fetch(endpoint, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: token.path, revision: token.revision }) });
      // Finalization is idempotent; retry once when the response is lost.
      let response: Response;
      try { response = await finish(); } catch { response = await finish(); }
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result?.error?.message ?? 'Could not save the edited file.');
      setFiles((all) => all.map((entry) => entry.id === file.id ? { ...entry, size: result.size ?? edited.size, page_count: result.page_count ?? entry.page_count } : entry));
      if (result.cleanup_warning) setBanner('The edited file was saved, but the previous copy could not be removed from storage. Please contact the shop.');
      path = null;
    } catch (err) {
      if (path) {
        // The edit endpoint will refuse to delete the current saved file.
        const discard = await fetch(endpoint, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path }) }).catch(() => null);
        if (discard?.status === 409) {
          setFiles((all) => all.map((entry) => entry.id === file.id ? { ...entry, size: edited.size } : entry));
          setBanner('The edited file was saved. Please reopen its preview to check it.');
          return;
        }
        if (!discard?.ok) setBanner('Could not remove an unfinished edit from storage. Please contact the shop.');
      }
      throw err;
    }
  }, [orderId]);

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
    if (!service) return [];
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
    try {
      const oid = await ensureOrder();
      if (!oid) return false;
      const res = await fetch(`/api/orders/${oid}/items`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items: buildItems() }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setBanner(data?.error?.message ?? 'Could not save items');
        return false;
      }
      return true;
    } catch { setBanner('Could not save your options. Please check your connection and retry.'); return false; }
  }, [buildItems, ensureOrder]);

  // The displayed quote must use the same rush setting and shop rate as checkout.
  useEffect(() => {
    if (step !== 'checkout' || !orderId) return;
    const controller = new AbortController();
    setQuote(null); setQuoteLoading(true);
    fetch(`/api/orders/${orderId}/quote?rush=${rush ? '1' : '0'}`, { cache: 'no-store', signal: controller.signal })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) { if (data?.error?.code === 'shop_closed') markClosed(); throw new Error(data?.error?.message ?? 'Could not calculate the total.'); }
        if (!controller.signal.aborted) setQuote(data);
      })
      .catch((err) => { if (!controller.signal.aborted) setBanner(err instanceof Error ? err.message : 'Could not calculate the total.'); })
      .finally(() => { if (!controller.signal.aborted) setQuoteLoading(false); });
    return () => controller.abort();
  }, [step, orderId, rush, quoteRefresh, markClosed]);

  const totalPages = useMemo(() => files.filter((f) => f.state === 'ready').reduce((a, f) => a + (f.page_count ?? 0), 0), [files]);
  const totalDuplexSheets = useMemo(() => files.filter((f) => f.state === 'ready').reduce((sum, f) => sum + duplexSheets(f.page_count ?? 0, copies), 0), [files, copies]);
  const readyCount = files.filter((f) => f.state === 'ready').length;
  const filesComplete = files.length > 0 && files.every((f) => f.state === 'ready' && Number.isInteger(f.page_count) && (f.page_count ?? 0) >= 1 && (f.page_count ?? 0) <= MAX_DOCUMENT_PAGES);
  const fileOperations = files.some((f) => f.state === 'uploading' || f.state === 'verifying' || f.state === 'removing');
  const hasDropboxChooser = !!process.env.NEXT_PUBLIC_DROPBOX_APP_KEY;

  const showUpi = useCallback(async (data: UpiData, recovered: boolean) => {
    setUpi(data); setRecoveredUpi(recovered); setQrDataUrl(null); setQrFailed(false); setStep('upi');
    try {
      const plan = paymentQrPlan(data.link);
      setQrBrandInside(plan.brandInside);
      setQrDataUrl(await QRCode.toDataURL(data.link, plan.options));
    } catch { setQrDataUrl(null); setQrFailed(true); }
  }, []);

  const checkPreviousCheckout = useCallback(async () => {
    if (!savedCheckout || checkoutInFlight.current) return;
    checkoutInFlight.current = true; setBusy(true); setBanner(null);
    try {
      const response = await fetch(`/api/orders/${savedCheckout.order_id}/pay/recover`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, cache: 'no-store',
        body: JSON.stringify({ method: savedCheckout.method, quote_token: savedCheckout.quote_token }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) { setBanner(data?.error?.message ?? 'Could not check the previous checkout. Please retry.'); return; }
      if (data.mode === 'placed') { router.push(`/track/${savedCheckout.order_id}`); return; }
      if (data.mode !== 'upi' || typeof data.link !== 'string') throw new Error('Invalid recovery response');
      setOrderId(savedCheckout.order_id);
      await showUpi(data as UpiData, true);
    } catch { setBanner('Could not check the previous checkout. Retry, and contact the shop before paying again if you already paid.'); }
    finally { checkoutInFlight.current = false; setBusy(false); }
  }, [savedCheckout, router, showUpi]);

  const submitPayment = useCallback(async () => {
    if (!orderId || !quote || checkoutInFlight.current) return;
    checkoutInFlight.current = true;
    setBusy(true);
    setBanner(null);
    try {
      const contactOk = name.trim().length > 0 && phone.replace(/\D/g, '').length >= 8;
      if (!contactOk) { setBanner('Please enter your name and a valid phone number'); return; }
      // A previous request can still commit after its response is lost. A
      // later 4xx does not prove that earlier attempt failed, so preserve the
      // original payload and retry capability until an outcome is recovered.
      const retryingUnconfirmed = checkoutRetry.current !== null;
      const payload = checkoutRetry.current ?? { method, customer_name: name.trim(), customer_phone: phone.trim(), customer_email: email.trim(), notes: notes.trim(), rush, quote_token: quote.quote_token };
      checkoutRetry.current = payload;
      setRecoveryPossible(true);
      const identity: PendingCheckout = { order_id: orderId, method: payload.method, quote_token: payload.quote_token };
      setSavedCheckout(identity);
      setRecoverySaved(rememberCheckout(slug, identity));
      const res = await fetch(`/api/orders/${orderId}/pay`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status < 500 && !retryingUnconfirmed) {
          checkoutRetry.current = null; setRecoveryPossible(false); setSavedCheckout(null); forgetCheckout(slug);
        }
        if (data?.error?.code === 'shop_closed') markClosed();
        setBanner(data?.error?.message ?? 'Could not place order');
        if (data?.error?.code === 'quote_changed' && !retryingUnconfirmed) { setQuote(null); setQuoteRefresh((value) => value + 1); }
        return;
      }
      if (data.mode === 'cod' || data.mode === 'placed') {
        router.push(`/track/${orderId}`);
        return;
      }
      if (data.mode !== 'upi' || typeof data.link !== 'string') throw new Error('Invalid checkout response');
      await showUpi(data as UpiData, retryingUnconfirmed);
    } catch {
      setBanner('Could not complete checkout. Retry with the same details; if you already paid, contact the shop before paying again.');
    } finally {
      checkoutInFlight.current = false;
      setBusy(false);
    }
  }, [orderId, quote, name, phone, email, notes, method, rush, router, markClosed, showUpi, slug]);

  const confirmPaid = useCallback(async () => {
    if (!orderId) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/orders/${orderId}/payment-submitted`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ utr: utr.trim() || undefined }),
      });
      if (res.ok) router.push(`/track/${orderId}`);
      else { const d = await res.json().catch(() => ({})); setBanner(d?.error?.message ?? 'Something went wrong'); }
    } catch { setBanner('Could not notify the shop. Please retry, or contact the shop if you already paid.'); }
    finally { setBusy(false); }
  }, [orderId, utr, router]);

  /* ---------- render ---------- */
  const stepIndex = { service: 0, files: 1, options: 2, checkout: 3, recovery: 3, upi: 4 }[step];
  const shopName = shopData?.shop.name ?? '…';

  return (
    <div lang={language} dir={language === 'ur' ? 'rtl' : 'ltr'} className="min-h-screen bg-[radial-gradient(1200px_600px_at_50%_-10%,#ffedd5,transparent)]">
      <header className="max-w-lg mx-auto px-4 h-14 flex items-center justify-between gap-3 no-print">
        <div className="flex min-w-0 items-center gap-1">
          {step !== 'service' && step !== 'recovery' && <button disabled={busy || (step === 'checkout' && recoveryPossible)} aria-label="Go back" onClick={() => { const prev: Record<Step, Step | null> = { service: null, files: 'service', options: 'files', checkout: 'options', recovery: null, upi: null }; const p = prev[step]; if (p) setStep(p); }} className="p-2 -ml-2 text-neutral-500 disabled:opacity-40"><ChevronLeft size={22} /></button>}
          <Logo />
        </div>
        <span className="min-w-0 flex-1 text-xs font-semibold text-neutral-500 truncate">{shopName}</span><CustomerLanguagePicker language={language} onChange={setLanguage} />
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
        {language !== 'en' && <p className="mb-3 text-xs text-neutral-600">{t.limitedTranslation}</p>}
        {step !== 'service' && step !== 'recovery' && step !== 'upi' && shopData && !shopData.accepting_orders && <p role="status" className="mb-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">{shopData.shop.is_open === false ? t.shopClosed : t.shopUnavailable} {recoveryPossible && t.shopClosedRecovery}</p>}
        {!recoveryChecked && <p role="status" className="text-sm text-neutral-600">Checking for an interrupted checkout…</p>}
        {recoveryChecked && step === 'recovery' && savedCheckout && <section className="card p-5">
          <h1 className="text-xl font-extrabold">Check your previous checkout</h1>
          <p className="mt-2 text-sm text-neutral-600">A checkout was started in this tab. Check its status before starting another order. This check cannot create a new payment, even if the shop is closed.</p>
          <p className="mt-3 rounded-xl bg-amber-50 p-3 text-xs leading-relaxed text-amber-900">If you already paid, do not pay again. Check your UPI app and contact the shop if unsure.</p>
          <button type="button" disabled={busy} onClick={() => void checkPreviousCheckout()} className="btn btn-primary mt-4 min-h-11 w-full px-4 text-sm">{busy ? <Loader2 className="animate-spin" size={16} /> : 'Check previous checkout'}</button>
          <Link href={`/track/${savedCheckout.order_id}`} className="mt-4 block text-sm font-bold text-orange-800 underline">View tracking link</Link>
          <button type="button" disabled={busy} onClick={() => {
            if (!window.confirm('The previous checkout may still complete. Check tracking or contact the shop before starting another order. Forget this checkout?')) return;
            forgetCheckout(slug); setSavedCheckout(null); setOrderId(null); setBanner(null); setStep('service');
          }} className="mt-4 text-xs font-bold text-neutral-600 underline">Forget this checkout and start a different order</button>
        </section>}
        {/* STEP 1 — service */}
        {recoveryChecked && step === 'service' && (
          <section>
            <h1 className="text-2xl font-extrabold tracking-tight">{t.whatNeed}</h1>
            <p className="text-sm text-neutral-500 mt-1">{t.pickService}</p>
            {shopLoading && <p className="mt-5 text-sm text-neutral-500" role="status">Loading services…</p>}
            {!shopLoading && shopData && !shopData.accepting_orders && <p role="status" className="mt-5 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">{shopData.shop.is_open === false ? t.shopClosed : t.shopUnavailable}</p>}
            {!shopLoading && shopData && !shopData.services.some((s) => s.enabled) && <p className="mt-5 text-sm text-neutral-500">This shop has no services available right now.</p>}
            <div className="grid grid-cols-2 gap-3 mt-5" aria-label="Choose a service">
              {(Object.keys(SERVICE_META) as Service[])
                .filter((s) => shopData?.services.some((x) => x.service === s && x.enabled))
                .map((s) => {
                  const M = SERVICE_META[s];
                  const Icon = M.icon;
                  const activeSel = service === s;
                  return (
                    <button key={s} type="button" aria-pressed={activeSel} onClick={() => setService(s)}
                      className={cn('rounded-2xl border-2 p-4 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-700', activeSel ? 'border-orange-600 bg-orange-100 ring-2 ring-orange-500/30' : 'border-neutral-200 bg-white hover:border-orange-300')}>
                      <span className="flex items-start justify-between gap-2">
                        <Icon size={26} className="text-orange-700" />
                        {activeSel && <CheckCircle2 size={20} className="text-orange-700" aria-hidden="true" />}
                      </span>
                      <div className="mt-2 font-bold">{t[s]}</div>
                      <div className="text-[11px] text-neutral-600">{M.blurb}</div>
                      {activeSel && <span className="mt-2 block text-xs font-bold text-orange-800">{t.selected}</span>}
                    </button>
                  );
                })}
            </div>
            <button disabled={!service || !shopData || !shopData.accepting_orders || busy} onClick={async () => {
              setBusy(true);
              try { if (await ensureOrder()) setStep('files'); }
              catch { setBanner('Could not start the order. Please try again.'); }
              finally { setBusy(false); }
            }} className="btn btn-primary w-full h-13 py-4 text-lg mt-6">{busy ? t.starting : t.continue}</button>
          </section>
        )}

        {/* STEP 2 — files */}
        {step === 'files' && (
          <section>
            <h1 className="text-2xl font-extrabold tracking-tight">{t.addFiles}</h1>
            <p className="text-sm text-neutral-500 mt-1">{t.fileLimit}</p>
            <p className="mt-2 text-xs text-neutral-600">{t.keepTab}</p>

            <input ref={fileInput} type="file" multiple accept=".pdf,.doc,.docx,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png" className="hidden" disabled={dropboxBusy}
              onChange={(event) => {
                const selected = Array.from(event.target.files ?? []);
                const available = Math.max(0, 10 - files.length);
                if (selected.length > available) setBanner(`Only ${available} more file(s) can be added.`);
                else setBanner(null);
                selected.slice(0, available).forEach((file) => void uploadOne(file));
                event.target.value = '';
              }} />

            <button type="button" disabled={dropboxBusy || files.length >= 10} onClick={() => fileInput.current?.click()} className="mt-5 w-full rounded-2xl border-2 border-dashed border-orange-300 bg-orange-50/60 py-10 grid place-items-center transition-colors hover:bg-orange-50 disabled:opacity-50">
              <UploadCloud size={36} className="text-orange-600" />
              <span className="mt-2 font-bold text-orange-900">{t.uploadDevice}</span>
              <span className="text-xs text-orange-800/60 mt-1">Gallery, Drive downloads, file manager…</span>
            </button>

            {/* Dropbox import */}
            <div className="mt-3 card p-3">
              <div className="flex items-center gap-2 text-sm font-bold text-neutral-700"><FolderInput size={16} /> Import from Dropbox</div>
              <div className="mt-2 flex gap-2">
                <input value={dropboxLink} onChange={(e) => setDropboxLink(e.target.value)} placeholder="Paste a Dropbox share link…" className="input h-11 min-w-0 flex-1 text-sm" inputMode="url" />
                <button onClick={() => importDropbox([dropboxLink.trim()])} disabled={dropboxBusy || fileOperations || files.length >= 10 || !dropboxLink.trim()} className="btn btn-dark h-11 px-4 text-sm">
                  {dropboxBusy ? <Loader2 size={16} className="animate-spin" /> : 'Add'}
                </button>
              </div>
              {hasDropboxChooser && (
                <button disabled={dropboxBusy || fileOperations || files.length >= 10} onClick={openDropboxChooser} className="mt-2 text-xs text-blue-700 font-semibold hover:underline flex items-center gap-1 disabled:opacity-50"><Link2 size={12} /> Browse my Dropbox…</button>
              )}
              <p className="mt-1.5 text-[11px] text-neutral-500">The link must allow viewing. We copy the file into private order storage for your shop.</p>
            </div>

            {/* file list */}
            <ul className="mt-4 space-y-2">
              {files.map((f) => (
                <li key={f.id} className="card px-4 py-3">
                  <div className="flex min-w-0 items-start gap-3">
                    <FileText size={22} className="mt-0.5 shrink-0 text-neutral-500" />
                    <div className="min-w-0 flex-1">
                      <div className="break-all text-sm font-semibold">{f.name}</div>
                      <div className="text-[11px] text-neutral-500">
                        {f.state === 'uploading' && `${t.uploading}… ${f.progress ?? 0}%`}
                        {f.state === 'verifying' && t.checking}
                        {f.state === 'removing' && t.removing}
                        {f.state === 'ready' && `${f.page_count === null ? t.pageCountNeeded : `${f.page_count} page${f.page_count !== 1 ? 's' : ''}`} · ${f.source === 'dropbox' ? 'from Dropbox' : 'uploaded'}`}
                        {f.state === 'error' && <span role="alert" className="text-red-700">{f.error}</span>}
                      </div>
                    </div>
                    {(f.state === 'uploading' || f.state === 'verifying' || f.state === 'removing') && <Loader2 size={18} className="shrink-0 animate-spin text-orange-600" />}
                    {f.state === 'ready' && <CheckCircle2 size={18} className="shrink-0 text-green-600" />}
                  </div>
                  {f.state === 'uploading' && <progress aria-label={`${t.uploading} ${f.name}`} max={100} value={f.progress ?? 0} className="mt-2 h-2 w-full accent-orange-600" />}
                  {f.state === 'ready' && isWord(f.mime) && <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                    <p>{t.wordWarning}</p>
                    <label className="mt-2 block font-bold">{t.wordPages}
                      <input type="number" min="1" max={MAX_DOCUMENT_PAGES} value={f.page_count ?? ''} placeholder="Enter page count" className="input mt-1 h-10 text-sm" onChange={(event) => {
                        const value = Number(event.target.value);
                        setFiles((all) => all.map((entry) => entry.id === f.id ? { ...entry, page_count: Number.isInteger(value) && value >= 1 && value <= MAX_DOCUMENT_PAGES ? value : null } : entry));
                      }} />
                    </label>
                  </div>}
                  <div className="mt-2 flex flex-wrap gap-2 pl-8">
                    {f.state === 'ready' && isPreviewable(f.mime) && <button type="button" onClick={() => setEditingFile(f)} className="btn btn-ghost min-h-9 px-3 text-xs"><Eye size={14} />{t.previewEdit}</button>}
                    {f.state === 'error' && f.localFile && !f.removalFailed && !f.mustRemove && <button type="button" onClick={() => void uploadOne(f.localFile!, f)} className="btn btn-ghost min-h-9 px-3 text-xs"><RefreshCw size={14} />{f.transferComplete ? t.retryCheck : t.resume}</button>}
                    {(f.state === 'ready' || f.state === 'error' || ((f.state === 'uploading' || f.state === 'verifying') && !!f.pendingId)) && <button type="button" onClick={() => void removeFile(f)} className="btn btn-ghost min-h-9 px-3 text-xs text-red-700"><Trash2 size={14} />{f.state === 'uploading' || f.state === 'verifying' ? t.cancelUpload : f.removalFailed ? t.retryRemoval : t.remove}</button>}
                  </div>
                </li>
              ))}
            </ul>
            {files.length > 0 && !filesComplete && <p className="mt-3 text-xs text-neutral-600">{t.finishUploads}</p>}
            <button disabled={!filesComplete || dropboxBusy || busy || !shopData?.accepting_orders} onClick={async () => { setBusy(true); try { const ok = await pushItems(); if (ok) setStep('options'); } finally { setBusy(false); } }} className="btn btn-primary w-full py-4 text-lg mt-6">
              {busy ? t.saving : <>{t.continue} {filesComplete && `· ${totalPages} page${totalPages !== 1 ? 's' : ''}`}</>}
            </button>
          </section>
        )}

        {/* STEP 3 — options */}
        {step === 'options' && (
          <section>
            <h1 className="text-2xl font-extrabold tracking-tight">{t.options}</h1>
            <p className="text-sm text-neutral-500 mt-1">Applied to all {readyCount} file{readyCount !== 1 ? 's' : ''} · {totalPages} total pages</p>

            <div className="card mt-5 p-4 space-y-5">
              {/* copies */}
              <div className="flex items-center justify-between">
                <div><div className="font-semibold text-sm">{t.copies}</div><div className="text-[11px] text-neutral-400">Sets to print</div></div>
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
                    <label className="label">{t.colour}</label>
                    <div className="grid grid-cols-2 gap-2">
                      {(['bw', 'color'] as const).map((c) => (
                        <button key={c} onClick={() => setColor(c)} className={cn('h-11 rounded-xl border-2 font-semibold text-sm', color === c ? 'border-orange-600 bg-orange-50 text-orange-900' : 'border-neutral-200')}>{c === 'bw' ? t.blackWhite : t.colour}</button>
                      ))}
                    </div>
                  </div>
                  {/* size */}
                  <div>
                    <label className="label">{t.paperSize}</label>
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
                        <label className="label">{t.sides}</label>
                        <div className="grid grid-cols-2 gap-2">
                          {(['single', 'duplex'] as const).map((s) => (
                            <button key={s} type="button" aria-pressed={sides === s} onClick={() => setSides(s)} className={cn('h-11 rounded-xl border-2 font-semibold text-sm capitalize', sides === s ? 'border-orange-600 bg-orange-50 text-orange-900' : 'border-neutral-200')}>{s === 'single' ? t.single : t.double}</button>
                          ))}
                        </div>
                        {sides === 'duplex' && <div className="mt-2 rounded-xl border border-orange-200 bg-orange-50 p-3 text-xs leading-relaxed text-orange-950">
                          <p>{t.duplexWhole}</p>
                          <p className="mt-1 font-semibold">{language === 'en' ? <>{totalDuplexSheets} physical sheet{totalDuplexSheets === 1 ? '' : 's'} needed for {copies} cop{copies === 1 ? 'y' : 'ies'} of each file.</> : t.duplexSummary.replace('{sheets}', String(totalDuplexSheets)).replace('{copies}', String(copies))}</p>
                          <p className="mt-1">{t.duplexBilling}</p>
                        </div>}
                      </div>
                      {/* gsm */}
                      <div>
                        <label className="label">{t.paperQuality}</label>
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
                        <label className="label">{t.binding}</label>
                        <div className="grid grid-cols-4 gap-2">
                          {(['none', 'staple', 'spiral', 'hard'] as const).map((b) => (
                            <button key={b} onClick={() => setBinding(b)} className={cn('h-11 rounded-xl border-2 font-semibold text-xs capitalize', binding === b ? 'border-orange-600 bg-orange-50 text-orange-900' : 'border-neutral-200')}>{b}</button>
                          ))}
                        </div>
                      </div>
                      <button onClick={() => setLamination(!lamination)} className={cn('w-full flex items-center justify-between rounded-xl border-2 px-4 py-3 text-left', lamination ? 'border-orange-600 bg-orange-50' : 'border-neutral-200')}>
                        <span><span className="font-semibold text-sm">{t.addLamination}</span><br /><span className="text-[11px] text-neutral-500">The shop’s price and billing quantity appear at checkout</span></span>
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

            <button disabled={busy || !shopData?.accepting_orders} onClick={async () => { setBusy(true); try { const ok = await pushItems(); if (ok) setStep('checkout'); } finally { setBusy(false); } }} className="btn btn-primary w-full py-4 text-lg mt-6">{busy ? t.saving : t.continuePay}</button>
          </section>
        )}

        {/* STEP 4 — checkout */}
        {step === 'checkout' && (
          <section>
            <h1 className="text-2xl font-extrabold tracking-tight">{t.almostThere}</h1>
            <p className="text-sm text-neutral-500 mt-1">{t.contactDetails}</p>

            <fieldset disabled={busy || recoveryPossible} className="card mt-4 p-4 space-y-3">
              <div><label className="label">{t.name} *<input value={name} onChange={(e) => setName(e.target.value)} className="input" placeholder="e.g. Aisha Khan" autoComplete="name" /></label></div>
              <div><label className="label">{t.phone} *<input value={phone} onChange={(e) => setPhone(e.target.value)} className="input" placeholder="97970 00000" inputMode="numeric" autoComplete="tel" /></label></div>
              <div><label className="label">{t.email}<input value={email} onChange={(e) => setEmail(e.target.value)} className="input" placeholder="you@example.com" inputMode="email" type="email" /></label></div>
              <div><label className="label">{t.notes}<input value={notes} onChange={(e) => setNotes(e.target.value)} className="input" placeholder="e.g. double-sided, spiral on left edge…" /></label></div>
            </fieldset>

            {/* rush */}
            <button disabled={busy || recoveryPossible} onClick={() => setRush(!rush)} className={cn('w-full mt-3 flex items-center justify-between rounded-xl border-2 px-4 py-3 text-left disabled:opacity-60', rush ? 'border-orange-600 bg-orange-50' : 'border-neutral-200 bg-white')}>
              <span><span className="font-semibold text-sm flex items-center gap-1.5"><Zap size={14} className="text-orange-600" />{t.rush}</span><br /><span className="text-[11px] text-neutral-500">Flag this order as urgent to the shop; any surcharge is shown in the total.</span></span>
              <span className={cn('w-6 h-6 rounded-md border-2 grid place-items-center', rush ? 'bg-orange-600 border-orange-600 text-white' : 'border-neutral-300')}>{rush && '✓'}</span>
            </button>

            {/* order summary */}
            {quote && (
              <div className="card mt-3 p-4 text-sm">
                <div className="flex items-center justify-between font-bold"><span>{t.orderSummary}</span><span>{readyCount} file{readyCount !== 1 ? 's' : ''}</span></div>
                <ul className="mt-2 space-y-1 text-neutral-600">
                  {quote.quote.lines.map((line, i) => (
                    <li key={i} className="flex items-start justify-between gap-4 py-1">
                      <div className="min-w-0">
                        {line.fileId && <div className="break-all text-xs font-semibold text-neutral-800">{files.find((file) => file.id === line.fileId)?.name ?? 'File'}</div>}
                        <div className="break-words">{line.description}</div>
                        <div className="mt-0.5 text-xs text-neutral-500">{line.qty} × {formatPaiseExact(line.unitPricePaise)} per {rateUnitLabel(line.unit, line.service)}</div>
                      </div>
                      <span className="shrink-0 tabular-nums">{formatPaiseExact(line.lineTotalPaise)}</span>
                    </li>
                  ))}
                </ul>
                <div className="border-t border-neutral-100 mt-2 pt-2 space-y-1 text-neutral-600">
                  <div className="flex justify-between"><span>{t.subtotal}</span><span className="tabular-nums">{formatPaiseExact(quote.quote.subtotalPaise)}</span></div>
                  {quote.quote.rushFeePaise > 0 && <div className="flex justify-between"><span>Rush fee</span><span className="tabular-nums">{formatPaiseExact(quote.quote.rushFeePaise)}</span></div>}
                  <div className="flex justify-between"><span>GST</span><span className="tabular-nums">{formatPaiseExact(quote.quote.taxPaise)}</span></div>
                </div>
                <div className="border-t border-neutral-200 mt-2 pt-2 flex justify-between items-baseline">
                  <span className="font-extrabold">{t.total}</span>
                  <span className="text-2xl font-extrabold tabular-nums text-orange-700">{formatPaiseExact(quote.quote.totalPaise)}</span>
                </div>
              </div>
            )}

            {quoteLoading && <p role="status" className="mt-3 text-center text-sm text-neutral-500">{t.calculating}</p>}
            {!quoteLoading && !quote && <button type="button" disabled={busy} onClick={() => setQuoteRefresh((value) => value + 1)} className="btn btn-ghost mt-3 w-full min-h-11 text-sm">{t.retryTotal}</button>}
            {/* method tabs */}
            <div className="grid grid-cols-2 gap-2 mt-3">
              {(['upi', 'cod'] as const).map((m) => (
                <button key={m} disabled={busy || recoveryPossible} onClick={() => setMethod(m)} className={cn('h-12 rounded-xl border-2 font-bold text-sm flex items-center justify-center gap-2 disabled:opacity-60', method === m ? 'border-orange-600 bg-orange-50 text-orange-900' : 'border-neutral-200 bg-white')}>
                  {m === 'upi' ? <><Wallet size={16} /> {t.upi}</> : <><Banknote size={16} /> {t.cash}</>}
                </button>
              ))}
            </div>

            {recoveryPossible && <p className="mt-3 text-xs text-amber-900">The last checkout may have started. Retry the same details below; if you already paid, contact the shop before paying again. {!recoverySaved && 'Keep this tab open: this browser could not save a recovery reference for reload.'}</p>}
            <button disabled={busy || quoteLoading || !quote || (!shopData?.accepting_orders && !recoveryPossible)} onClick={submitPayment} className="btn btn-primary w-full py-4 text-lg mt-4">
              {busy ? <Loader2 size={20} className="animate-spin" /> : recoveryPossible ? 'Retry checkout safely' : method === 'upi' ? t.proceedPay : t.placeCash}
            </button>
            <p className="mt-2 text-center text-[11px] text-neutral-400 flex items-center justify-center gap-1"><ShieldCheck size={12} /> {t.directPayment}</p>
          </section>
        )}

        {/* STEP 5 — UPI gateway-styled screen */}
        {step === 'upi' && upi && (
          <section className="-mt-1">
            {recoveredUpi && <p role="status" className="mb-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">This checkout was already started. If you have paid, do not pay again; report it below or contact the shop.</p>}
            {!recoverySaved && <p className="mb-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">Keep this tab open or save the tracking link: this browser could not save a recovery reference for reload.</p>}
            <div className="rounded-3xl overflow-hidden shadow-2xl">
              <div className="bg-neutral-950 text-white px-6 pt-6 pb-5 text-center relative">
                <div className="text-[10px] uppercase tracking-[0.2em] text-neutral-400">{t.upiCheckout}</div>
                <div className="mt-1 text-sm text-neutral-300">{t.payingTo}</div>
                <div className="text-xl font-extrabold tracking-tight">{upi.shop_name}</div>
                <div className="mt-3 text-5xl font-black tabular-nums tracking-tight">₹{(upi.total_paise / 100).toFixed(2)}</div>
                <div className="mt-1 text-[11px] text-neutral-500">{t.checkAmount}</div>
              </div>

              <div className="bg-white px-6 py-6 text-center border-x border-neutral-100">
                {qrDataUrl
                  ? <BrandedQr src={qrDataUrl} alt="UPI QR" brandInside={qrBrandInside} />
                  : qrFailed
                    ? <div className="mx-auto grid min-h-28 max-w-56 place-items-center rounded-xl bg-neutral-50 p-4 text-xs text-neutral-600" role="status">QR unavailable. Use the button below to open your UPI app.</div>
                    : <div className="w-56 h-56 mx-auto skeleton" />}
                <div className="mt-3 flex items-center justify-center gap-1.5 text-xs text-neutral-500">{qrDataUrl && !qrBrandInside && <BrandMark className="h-4 w-4" />}{t.scanUpi}</div>
                <div className="mt-1 flex items-center justify-center gap-4 text-[10px] font-bold text-neutral-400">
                  <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-blue-600 inline-block" />GPay</span>
                  <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-purple-600 inline-block" />PhonePe</span>
                  <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-sky-500 inline-block" />Paytm</span>
                  <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-green-600 inline-block" />BHIM</span>
                </div>
                <a href={upi.link} className="btn btn-dark w-full h-12 mt-4"><Smartphone size={17} /> {t.openUpi}</a>
                <div className="mt-2 text-[11px] font-mono text-neutral-400 break-all">{upi.pa}</div>
              </div>

              <div className="bg-neutral-50 border border-neutral-100 px-6 py-5 rounded-b-3xl">
                <label className="label">{t.reference}</label>
                <input value={utr} onChange={(e) => setUtr(e.target.value)} className="input text-center font-mono tracking-wider" placeholder="e.g. 426178900123" inputMode="numeric" />
                <button disabled={busy} onClick={confirmPaid} className="btn btn-primary w-full h-13 py-4 text-lg mt-3">
                  {busy ? <Loader2 size={20} className="animate-spin" /> : <>{t.paid} ₹{(upi.total_paise / 100).toFixed(2)}</>}
                </button>
                <p className="mt-2 text-center text-xs text-neutral-600">{t.paymentSafety}</p>
              </div>
            </div>
            <button disabled={busy} onClick={() => router.push(`/track/${orderId}`)} className="w-full text-center text-sm text-neutral-500 mt-4 hover:underline disabled:opacity-50">{t.trackWithout}</button>
          </section>
        )}
      </main>
      {editingFile && orderId && <DocumentEditor url={`/api/orders/${orderId}/files/${editingFile.id}`} mime={editingFile.mime} name={editingFile.name}
        onClose={() => setEditingFile(null)} onSave={(edited) => saveEditedFile(editingFile, edited)} />}
    </div>
  );
}
