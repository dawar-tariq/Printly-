'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2, CheckCircle2, Settings } from 'lucide-react';
import { AccountPassword } from '@/components/AccountPassword';

export default function AdminSettingsPage() {
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [commission, setCommission] = useState(8);
  const [gst, setGst] = useState(18);
  const [rush, setRush] = useState(10);
  const [maintenance, setMaintenance] = useState(false);
  const [savedMaintenance, setSavedMaintenance] = useState<boolean | null>(null);
  const [savedRates, setSavedRates] = useState<{ commission_bps: number; gst_bps: number; rush_bps: number } | null>(null);

  const load = useCallback(async () => {
    setLoaded(false);
    setLoadError(null);
    try {
      const res = await fetch('/api/admin/settings', { cache: 'no-store' });
      if (!res.ok) throw new Error('Could not load settings');
      const { settings } = await res.json();
      if (!settings || typeof settings !== 'object') throw new Error('Invalid settings');
      const num = (v: unknown, fallback: number) => {
        const n = Number(v);
        return Number.isFinite(n) ? n : fallback;
      };
      const flag = settings.maintenance;
      if (flag !== true && flag !== false && flag !== 'true' && flag !== 'false') throw new Error('Invalid maintenance setting');
      const rates = {
        commission_bps: num(settings.commission_bps, 800),
        gst_bps: num(settings.gst_bps, 1800),
        rush_bps: num(settings.rush_bps, 1000),
      };
      setCommission(rates.commission_bps / 100);
      setGst(rates.gst_bps / 100);
      setRush(rates.rush_bps / 100);
      setSavedRates(rates);
      const isOn = flag === true || flag === 'true';
      setMaintenance(isOn);
      setSavedMaintenance(isOn);
      return true;
    } catch {
      setLoadError('Could not load the current settings. Please retry before making changes.');
      return false;
    } finally {
      setLoaded(true);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const save = async () => {
    if (saving || savedMaintenance === null || !savedRates) return;
    setSaving(true); setSaved(false); setSaveError(null);
    try {
      // Save only fields changed on this page. A maintenance toggle must not
      // overwrite newer pricing (or vice versa) saved by another administrator.
      const rates = {
        commission_bps: Math.round(commission * 100),
        gst_bps: Math.round(gst * 100),
        rush_bps: Math.round(rush * 100),
      };
      const changes = {
        ...(rates.commission_bps !== savedRates.commission_bps ? { commission_bps: rates.commission_bps } : {}),
        ...(rates.gst_bps !== savedRates.gst_bps ? { gst_bps: rates.gst_bps } : {}),
        ...(rates.rush_bps !== savedRates.rush_bps ? { rush_bps: rates.rush_bps } : {}),
        ...(maintenance !== savedMaintenance ? { maintenance } : {}),
      };
      const res = await fetch('/api/admin/settings', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(changes),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error?.message ?? 'Could not save settings. Please retry.');
      }
      if (await load()) {
        setSaved(true);
        setTimeout(() => setSaved(false), 2500);
      }
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Could not save settings. Please retry.');
    } finally { setSaving(false); }
  };

  if (!loaded) return <div className="grid place-items-center py-20"><Loader2 className="animate-spin text-indigo-600" size={30} /><span className="sr-only">Loading settings</span></div>;

  if (loadError) return (
    <div className="max-w-xl pb-10">
      <h1 className="text-2xl font-extrabold tracking-tight flex items-center gap-2"><Settings size={22} />Platform settings</h1>
      <div className="card mt-4 p-5">
        <p role="alert" className="text-sm text-red-700">{loadError}</p>
        <button type="button" onClick={() => void load()} className="btn btn-dark mt-4 h-10 px-5">Try again</button>
      </div>
    </div>
  );

  return (
    <div className="max-w-xl pb-10">
      <h1 className="text-2xl font-extrabold tracking-tight flex items-center gap-2"><Settings size={22} />Platform settings</h1>
      <div className="card mt-4 p-5 space-y-4">
        <fieldset disabled={saving} className="min-w-0 space-y-4">
          <div>
            <label className="label" htmlFor="commission">Platform commission (%)</label>
            <input id="commission" type="number" min={0} max={50} step={0.5} className="input" value={commission} onChange={(e) => setCommission(Number(e.target.value))} />
            <p className="text-[10px] text-neutral-400 mt-1">Applied to every paid order when generating settlements. Default 8%.</p>
          </div>
          <div>
            <label className="label" htmlFor="gst">GST (%)</label>
            <input id="gst" type="number" min={0} max={50} step={0.5} className="input" value={gst} onChange={(e) => setGst(Number(e.target.value))} />
            <p className="text-[10px] text-neutral-400 mt-1">Added on top of order subtotal (incl. rush surcharge). Default 18%.</p>
          </div>
          <div>
            <label className="label" htmlFor="rush">Default rush surcharge (%)</label>
            <input id="rush" type="number" min={0} max={50} step={0.5} className="input" value={rush} onChange={(e) => setRush(Number(e.target.value))} />
            <p className="text-[10px] text-neutral-400 mt-1">Shop-level default can override this. Default 10%.</p>
          </div>
          <div className="rounded-xl border border-neutral-200 px-4 py-3">
            <div className="flex items-center justify-between gap-3">
              <b className="text-sm">Maintenance mode</b>
              <span className={savedMaintenance ? 'chip bg-amber-100 text-amber-800' : 'chip bg-green-100 text-green-800'}>Currently {savedMaintenance ? 'on' : 'off'}</span>
            </div>
            <p className="mt-2 text-xs leading-relaxed text-neutral-600">When enabled, customers and shops see a maintenance page and cannot use the site. The admin console stays available.</p>
            <p className="mt-2 text-xs leading-relaxed text-neutral-500">Requests already in progress may still finish. Payments made outside Printly cannot be stopped.</p>
            <label className="mt-3 flex cursor-pointer items-center gap-2 text-sm font-semibold">
              <input type="checkbox" checked={maintenance} onChange={(e) => setMaintenance(e.target.checked)} className="h-4 w-4 accent-orange-600" />
              Enable maintenance mode
            </label>
            {maintenance !== savedMaintenance && <p role="status" className="mt-2 text-xs font-semibold text-amber-700">Save settings to apply this change.</p>}
          </div>
        </fieldset>
        {saveError && <p role="alert" className="text-sm text-red-700">{saveError}</p>}
        <button onClick={save} disabled={saving} className="btn btn-dark h-12 px-8">{saving ? <Loader2 size={17} className="animate-spin" /> : saved ? <><CheckCircle2 size={17} />Saved</> : 'Save settings'}</button>
      </div>
      <AccountPassword portal="admin" />
    </div>
  );
}
