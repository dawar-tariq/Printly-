'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, Boxes, CircleAlert, ClipboardList, CreditCard, IndianRupee, PackageCheck, Printer, QrCode, ReceiptText, RefreshCw } from 'lucide-react';
import { formatPaiseExact, timeAgo } from '@/lib/format';
import styles from './OwnerHome.module.css';

type Shop = { name: string; short_code: string };
type Order = { id: string; token: string | null; status: string; total_paise: number; created_at: string; customer_name: string | null };
type Lane = { orders: Order[]; pagination: { count: number } };
type Board = { lanes: Record<'confirm' | 'queued' | 'printing' | 'ready', Lane> };
type Report = { orders_count: number; revenue_paise: number };
type Snapshot = { shop: Shop | null; board: Board | null; report: Report | null };

async function readShopJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetch(path, { ...init, cache: 'no-store', signal: controller.signal });
    if (!response.ok) throw new Error('Could not refresh your shop.');
    return await response.json() as T;
  } finally { clearTimeout(timer); }
}

/** The screen uses the same authenticated shop APIs as the existing workspace. */
export function OwnerHome({ firstName = '' }: { firstName?: string }) {
  const [data, setData] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const sequence = useRef(0);

  const load = useCallback(async () => {
    const current = ++sequence.current;
    try {
      const [meResult, boardResult, reportResult] = await Promise.allSettled([
        readShopJson<{ shop: Shop }>('/api/shop/me'),
        readShopJson<Board>('/api/shop/board', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ search: '', pages: {} }) }),
        readShopJson<Report>('/api/shop/reports?range=day'),
      ]);
      const shop = meResult.status === 'fulfilled' && typeof meResult.value?.shop?.name === 'string' ? meResult.value.shop : null;
      const candidate = boardResult.status === 'fulfilled' ? boardResult.value : null;
      const board = candidate?.lanes && (['confirm', 'queued', 'printing', 'ready'] as const).every((key) => {
        const lane = candidate.lanes[key];
        return Array.isArray(lane?.orders) && Number.isSafeInteger(lane.pagination?.count) && lane.pagination.count >= 0 && lane.orders.every((order) =>
          typeof order.id === 'string' && typeof order.created_at === 'string' && typeof order.total_paise === 'number');
      }) ? candidate : null;
      const reportCandidate = reportResult.status === 'fulfilled' ? reportResult.value : null;
      const report = Number.isSafeInteger(reportCandidate?.orders_count) && Number.isSafeInteger(reportCandidate?.revenue_paise) ? reportCandidate : null;
      if (current === sequence.current) {
        if (shop || board || report) setData((previous) => ({ shop: shop ?? previous?.shop ?? null, board: board ?? previous?.board ?? null, report: report ?? previous?.report ?? null }));
        setError(!shop || !board || !report);
      }
    } catch { if (current === sequence.current) setError(true); }
    finally { if (current === sequence.current) setLoading(false); }
  }, []);
  useEffect(() => {
    const refresh = () => { if (document.visibilityState !== 'hidden') void load(); };
    refresh();
    const timer = window.setInterval(refresh, 30_000);
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('focus', refresh);
    return () => { sequence.current++; window.clearInterval(timer); document.removeEventListener('visibilitychange', refresh); window.removeEventListener('focus', refresh); };
  }, [load]);

  const recent = data?.board ? Object.entries(data.board.lanes).flatMap(([lane, value]) => value.orders.map((order) => ({ ...order, lane })))
    .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at)).slice(0, 3) : [];
  const stats = [
    { label: 'Paid revenue today', detail: 'Paid orders created today', value: data?.report ? formatPaiseExact(data.report.revenue_paise) : '—', icon: IndianRupee },
    { label: 'Orders started today', detail: 'Orders created today', value: data?.report ? String(data.report.orders_count) : '—', icon: ClipboardList },
    { label: 'Printing', detail: 'In progress', value: data?.board ? String(data.board.lanes.printing.pagination.count) : '—', icon: Printer },
    { label: 'Ready for pickup', detail: 'Ready orders', value: data?.board ? String(data.board.lanes.ready.pagination.count) : '—', icon: PackageCheck },
  ];
  const links = [
    { href: '/shop/settings#shop-qr', label: 'Shop QR', description: 'Share your shop with customers', icon: QrCode },
    { href: '/shop/inventory', label: 'Inventory', description: 'See your supplies', icon: Boxes },
    { href: '/shop/settings#rate-card', label: 'Rates', description: 'Manage services and pricing', icon: ReceiptText },
  ];

  return <div className={styles.overview}>
    <div className={styles.heading}>
      <div><p className={styles.eyebrow}>YOUR SHOP / OVERVIEW</p>
        <h1>Your shop, at a glance<span>.</span></h1>
        <p className={styles.subtitle}>{firstName ? `Welcome back, ${firstName}. ` : ''}<span>{data?.shop?.name ?? 'Your Printly shop'}</span></p>
      </div>
      <div className={styles.headingActions}><button type="button" onClick={() => void load()} aria-label="Refresh shop overview" className={styles.refresh}><RefreshCw size={17} /></button><Link href="/shop" className={styles.primary}>View orders <ArrowRight size={16} /></Link></div>
    </div>
    {error && <div role="alert" className={styles.alert}><CircleAlert size={18} /><span>Some shop information could not be refreshed. {data ? 'Displayed details may be out of date. ' : 'Do not assume there are no orders. '}<button type="button" onClick={() => void load()}>Try again</button></span></div>}
    <section aria-label="Today’s summary" className={styles.summary}>
      {loading && !data ? <p role="status" className={styles.loading}>Loading your shop…</p> : <div className={styles.stats}>{stats.map(({ label, detail, value, icon: Icon }) => <div key={label} className={styles.stat}><div className={styles.statTop}><span className={styles.statIcon}><Icon size={17} /></span><span>{label}</span></div><strong>{value}</strong><small>{detail}</small></div>)}</div>}
      <p className={styles.note}>Revenue is from paid orders created today, not a bank balance.</p>
    </section>
    <div className={styles.content}>
      <section className={styles.attention}><div className={styles.sectionHeading}><div><p className={styles.eyebrow}>YOUR ORDER QUEUE</p><h2>Needs your attention</h2><p>Oldest open orders</p></div><Link href="/shop">View all <ArrowRight size={15} /></Link></div>
        {data?.board?.lanes.confirm.pagination.count ? <Link href="/shop" className={styles.payment}><CreditCard size={16} />{data.board.lanes.confirm.pagination.count} payment{data.board.lanes.confirm.pagination.count === 1 ? '' : 's'} to check <ArrowRight size={14}/></Link> : null}
        {recent.length ? <ul className={styles.orderList}>{recent.map((order) => <li key={order.id}><Link href={`/shop/orders/${order.id}`} className={styles.order}><span className={styles.orderInfo}><strong>{order.token ? `#${order.token}` : 'Payment to check'}</strong><small>{order.customer_name || 'Customer'} · {timeAgo(order.created_at)}</small></span><span className={styles.orderEnd}><strong>{formatPaiseExact(order.total_paise)}</strong><span className={styles.status}>{order.lane === 'confirm' ? 'Payment to check' : order.lane === 'queued' ? 'New' : order.lane === 'printing' ? 'Printing' : 'Ready'}</span></span><ArrowRight size={15} className={styles.orderArrow}/></Link></li>)}</ul> : <p className={styles.empty}>{loading && !data ? 'Loading orders…' : data?.board ? 'No open orders right now.' : 'Order list unavailable. Open Orders to try again.'}</p>}
      </section>
      <section className={styles.quick}><div className={styles.sectionHeading}><div><p className={styles.eyebrow}>YOUR TOOLS</p><h2>Quick actions</h2><p>The essentials, close at hand.</p></div></div><div className={styles.quickLinks}>{links.map(({ href, label, description, icon: Icon }) => <Link href={href} key={href} className={styles.quickLink}><span className={styles.quickIcon}><Icon size={18}/></span><span><strong>{label}</strong><small>{description}</small></span><ArrowRight size={15}/></Link>)}</div></section>
    </div>
  </div>;
}
