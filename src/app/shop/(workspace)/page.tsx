'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Loader2, CheckCircle2, XCircle, Printer, PackageCheck, Package, Banknote, Clock,
  AlertCircle, User, ChevronRight, Zap, IndianRupee, RefreshCw, Bell, BellOff, Search,
} from 'lucide-react';
import { formatPaise, timeAgo } from '@/lib/format';
import { cn } from '@/lib/utils';
import { createBrowserSupabase } from '@/lib/supabase-client';
import { requestUpiDecision } from '@/lib/upi-confirmation';

interface OrderCard {
  id: string; token: string | null; status: string; payment_status: string; payment_method: string | null;
  customer_name: string; customer_phone: string; total_paise: number; rush: boolean; eta_minutes: number | null;
  utr: string | null; created_at: string; items: { count: number }[];
}
type LaneName = 'confirm' | 'queued' | 'printing' | 'ready';
type Pages = Record<LaneName, number>;
type Lane = { orders: OrderCard[]; pagination: { page: number; pages: number; count: number } };
type Snapshot = { shop_id: string; lanes: Record<LaneName, Lane>; completed_today: number; attention: { id: string; updated_at: string }[] };
const FIRST_PAGES: Pages = { confirm: 1, queued: 1, printing: 1, ready: 1 };
const LANE_NAMES: LaneName[] = ['confirm', 'queued', 'printing', 'ready'];

function validSnapshot(value: unknown): value is Snapshot {
  if (!value || typeof value !== 'object') return false;
  const result = value as Partial<Snapshot>;
  return typeof result.shop_id === 'string' && typeof result.completed_today === 'number' && Array.isArray(result.attention) &&
    result.attention.every((item) => typeof item?.id === 'string' && typeof item?.updated_at === 'string' && Number.isFinite(Date.parse(item.updated_at))) &&
    !!result.lanes && LANE_NAMES.every((key) => {
      const lane = result.lanes?.[key];
      return Array.isArray(lane?.orders) && typeof lane.pagination?.count === 'number' &&
        typeof lane.pagination.page === 'number' && typeof lane.pagination.pages === 'number';
    });
}

