'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Loader2, Save, Plus, Trash2, QrCode, Download, CheckCircle2, Store, Wallet, Zap, Info,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface RateRow {
  service: string; paper_size: string | null; color: string | null; sides: string | null;
  paper_gsm: number | null; option: string | null; unit: 'page' | 'job' | 'sheet'; price_paise: number;
}
type RateKey = `${string}`;

const rowKey = (r: RateRow): RateKey => `${r.service}|${r.paper_size}|${r.color}|${r.sides}|${r.paper_gsm}|${r.option}|${r.unit}`;

export default function ShopSettingsPage() {
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);

  // profile
  const [profile, setProfile] = useState({ name: '', address: '', city: '', phone: '', gstin: '', upi_id: '', eta_minutes: 20, rush_surcharge_bps: 1000 });
  const [services, setServices] = useState<Record<string, boolean>>({ print: true, photocopy: true, scan: true, bind: true, laminate: true });
  const [shortCode, setShortCode] = useState('');
  const [slug, setSlug] = useState('');

  // rate card
  const [rows, setRows] = useState<RateRow[]>([]);
  const [dirty, setDirty] = useState(false);

  const load = useCallback(async () => {
    const [meRes, cardRes] = await Promise.all([fetch('/api/shop/me'), fetch('/api/shop/rate-card')]);
    if (meRes.ok) {
      const { shop, services: svc } = await meRes.json();
      setProfile({
        name: shop.name, address: shop.address, city: shop.city, phone: shop.phone,
        gstin: shop.gstin ?? '', upi_id: shop.upi_id ?? '', eta_minutes: shop.eta_minutes, rush_surcharge_bps: shop.rush_surcharge_bps,
      });
      setSlug(shop.slug); setShortCode(shop.short_code);
      const map: Record<string, boolean> = {};
      for (const s of svc) map[s.service] = s.enabled;
      setServices(map);
    }
    if (cardRes.ok) { const { rows } = await cardRes.json(); setRows(rows); }
    setLoaded(true);
  }, []);
  useEffect(() => { load(); }, [load]);

  const saveProfile = async () => {
    setSaving(true); setBanner(null);
    try {
      const res = await fetch('/api/shop/settings', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...profile,
          gstin: profile.gstin || null, upi_id: profile.upi_id || null,
          eta_minutes: Number(profile.eta_minutes) || 20, rush_surcharge_bps: Number(profile.rush_surcharge_bps) || 0,
          services: Object.entries(services).map(([service, enabled]) => ({ service, enabled })),
        }),
      });
      if (res.ok) { setSavedAt(new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })); }
      else { const d = await res.json().catch(() => ({})); setBanner(d?.error?.message ?? 'Save failed'); }
    } finally { setSaving(false); }
  };

  const saveRateCard = async () => {
    setSaving(true); setBanner(null);
    try {
      const res = await fetch('/api/shop/rate-card', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rows }),
      });
      if (res.ok) { setDirty(false); setSavedAt(new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })); }
      else { const d = await res.json().catch(() => ({})); setBanner(d?.error?.message ?? 'Save failed'); }
    } finally { setSaving(false); }
  };

  const updateRow = (key: RateKey, patch: Partial<RateRow>) => {
    setRows((rs) => rs.map((r) => (rowKey(r) === key ? { ...r, ...patch } : r)));
    setDirty(true);
  };
  const removeRow = (key: RateKey) => { setRows((rs) => rs.filter((r) => rowKey(r) !== key)); setDirty(true); };
  const addRow = (service: string) => {
    const base: RateRow = { service, paper_size: 'A4', color: 'bw', sides: 'single', paper_gsm: 80, option: null, unit: 'page', price_paise: service === 'bind' ? 3000 : 200 };
    if (service === 'bind') base.paper_size = null, base.color = null, base.sides = null, base.paper_gsm = null, base.option = 'spiral', base.unit = 'job';
    if (service === 'laminate') base.color = null, base.sides = null, base.paper_gsm = null, base.unit = 'sheet';
    if (service === 'photocopy' || service === 'scan') base.sides = null, base.paper_gsm = null;
    setRows((rs) => [...rs, base]);
    setDirty(true);
  };

  const grouped = useMemo(() => {
    const g = new Map<string, RateRow[]>();
    for (const r of rows) {
      const arr = g.get(r.service) ?? [];
      arr.push(r);
      g.set(r.service, arr);
    }
    return g;
  }, [rows]);

  if (!loaded) return <div className="grid place-items-center py-20"><Loader2 className="animate-spin text-orange-600" size={30} /></div>;

  const inputCls = 'input h-9 text-sm px-2';
  const cellSel = (value: string | number | null, onChange: (v: string) => void, options: { value: string; label: string }[], cls = '') => (
    <select className={cn(inputCls, cls)} value={value ?? ''} onChange={(e) => onChange(e.target.value)}>
      <option value="">—</option>
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );

  return (
    <div className="max-w-4xl mx-auto space-y-5 pb-16">
      {banner && <div className="rounded-xl bg-red-50 border border-red-200 text-red-800 text-sm px-4 py-2">{banner}</div>}
      {savedAt && <div className="rounded-xl bg-green-50 border border-green-200 text-green-800 text-sm px-4 py-2 flex items-center gap-2"><CheckCircle2 size={15} />Saved at {savedAt}</div>}

      {/* QR block */}
      <section className="card p-5 flex flex-col sm:flex-row items-center gap-5">
        <div className="bg-white border-4 border-neutral-900 rounded-2xl p-3 shrink-0">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/api/shop/qr" alt="Shop QR code" className="w-40 h-40" />
        </div>
        <div className="text-center sm:text-left">
          <h1 className="text-xl font-extrabold flex items-center gap-2 justify-center sm:justify-start"><QrCode size={20} />Your shop QR</h1>
          <p className="text-sm text-neutral-600 mt-1">Print it, stick it on the counter or window. Customers scan → upload → pay → collect. No app, no account.</p>
          <div className="mt-2 text-[11px] font-mono text-neutral-500">/s/{slug} · short code <b>{shortCode}</b></div>
          <a href="/api/shop/qr?download=1" className="btn btn-dark h-10 px-4 mt-3 inline-flex text-sm"><Download size={15} />Download PNG</a>
        </div>
      </section>

      {/* Profile */}
      <section className="card p-5">
        <h2 className="text-sm font-extrabold uppercase tracking-widest text-neutral-500 flex items-center gap-1.5"><Store size={14} />Shop profile & UPI</h2>
        <div className="grid sm:grid-cols-2 gap-3 mt-3">
          <div className="sm:col-span-2"><label className="label">Shop name</label><input className="input" value={profile.name} onChange={(e) => setProfile({ ...profile, name: e.target.value })} /></div>
          <div className="sm:col-span-2"><label className="label">Address</label><input className="input" value={profile.address} onChange={(e) => setProfile({ ...profile, address: e.target.value })} /></div>
          <div><label className="label">City</label><input className="input" value={profile.city} onChange={(e) => setProfile({ ...profile, city: e.target.value })} /></div>
          <div><label className="label">Phone</label><input className="input" value={profile.phone} onChange={(e) => setProfile({ ...profile, phone: e.target.value })} /></div>
          <div><label className="label">GSTIN (optional)</label><input className="input" value={profile.gstin} onChange={(e) => setProfile({ ...profile, gstin: e.target.value })} /></div>
          <div>
            <label className="label flex items-center gap-1"><Wallet size={12} />Your UPI ID (customers pay YOU directly)</label>
            <input className="input font-mono" value={profile.upi_id} onChange={(e) => setProfile({ ...profile, upi_id: e.target.value })} placeholder="name@okaxis" />
          </div>
          <div>
            <label className="label flex items-center gap-1"><Zap size={12} />Default ETA (minutes)</label>
            <input className="input" type="number" min={1} value={profile.eta_minutes} onChange={(e) => setProfile({ ...profile, eta_minutes: Number(e.target.value) })} />
          </div>
          <div>
            <label className="label">Rush surcharge (%)</label>
            <input className="input" type="number" min={0} max={100} step={0.5} value={(profile.rush_surcharge_bps / 100).toFixed(1)} onChange={(e) => setProfile({ ...profile, rush_surcharge_bps: Math.round(Number(e.target.value) * 100) })} />
          </div>
        </div>
        <div className="mt-4">
          <label className="label">Services offered</label>
          <div className="flex flex-wrap gap-2">
            {['print', 'photocopy', 'scan', 'bind', 'laminate'].map((s) => (
              <button key={s} onClick={() => setServices({ ...services, [s]: !services[s] })}
                className={cn('chip border capitalize', services[s] ? 'bg-orange-600 text-white border-orange-600' : 'bg-neutral-100 text-neutral-500 border-neutral-200')}>
                {s}
              </button>
            ))}
          </div>
        </div>
        <button onClick={saveProfile} disabled={saving} className="btn btn-primary h-11 px-6 mt-4">{saving ? <Loader2 size={17} className="animate-spin" /> : <><Save size={16} />Save profile</>}</button>
      </section>

      {/* Rate card */}
      <section className="card p-5">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h2 className="text-sm font-extrabold uppercase tracking-widest text-neutral-500">Rate card (₹ per unit)</h2>
          <div className="flex items-center gap-2">
            <select className="input h-9 w-auto text-xs" value="" onChange={(e) => e.target.value && addRow(e.target.value)}>
              <option value="">+ Add rate…</option>
              <option value="print">Print</option>
              <option value="photocopy">Photocopy</option>
              <option value="scan">Scan</option>
              <option value="bind">Binding</option>
              <option value="laminate">Lamination</option>
            </select>
            <button onClick={saveRateCard} disabled={saving || !dirty} className="btn btn-primary h-9 px-4 text-xs">{saving ? <Loader2 size={14} className="animate-spin" /> : <><Save size={14} />Save rates</>}</button>
          </div>
        </div>

        {['print', 'photocopy', 'scan', 'bind', 'laminate'].map((service) => {
          const list = grouped.get(service) ?? [];
          if (list.length === 0) return null;
          return (
            <div key={service} className="mt-4">
              <div className="text-[11px] font-extrabold uppercase tracking-widest text-orange-800 mb-1.5">{service}</div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs min-w-[560px]">
                  <thead className="text-left text-neutral-400">
                    <tr>
                      {service !== 'bind' && <th className="py-1 pr-2">Size</th>}
                      {service !== 'bind' && service !== 'laminate' && <th className="py-1 pr-2">Colour</th>}
                      {service === 'print' && <th className="py-1 pr-2">Sides</th>}
                      {(service === 'print' || service === 'photocopy') && <th className="py-1 pr-2">GSM</th>}
                      {service === 'bind' && <th className="py-1 pr-2">Type</th>}
                      <th className="py-1 pr-2">Unit</th>
                      <th className="py-1 pr-2 text-right">Price ₹</th>
                      <th className="py-1 w-8"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.map((r) => {
                      const key = rowKey(r);
                      return (
                        <tr key={key} className="border-t border-neutral-100">
                          {service !== 'bind' && (
                            <td className="py-1 pr-2">{cellSel(r.paper_size, (v) => updateRow(key, { paper_size: v || null }), ['A4', 'A3', 'A5', 'Legal'].map((v) => ({ value: v, label: v })), 'w-20')}</td>
                          )}
                          {service !== 'bind' && service !== 'laminate' && (
                            <td className="py-1 pr-2">{cellSel(r.color, (v) => updateRow(key, { color: (v || null) as RateRow['color'] }), [{ value: 'bw', label: 'B&W' }, { value: 'color', label: 'Colour' }], 'w-20')}</td>
                          )}
                          {service === 'print' && (
                            <td className="py-1 pr-2">{cellSel(r.sides, (v) => updateRow(key, { sides: (v || null) as RateRow['sides'] }), [{ value: 'single', label: 'Single' }, { value: 'duplex', label: 'Duplex' }], 'w-24')}</td>
                          )}
                          {(service === 'print' || service === 'photocopy') && (
                            <td className="py-1 pr-2">
                              <input className={cn(inputCls, 'w-16')} type="number" value={r.paper_gsm ?? 80} onChange={(e) => updateRow(key, { paper_gsm: Number(e.target.value) })} />
                            </td>
                          )}
                          {service === 'bind' && (
                            <td className="py-1 pr-2">{cellSel(r.option, (v) => updateRow(key, { option: v || null }), [{ value: 'staple', label: 'Staple' }, { value: 'spiral', label: 'Spiral' }, { value: 'hard', label: 'Hard cover' }], 'w-28')}</td>
                          )}
                          <td className="py-1 pr-2 text-neutral-500 capitalize">{r.unit}</td>
                          <td className="py-1 pr-2"><input className={cn(inputCls, 'w-20 text-right font-mono')} type="number" min={0} step="0.5" value={r.price_paise / 100} onChange={(e) => updateRow(key, { price_paise: Math.max(0, Math.round(Number(e.target.value) * 100)) })} /></td>
                          <td className="py-1"><button onClick={() => removeRow(key)} className="p-1.5 text-neutral-300 hover:text-red-600"><Trash2 size={15} /></button></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          );
        })}
        <p className="mt-3 text-[10px] text-neutral-400 flex items-center gap-1"><Info size={11} />Empty dims act as “any / default”. Customers see the exact price before paying — round numbers work best.</p>
      </section>
    </div>
  );
}
