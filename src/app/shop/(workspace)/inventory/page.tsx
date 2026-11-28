'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, Boxes, ChevronDown, Loader2, Minus, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import styles from './inventory.module.css';

interface Item { id: string; name: string; category: string; qty: number; unit: string; low_stock_threshold: number }
const CATEGORIES = ['paper', 'ink', 'binding', 'laminate', 'other'] as const;

export default function InventoryPage() {
  const [items, setItems] = useState<Item[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [filter, setFilter] = useState<'all' | 'low'>('all');
  const [editing, setEditing] = useState<{ id: string; threshold: number } | null>(null);
  const [form, setForm] = useState({ name: '', category: 'paper' as (typeof CATEGORIES)[number], qty: 100, unit: 'sheets', low_stock_threshold: 20 });
  const sequence = useRef(0);
  const inFlight = useRef(false);

  const load = useCallback(async () => {
    const current = ++sequence.current;
    try {
      const response = await fetch('/api/shop/inventory', { cache: 'no-store' });
      if (!response.ok) throw new Error();
      const data = await response.json() as { items?: unknown };
      if (!Array.isArray(data.items)) throw new Error();
      if (current !== sequence.current) return false;
      setItems(data.items as Item[]); setUncertain(false); setError('');
      return true;
    } catch {
      if (current === sequence.current) { setUncertain(true); setError('Could not refresh stock. The list may be out of date; do not assume it is empty.'); }
      return false;
    } finally { if (current === sequence.current) setLoading(false); }
  }, []);
  useEffect(() => { void load(); return () => { sequence.current++; }; }, [load]);

  async function mutate(path: string, method: 'POST' | 'PATCH' | 'DELETE', body?: unknown) {
    if (inFlight.current || uncertain) return false;
    // A refresh started before this write cannot prove what the server saved.
    // Ignore its eventual response, especially after an uncertain mutation.
    sequence.current++;
    inFlight.current = true; setBusy(true); setError(''); setNotice('');
    try {
      const response = await fetch(path, { method, ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (response.status >= 500 || response.status === 409) setUncertain(true);
        setError(result?.error?.message ?? 'Could not update stock. Please try again.');
        return false;
      }
      if (!await load()) { setUncertain(true); setError('Stock was updated, but the latest list could not be loaded. Refresh before making another change.'); return false; }
      setNotice('Stock updated.');
      return true;
    } catch {
      // The server may have saved the change even if its response was lost.
      setUncertain(true); setError('Could not confirm the change. Refresh and check stock before trying again.');
      return false;
    } finally { inFlight.current = false; setBusy(false); }
  }

  async function add(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form.name.trim() || !form.unit.trim()) return;
    if (await mutate('/api/shop/inventory', 'POST', { ...form, name: form.name.trim(), unit: form.unit.trim() })) setForm({ ...form, name: '', qty: 100 });
  }

  const list = items ?? [];
  const lowCount = list.filter((item) => Number(item.qty) <= Number(item.low_stock_threshold)).length;
  const visible = filter === 'low' ? list.filter((item) => Number(item.qty) <= Number(item.low_stock_threshold)) : list;

  return <div className={styles.page}>
    <div className={styles.heading}><div><p className="text-[10px] font-extrabold uppercase tracking-[.18em] text-orange-700">YOUR SUPPLIES</p><h1 className="mt-1 flex items-center gap-2 text-2xl font-black tracking-[-.04em]"><Boxes size={22} />Inventory</h1><p className="mt-1 text-xs text-neutral-500">{items ? lowCount ? `${lowCount} item${lowCount === 1 ? '' : 's'} running low` : 'Keep your stock up to date' : 'Loading your stock'}</p></div><button type="button" onClick={() => void load()} aria-label="Refresh inventory" disabled={busy} className={styles.refresh}><RefreshCw size={17} /></button></div>
    {error && <div role="alert" className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-950">{error} <button type="button" onClick={() => void load()} disabled={busy} className="font-bold underline">Refresh stock</button></div>}
    {notice && <p role="status" className="mt-3 rounded-xl bg-green-50 p-3 text-xs font-semibold text-green-800">{notice}</p>}
    <details className={styles.addPanel}><summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-extrabold text-neutral-900"><span className="flex items-center gap-2"><span className="grid h-9 w-9 place-items-center rounded-xl bg-orange-50 text-orange-700"><Plus size={18} /></span>Add a stock item</span><ChevronDown size={17} className="text-neutral-500" /></summary>
      <form onSubmit={(event) => void add(event)} className="mt-4 grid grid-cols-2 items-end gap-3 sm:grid-cols-3">
        <label className="label col-span-2 sm:col-span-3">Item name<input className="input mt-1 h-10 text-sm" maxLength={80} required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="A4 paper, 80 gsm" /></label>
        <label className="label">Type<select className="input mt-1 h-10 text-sm" value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value as typeof form.category })}>{CATEGORIES.map((category) => <option key={category} value={category}>{category}</option>)}</select></label>
        <label className="label">Quantity<input className="input mt-1 h-10 text-sm" type="number" min={0} max={1_000_000} step="any" required value={form.qty} onChange={(event) => setForm({ ...form, qty: Number(event.target.value) })} /></label>
        <label className="label">Unit<input className="input mt-1 h-10 text-sm" maxLength={20} required value={form.unit} onChange={(event) => setForm({ ...form, unit: event.target.value })} /></label>
        <label className="label">Low at or below<input className="input mt-1 h-10 text-sm" type="number" min={0} max={1_000_000} step="any" required value={form.low_stock_threshold} onChange={(event) => setForm({ ...form, low_stock_threshold: Number(event.target.value) })} /></label>
        <button disabled={busy || uncertain || !form.name.trim() || !form.unit.trim()} className="btn btn-primary col-span-2 min-h-11 text-sm sm:col-span-1">{busy ? <Loader2 size={16} className="animate-spin" /> : <><Plus size={16} />Add item</>}</button>
      </form>
    </details>
    <div className={styles.filters} role="group" aria-label="Filter inventory">
      {([['all', 'All stock'], ['low', `Low stock${items ? ` (${lowCount})` : ''}`]] as const).map(([value, label]) => <button type="button" key={value} aria-pressed={filter === value} onClick={() => setFilter(value)} className={cn('min-h-10 flex-1 rounded-xl text-xs font-extrabold', filter === value ? 'bg-orange-600 text-white shadow-sm' : 'text-neutral-600')}>{label}</button>)}
    </div>
    {loading && !items ? <div role="status" className="grid place-items-center py-16 text-sm text-neutral-500"><Loader2 className="animate-spin text-orange-600" size={26} /><span className="mt-2">Loading stock…</span></div> : !items ? <p className="py-10 text-center text-sm text-neutral-500">Stock is unavailable.</p> : <div className={styles.list}>
      {visible.map((item) => {
        const low = Number(item.qty) <= Number(item.low_stock_threshold);
        const step = /ream|roll/i.test(item.unit) ? 1 : 10;
        return <div key={item.id} className={styles.row}>
          <div className="flex min-w-0 items-center gap-3"><span className={cn('grid h-10 w-10 shrink-0 place-items-center rounded-xl', low ? 'bg-amber-100 text-amber-800' : 'bg-orange-50 text-orange-700')}>{low ? <AlertTriangle size={17} /> : <Boxes size={17} />}</span><div className="min-w-0 flex-1"><p className="break-words text-xs font-extrabold">{item.name}</p><p className="mt-1 text-[11px] text-neutral-500">{Number(item.qty)} {item.unit} · low at {Number(item.low_stock_threshold)}</p><button type="button" onClick={() => setEditing(editing?.id === item.id ? null : { id: item.id, threshold: Number(item.low_stock_threshold) })} className="mt-1 text-[11px] font-bold text-orange-700 underline">{editing?.id === item.id ? 'Cancel' : 'Set low-stock level'}</button></div><div className="flex shrink-0 items-center gap-1"><button type="button" aria-label={`Remove ${step} ${item.unit} from ${item.name}`} disabled={busy || uncertain} onClick={() => void mutate(`/api/shop/inventory/${item.id}`, 'PATCH', { adjust: -step })} className="grid h-10 w-10 place-items-center rounded-xl bg-neutral-100 text-neutral-700 disabled:opacity-40"><Minus size={15} /></button><button type="button" aria-label={`Add ${step} ${item.unit} to ${item.name}`} disabled={busy || uncertain} onClick={() => void mutate(`/api/shop/inventory/${item.id}`, 'PATCH', { adjust: step })} className="grid h-10 w-10 place-items-center rounded-xl bg-orange-50 text-orange-700 disabled:opacity-40"><Plus size={16} /></button><button type="button" aria-label={`Delete ${item.name}`} disabled={busy || uncertain} onClick={() => { if (window.confirm(`Delete ${item.name}?`)) void mutate(`/api/shop/inventory/${item.id}`, 'DELETE'); }} className="grid h-10 w-9 place-items-center rounded-xl text-neutral-400 hover:text-red-700 disabled:opacity-40"><Trash2 size={15} /></button></div></div>
          {editing?.id === item.id && <form className="mt-3 flex items-end gap-2 rounded-xl bg-orange-50/60 p-3" onSubmit={(event) => { event.preventDefault(); void mutate(`/api/shop/inventory/${item.id}`, 'PATCH', { low_stock_threshold: editing.threshold }).then((saved) => { if (saved) setEditing(null); }); }}><label className="label min-w-0 flex-1">Low at or below ({item.unit})<input className="input mt-1 h-10" type="number" min={0} max={1_000_000} step="any" required value={editing.threshold} onChange={(event) => setEditing({ id: item.id, threshold: Number(event.target.value) })} /></label><button disabled={busy || uncertain} className="btn btn-dark h-10 px-4 text-xs">Save</button></form>}
        </div>;
      })}
      {!visible.length && <p className="px-4 py-10 text-center text-xs text-neutral-500">{filter === 'low' ? 'No items are at or below their stock threshold.' : 'No stock yet. Add your first item above.'}</p>}
    </div>}
    <p className="mt-3 text-[11px] leading-5 text-neutral-500">Stock changes are manual. Check supplies in person before relying on these quantities.</p>
  </div>;
}
