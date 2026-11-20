'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2, CheckCircle2, Settings } from 'lucide-react';
import { AdminPassword } from '@/components/AdminPassword';

export default function AdminSettingsPage() {
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [commission, setCommission] = useState(8);
  const [gst, setGst] = useState(18);
  const [rush, setRush] = useState(10);
  const [maintenance, setMaintenance] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch('/api/admin/settings', { cache: 'no-store' });
    if (res.ok) {
      const { settings } = await res.json();
      const num = (v: unknown, fallback: number) => {
        const n = typeof v === 'string' ? Number(JSON.parse(v)) : Number(v);
        return Number.isFinite(n) ? n : fallback;
      };
      if (settings.commission_bps !== undefined) setCommission(num(settings.commission_bps, 800) / 100);
      if (settings.gst_bps !== undefined) setGst(num(settings.gst_bps, 1800) / 100);
      if (settings.rush_bps !== undefined) setRush(num(settings.rush_bps, 1000) / 100);
      if (settings.maintenance !== undefined) setMaintenance(Boolean(typeof settings.maintenance === 'string' ? JSON.parse(settings.maintenance) : settings.maintenance));
    }
    setLoaded(true);
  }, []);
  useEffect(() => { load(); }, [load]);

  const save = async () => {
    setSaving(true); setSaved(false);
    try {
      const res = await fetch('/api/admin/settings', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ commission_bps: Math.round(commission * 100), gst_bps: Math.round(gst * 100), rush_bps: Math.round(rush * 100), maintenance }),
      });
      if (res.ok) { setSaved(true); setTimeout(() => setSaved(false), 2500); }
      else alert('Save failed');
    } finally { setSaving(false); }
  };

  if (!loaded) return <div className="grid place-items-center py-20"><Loader2 className="animate-spin text-indigo-600" size={30} /></div>;

  return (
    <div className="max-w-xl pb-10">
      <h1 className="text-2xl font-extrabold tracking-tight flex items-center gap-2"><Settings size={22} />Platform settings</h1>
      <div className="card mt-4 p-5 space-y-4">
        <div>
          <label className="label">Platform commission (%)</label>
          <input type="number" min={0} max={50} step={0.5} className="input" value={commission} onChange={(e) => setCommission(Number(e.target.value))} />
          <p className="text-[10px] text-neutral-400 mt-1">Applied to every paid order when generating settlements. Default 8%.</p>
        </div>
        <div>
          <label className="label">GST (%)</label>
          <input type="number" min={0} max={50} step={0.5} className="input" value={gst} onChange={(e) => setGst(Number(e.target.value))} />
          <p className="text-[10px] text-neutral-400 mt-1">Added on top of order subtotal (incl. rush surcharge). Default 18%.</p>
        </div>
        <div>
          <label className="label">Default rush surcharge (%)</label>
          <input type="number" min={0} max={50} step={0.5} className="input" value={rush} onChange={(e) => setRush(Number(e.target.value))} />
          <p className="text-[10px] text-neutral-400 mt-1">Shop-level default can override this. Default 10%.</p>
        </div>
        <label className="flex items-center gap-3 rounded-xl border border-neutral-200 px-4 py-3 cursor-pointer">
          <input type="checkbox" checked={maintenance} onChange={(e) => setMaintenance(e.target.checked)} className="w-4 h-4 accent-orange-600" />
          <span className="text-sm"><b>Maintenance mode</b><br /><span className="text-neutral-500 text-xs">Block new orders platform-wide (landing page shows a banner).</span></span>
        </label>
        <button onClick={save} disabled={saving} className="btn btn-dark h-12 px-8">{saving ? <Loader2 size={17} className="animate-spin" /> : saved ? <><CheckCircle2 size={17} />Saved</> : 'Save settings'}</button>
      </div>
      <AdminPassword />
    </div>
  );
}
