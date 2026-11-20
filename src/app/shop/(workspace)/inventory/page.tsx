'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Plus, Trash2, AlertTriangle, CheckCircle2, Minus, Package } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Item { id: string; name: string; category: string; qty: number; unit: string; low_stock_threshold: number }
const CATEGORIES = ['paper', 'ink', 'binding', 'laminate', 'other'] as const;

export default function InventoryPage() {
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', category: 'paper' as (typeof CATEGORIES)[number], qty: 100, unit: 'sheets', low_stock_threshold: 20 });
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch('/api/shop/inventory', { cache: 'no-store' });
    if (res.ok) setItems((await res.json()).items);
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const adjust = async (id: string, delta: number) => {
    setBusyId(id);
    try {
      await fetch(`/api/shop/inventory/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ adjust: delta }) });
      await load();
    } finally { setBusyId(null); }
  };
  const remove = async (id: string) => {
    if (!confirm('Delete this item?')) return;
    await fetch(`/api/shop/inventory/${id}`, { method: 'DELETE' });
    await load();
  };
  const add = async () => {
    if (!form.name.trim()) return;
    setAdding(true);
    try {
      await fetch('/api/shop/inventory', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
      setForm({ ...form, name: '', qty: 100 });
      await load();
    } finally { setAdding(false); }
  };

  if (loading) return <div className="grid place-items-center py-20"><Loader2 className="animate-spin text-orange-600" size={30} /></div>;
  const lowCount = items.filter((i) => Number(i.qty) <= Number(i.low_stock_threshold)).length;

  return (
    <div className="max-w-4xl mx-auto">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight flex items-center gap-2"><Package size={22} />Inventory</h1>
          <p className="text-xs text-neutral-500 mt-0.5">{lowCount > 0 ? <span className="text-amber-700 font-semibold">{lowCount} item{lowCount > 1 ? 's' : ''} running low</span> : 'Stock levels healthy'}</p>
        </div>
      </div>

      {/* add form */}
      <div className="card mt-4 p-4 grid grid-cols-2 sm:grid-cols-6 gap-2 items-end">
        <div className="col-span-2 sm:col-span-2"><label className="label">Item</label><input className="input h-10 text-sm" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="A4 75gsm reams" /></div>
        <div><label className="label">Type</label><select className="input h-10 text-sm" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value as typeof form.category })}>{CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}</select></div>
        <div><label className="label">Qty</label><input className="input h-10 text-sm" type="number" min={0} value={form.qty} onChange={(e) => setForm({ ...form, qty: Number(e.target.value) })} /></div>
        <div><label className="label">Unit</label><input className="input h-10 text-sm" value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} /></div>
        <button onClick={add} disabled={adding || !form.name.trim()} className="btn btn-primary h-10 text-sm">{adding ? <Loader2 size={15} className="animate-spin" /> : <><Plus size={15} />Add</>}</button>
      </div>

      {/* table */}
      <div className="card mt-4 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="text-left text-[11px] uppercase tracking-wider text-neutral-400 bg-neutral-50">
            <tr><th className="px-4 py-2.5">Item</th><th className="px-2 py-2.5 hidden sm:table-cell">Type</th><th className="px-2 py-2.5 text-right">Qty</th><th className="px-2 py-2.5 hidden sm:table-cell">Low at</th><th className="px-4 py-2.5 text-right">Adjust</th></tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {items.map((i) => {
              const low = Number(i.qty) <= Number(i.low_stock_threshold);
              return (
                <tr key={i.id} className={cn(low && 'bg-amber-50/60')}>
                  <td className="px-4 py-2.5">
                    <div className="font-semibold flex items-center gap-2">{low && <AlertTriangle size={13} className="text-amber-600 shrink-0" />}{i.name}</div>
                  </td>
                  <td className="px-2 py-2.5 capitalize text-neutral-500 hidden sm:table-cell">{i.category}</td>
                  <td className="px-2 py-2.5 text-right font-mono tabular-nums">{Number(i.qty)} <span className="text-[10px] text-neutral-400">{i.unit}</span></td>
                  <td className="px-2 py-2.5 text-neutral-500 hidden sm:table-cell">{Number(i.low_stock_threshold)} {i.unit}</td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center justify-end gap-1.5">
                      <button disabled={busyId === i.id} onClick={() => adjust(i.id, i.unit.includes('ream') || i.unit.includes('roll') ? -1 : -10)} className="w-8 h-8 rounded-lg bg-neutral-100 hover:bg-neutral-200 grid place-items-center"><Minus size={14} /></button>
                      <button disabled={busyId === i.id} onClick={() => adjust(i.id, i.unit.includes('ream') || i.unit.includes('roll') ? 1 : 10)} className="w-8 h-8 rounded-lg bg-neutral-100 hover:bg-neutral-200 grid place-items-center"><Plus size={14} /></button>
                      <button onClick={() => remove(i.id)} className="w-8 h-8 rounded-lg text-neutral-400 hover:text-red-600 grid place-items-center"><Trash2 size={15} /></button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {items.length === 0 && <tr><td colSpan={5} className="px-4 py-8 text-center text-neutral-400 text-sm">No stock yet — add your first item above.</td></tr>}
          </tbody>
        </table>
      </div>

      {lowCount === 0 && items.length > 0 && <p className="mt-3 text-xs text-green-700 flex items-center gap-1.5"><CheckCircle2 size={13} />All stock above minimums.</p>}
    </div>
  );
}