export default function ShopBoardPage() {
  const router = useRouter();
  const [lookup, setLookup] = useState('');
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [pages, setPages] = useState<Pages>(FIRST_PAGES);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [utrEdit, setUtrEdit] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [actionError, setActionError] = useState('');
  const [soundEnabled, setSoundEnabled] = useState(false);
  const [soundMessage, setSoundMessage] = useState('');
  const refreshSequence = useRef(0);
  const loadRef = useRef<() => Promise<void>>(async () => {});
  const audio = useRef<AudioContext | null>(null);
  const seenAttention = useRef<Set<string> | null>(null);
  const attentionWatermark = useRef<number | null>(null);
  const attentionShop = useRef<string | null>(null);

  const playAlert = useCallback(() => {
    const context = audio.current;
    if (!context || context.state !== 'running') return;
    try {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = 'sine'; oscillator.frequency.value = 660;
      gain.gain.setValueAtTime(0.0001, context.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.12, context.currentTime + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.3);
      oscillator.connect(gain); gain.connect(context.destination);
      oscillator.start(); oscillator.stop(context.currentTime + 0.31);
    } catch { setSoundMessage('The browser could not play the alert. Check device volume and browser permissions.'); }
  }, []);

  const toggleSound = async () => {
    if (soundEnabled) {
      const old = audio.current; audio.current = null; setSoundEnabled(false); setSoundMessage('Sound alerts are off.');
      if (old) void old.close().catch(() => {});
      return;
    }
    try {
      const Audio = window.AudioContext ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Audio) throw new Error('Audio unavailable');
      const context = new Audio();
      await context.resume();
      if (context.state !== 'running') { void context.close(); throw new Error('Audio blocked'); }
      audio.current = context; setSoundEnabled(true); setSoundMessage('Sound alerts are on while this board is open.'); playAlert();
    } catch { setSoundMessage('Could not enable sound. Check browser permissions and device volume.'); }
  };
  useEffect(() => () => { const old = audio.current; audio.current = null; if (old) void old.close().catch(() => {}); }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearch(searchInput.trim());
      setPages((current) => LANE_NAMES.every((lane) => current[lane] === 1) ? current : { ...FIRST_PAGES });
    }, 400);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  const load = useCallback(async () => {
    const sequence = ++refreshSequence.current;
    try {
      const response = await fetch('/api/shop/board', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ search, pages }), cache: 'no-store',
      });
      if (!response.ok) throw new Error('Order refresh failed');
      const next: unknown = await response.json();
      if (!validSnapshot(next)) throw new Error('Invalid order response');
      if (sequence !== refreshSequence.current) return;
      if (attentionShop.current !== next.shop_id) {
        attentionShop.current = next.shop_id; seenAttention.current = null; attentionWatermark.current = null;
      }
      const seen = seenAttention.current;
      const watermark = attentionWatermark.current;
      // An old order falling into the bounded top 50 as newer ones leave is
      // not a new order. Compare timestamps as well as IDs to avoid false beeps.
      if (seen && next.attention.some((item) => !seen.has(item.id) && (watermark === null || Date.parse(item.updated_at) >= watermark))) playAlert();
      if (!seen || seen.size > 5000) seenAttention.current = new Set(next.attention.map((item) => item.id));
      else next.attention.forEach((item) => seen.add(item.id));
      for (const item of next.attention) {
        const timestamp = Date.parse(item.updated_at);
        attentionWatermark.current = Math.max(attentionWatermark.current ?? timestamp, timestamp);
      }
      setSnapshot(next); setLoadError(false);
      // If orders moved while this page was open, return to the last real page.
      setPages((current) => {
        const adjusted = { ...current };
        let changed = false;
        for (const lane of LANE_NAMES) {
          if (current[lane] === next.lanes[lane].pagination.page && current[lane] > next.lanes[lane].pagination.pages) {
            adjusted[lane] = next.lanes[lane].pagination.pages; changed = true;
          }
        }
        return changed ? adjusted : current;
      });
    } catch {
      // Never turn a failed refresh into an empty board.
      if (sequence === refreshSequence.current) setLoadError(true);
    } finally { if (sequence === refreshSequence.current) setLoading(false); }
  }, [pages, search, playAlert]);
  loadRef.current = load;
  useEffect(() => { void load(); return () => { refreshSequence.current++; }; }, [load]);

  useEffect(() => {
    if (!snapshot?.shop_id) return;
    const shopId = snapshot.shop_id;
    const refreshIfVisible = () => { if (document.visibilityState !== 'hidden') void loadRef.current(); };
    const timer = window.setInterval(refreshIfVisible, 15_000);
    document.addEventListener('visibilitychange', refreshIfVisible);
    const supabase = createBrowserSupabase();
    let scheduled: number | undefined;
    const channel = supabase.channel(`shop-orders:${shopId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders', filter: `shop_id=eq.${shopId}` }, () => {
        if (document.visibilityState === 'hidden') return;
        window.clearTimeout(scheduled);
        scheduled = window.setTimeout(refreshIfVisible, 350);
      }).subscribe();
    return () => { window.clearInterval(timer); window.clearTimeout(scheduled); document.removeEventListener('visibilitychange', refreshIfVisible); supabase.removeChannel(channel); };
  }, [snapshot?.shop_id]);

  const transition = async (id: string, to: string) => {
    setBusyId(id); setActionError('');
    try {
      const res = await fetch(`/api/shop/orders/${id}/status`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ to }),
      });
      if (!res.ok) { const data = await res.json().catch(() => ({})); setActionError(data?.error?.message ?? 'Could not update order'); }
      await loadRef.current();
    } catch { setActionError('Connection interrupted. Refresh the order before trying again.'); }
    finally { setBusyId(null); }
  };

  const confirmPayment = async (order: OrderCard, action: 'confirm' | 'reject') => {
    setBusyId(order.id); setActionError('');
    try {
      const result = await requestUpiDecision(order.id, action, utrEdit[order.id] ?? order.utr);
      if (result === 'updated') await loadRef.current();
    } catch (err) { setActionError(err instanceof Error ? err.message : 'Connection interrupted. Refresh the order before trying again.'); }
    finally { setBusyId(null); }
  };

  const changePage = (lane: LaneName, page: number) => setPages((current) => ({ ...current, [lane]: page }));
  const pagination = (name: LaneName, lane: Lane) => <div className="flex items-center justify-between gap-2 border-t border-neutral-200 px-3 py-2 text-[11px] text-neutral-600">
    <span>{lane.pagination.count} total · page {lane.pagination.page} of {lane.pagination.pages}</span>
    <span className="flex gap-1"><button type="button" aria-label={`Previous ${name} page`} disabled={lane.pagination.page <= 1} onClick={() => changePage(name, lane.pagination.page - 1)} className="btn btn-ghost min-h-9 px-2 disabled:opacity-40">Previous</button><button type="button" aria-label={`Next ${name} page`} disabled={lane.pagination.page >= lane.pagination.pages} onClick={() => changePage(name, lane.pagination.page + 1)} className="btn btn-ghost min-h-9 px-2 disabled:opacity-40">Next</button></span>
  </div>;
  const renderLane = (name: 'queued' | 'printing' | 'ready', title: string, Icon: typeof Printer, action: (order: OrderCard) => React.ReactNode) => {
    const lane = snapshot!.lanes[name];
    return <section className="flex min-h-72 flex-col overflow-hidden rounded-2xl border border-neutral-200 bg-neutral-200/60">
      <div className="flex items-center justify-between border-b border-neutral-200 px-3 py-2.5"><h2 className="flex items-center gap-1.5 text-xs font-extrabold uppercase tracking-widest text-neutral-600"><Icon size={14} />{title}<span className="rounded-full bg-white px-1.5 py-0.5 text-[10px]">{lane.pagination.count}</span></h2></div>
      <div className="flex-1 space-y-2 p-2">{lane.orders.map((o) => <div key={o.id} className="rounded-xl border border-neutral-200 bg-white p-3">
        <div className="flex items-start justify-between gap-2"><Link href={`/shop/orders/${o.id}`} className="min-w-0 flex-1"><div className="flex items-center gap-2"><span className="text-2xl font-black text-neutral-900">{o.token ?? '—'}</span>{o.rush && <span className="chip bg-red-100 text-red-700"><Zap size={10} />RUSH</span>}</div><div className="mt-0.5 flex min-w-0 items-center gap-1 text-[11px] text-neutral-500"><User size={10} className="shrink-0" /><span className="min-w-0 truncate">{o.customer_name || 'Walk-in'} · {o.customer_phone}</span></div></Link><div className="shrink-0 text-right"><div className="text-sm font-extrabold tabular-nums">{formatPaise(o.total_paise)}</div><span className={cn('chip mt-0.5', o.payment_method === 'cod' ? 'bg-blue-100 text-blue-800' : 'bg-green-100 text-green-800')}>{o.payment_method === 'cod' ? 'COD' : 'UPI confirmed'}</span></div></div>
        <div className="mt-2 flex items-center justify-between gap-2"><span className="flex items-center gap-1 text-[10px] text-neutral-400"><Clock size={10} />{timeAgo(o.created_at)} · {o.items?.[0]?.count ?? 0} items</span><div className="flex gap-1.5"><Link href={`/shop/orders/${o.id}`} className="btn btn-ghost h-8 px-2.5 text-[11px]">Details</Link>{action(o)}</div></div>
      </div>)}{lane.orders.length === 0 && <div className="py-8 text-center text-[11px] text-neutral-400">{search ? 'No matching orders on this page' : 'Nothing here'}</div>}</div>{pagination(name, lane)}
    </section>;
  };

  if (loading && !snapshot) return <div className="grid place-items-center py-20"><Loader2 className="animate-spin text-orange-600" size={30} /></div>;
  if (!snapshot) return <div role="alert" className="card p-5 text-sm text-red-800"><p>Orders are temporarily unavailable. Do not assume there are no orders or payment reports.</p><button type="button" onClick={() => void load()} className="btn btn-dark mt-3 h-10 px-4">Try again</button></div>;
  const confirm = snapshot.lanes.confirm;

  return <div>
    {loadError && <div role="status" className="mb-4 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">Could not refresh orders. The information below may be out of date. <button type="button" onClick={() => void load()} className="font-bold underline">Try again</button></div>}
    {actionError && <div role="alert" className="mb-4 rounded-xl bg-red-50 p-3 text-sm text-red-800">{actionError}</div>}
    <div className="card mb-4 flex flex-wrap items-end gap-3 p-3">
      <label className="min-w-0 flex-1 basis-48 text-xs font-bold text-neutral-700">Search all open orders
        <span className="relative mt-1 block"><Search size={15} className="absolute left-3 top-3 text-neutral-400" /><input value={searchInput} onChange={(event) => setSearchInput(event.target.value)} maxLength={80} className="input w-full pl-9 text-sm" placeholder="Token, customer, phone or UTR" /></span>
      </label>
      <button type="button" onClick={() => void toggleSound()} aria-pressed={soundEnabled} className="btn btn-ghost min-h-10 px-3 text-xs">{soundEnabled ? <Bell size={15} /> : <BellOff size={15} />}{soundEnabled ? 'Sound on' : 'Enable sound'}</button>
      <button type="button" onClick={() => void load()} className="btn btn-ghost min-h-10 px-3 text-xs"><RefreshCw size={15} />Refresh</button>
      {soundMessage && <p role="status" className="w-full text-xs text-neutral-600">{soundMessage} Alerts are best-effort and work only while the board is open.</p>}
    </div>
    <details className="card mb-4 p-3"><summary className="cursor-pointer text-sm font-bold text-neutral-700">Find an order with its tracking link</summary>
      <form className="mt-3 flex flex-wrap gap-2" onSubmit={(event) => {
        event.preventDefault();
        const match = lookup.trim().match(/(?:^|\/track\/)([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})(?=\/?(?:$|[?#]))/i);
        if (!match) { setLookupError('Enter the full tracking link or order ID.'); return; }
        setLookupError(null); router.push(`/shop/orders/${match[1]}`);
      }}><label className="min-w-0 flex-1 basis-48 text-xs font-semibold text-neutral-600">Tracking link or order ID<input value={lookup} onChange={(event) => setLookup(event.target.value)} maxLength={2048} className="input mt-1 w-full text-sm" placeholder="Paste the customer’s tracking link" /></label><button type="submit" className="btn btn-ghost min-h-10 self-end px-4 text-sm">Find order</button>{lookupError && <p role="alert" className="w-full text-xs text-red-700">{lookupError}</p>}</form>
      <p className="mt-2 text-xs text-neutral-500">Only orders for your shop can be opened.</p>
    </details>
    {(confirm.pagination.count > 0 || !!search) && <section className="mb-4 overflow-hidden rounded-2xl border-2 border-amber-400 bg-amber-50">
      <div className="flex items-center justify-between border-b border-amber-200 px-4 py-2.5"><h2 className="flex items-center gap-2 text-xs font-extrabold uppercase tracking-widest text-amber-900"><AlertCircle size={14} />Payment confirmation ({confirm.pagination.count})</h2></div>
      <p className="px-4 pt-2 text-xs text-amber-900">A customer’s report or reference is not proof of payment. Verify the receiving account before confirming.</p>
      <div className="grid min-w-0 grid-cols-1 gap-2 p-2 md:grid-cols-2">{confirm.orders.map((o) => <div key={o.id} className="min-w-0 rounded-xl border border-amber-200 bg-white p-3">
        <div className="flex items-start justify-between gap-2"><Link href={`/shop/orders/${o.id}`} className="min-w-0"><div className="text-[11px] font-bold text-neutral-500">ORDER #{o.id.slice(0, 8).toUpperCase()}</div><div className="truncate text-sm font-bold">{o.customer_name || 'Walk-in'} · {o.customer_phone}</div><div className="mt-0.5 text-[11px] text-neutral-500">{o.items?.[0]?.count ?? 0} item(s) · {timeAgo(o.created_at)}</div></Link><div className="shrink-0 text-right"><div className="flex items-center gap-0.5 text-base font-extrabold tabular-nums"><IndianRupee size={14} />{(o.total_paise / 100).toFixed(2)}</div><span className="chip mt-0.5 bg-amber-100 text-amber-800">UPI · unverified</span></div></div>
        <label className="mt-2 block text-xs text-neutral-600">UPI reference (optional)<input value={utrEdit[o.id] ?? o.utr ?? ''} onChange={(e) => setUtrEdit((m) => ({ ...m, [o.id]: e.target.value }))} maxLength={40} className="input mt-1 h-9 min-w-0 w-full font-mono text-xs" /></label>
        {o.payment_status === 'pending' && <p className="mt-2 text-xs text-amber-900">Waiting for the customer to report payment. Open the order to record their report if they contacted you.</p>}
        <div className="mt-2 flex items-center gap-2"><button disabled={busyId === o.id || o.payment_status !== 'submitted'} onClick={() => void confirmPayment(o, 'confirm')} className="btn btn-primary h-9 flex-1 px-4 text-xs">{busyId === o.id ? <Loader2 size={14} className="animate-spin" /> : <><CheckCircle2 size={14} />Payment received</>}</button><button disabled={busyId === o.id} onClick={() => void confirmPayment(o, 'reject')} className="btn btn-ghost h-9 px-3 text-xs text-red-700"><XCircle size={14} />Not received</button></div>
      </div>)}{!confirm.orders.length && <p className="p-3 text-xs text-neutral-600">No matching payment reports on this page.</p>}</div>{pagination('confirm', confirm)}
    </section>}
    <div className="grid gap-3 lg:grid-cols-3">
      {renderLane('queued', 'New orders', Package, (o) => <button disabled={busyId === o.id} onClick={() => void transition(o.id, 'printing')} className="btn btn-dark h-8 px-3 text-[11px]">{busyId === o.id ? <Loader2 size={13} className="animate-spin" /> : 'Start printing'}</button>)}
      {renderLane('printing', 'Printing', Printer, (o) => <button disabled={busyId === o.id} onClick={() => void transition(o.id, 'ready')} className="btn btn-dark h-8 px-3 text-[11px]">{busyId === o.id ? <Loader2 size={13} className="animate-spin" /> : 'Mark ready'}</button>)}
      {renderLane('ready', 'Ready for pickup', PackageCheck, (o) => <button disabled={busyId === o.id} onClick={() => void transition(o.id, 'collected')} className="btn btn-primary h-8 px-3 text-[11px]">{busyId === o.id ? <Loader2 size={13} className="animate-spin" /> : o.payment_method === 'cod' ? 'Cash received ✓' : 'Mark collected'}</button>)}
    </div>
    <div className="mt-3 flex items-center justify-between px-1 text-[11px] text-neutral-500"><span className="flex items-center gap-2"><Banknote size={12} />Completed today: <b className="text-neutral-800">{snapshot.completed_today}</b></span><Link href="/shop/reports" className="flex items-center gap-1 font-bold text-orange-800 hover:underline">View reports <ChevronRight size={12} /></Link></div>
  </div>;
}
