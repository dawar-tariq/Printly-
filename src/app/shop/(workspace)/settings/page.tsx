'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  Loader2, Save, Plus, Trash2, QrCode, Download, CheckCircle2, Store, Wallet, Zap, Info, FileText, Smartphone, ChevronRight,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { publicShopPath } from '@/lib/shop-identity';
import { AccountPassword } from '@/components/AccountPassword';
import { useRouter } from 'next/navigation';

interface RateRow {
  service: string; paper_size: string | null; color: string | null; sides: string | null;
  paper_gsm: number | null; option: string | null; unit: 'page' | 'job' | 'sheet' | 'duplex_sheet'; price_paise: number;
}
type EditableRateRow = RateRow & { editorId: number };

function unitLabel(row: RateRow): string {
  if (row.unit === 'duplex_sheet') return 'Per physical duplex sheet';
  if (row.unit === 'page') return 'Per page';
  if (row.unit === 'job') return 'Per copy / set';
  return row.service === 'laminate' ? 'Per sheet' : 'Legacy sheet (charged per page)';
}

export default function ShopSettingsPage() {
  const router = useRouter();
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [claim, setClaim] = useState<{ required: boolean; status: string; isOwner: boolean; note: string } | null>(null);
  const [claimGstin, setClaimGstin] = useState('');
  const [claimPhoto, setClaimPhoto] = useState<File | null>(null);

  // profile
  const [profile, setProfile] = useState({ name: '', address: '', city: '', phone: '', gstin: '', upi_id: '', eta_minutes: 20, rush_surcharge_bps: 1000 });
  const [services, setServices] = useState<Record<string, boolean>>({ print: true, photocopy: true, scan: true, bind: true, laminate: true });
  const [shortCode, setShortCode] = useState('');
  const [duplicateName, setDuplicateName] = useState(false);
  const [proofPhoto, setProofPhoto] = useState<File | null>(null);

  // A stable editor-only ID lets newly added rows be edited independently,
  // even before their dimensions differ from an existing row.
  const nextRowId = useRef(0);
  const [rows, setRows] = useState<EditableRateRow[]>([]);
  const [dirty, setDirty] = useState(false);

  const load = useCallback(async () => {
    const [meRes, cardRes] = await Promise.all([fetch('/api/shop/me'), fetch('/api/shop/rate-card')]);
    if (meRes.ok) {
      const { shop, services: svc, onboarding, is_owner } = await meRes.json();
      setClaim({ required: !!onboarding?.duplicate_name, status: shop.kyc_status, isOwner: !!is_owner, note: onboarding?.review_note ?? '' });
      setClaimGstin(onboarding?.name_proof_gstin ?? shop.gstin ?? '');
      setProfile({
        name: shop.name, address: shop.address, city: shop.city, phone: shop.phone,
        gstin: shop.gstin ?? '', upi_id: shop.upi_id ?? '', eta_minutes: shop.eta_minutes, rush_surcharge_bps: shop.rush_surcharge_bps,
      });
      setShortCode(shop.short_code);
      const map: Record<string, boolean> = {};
      for (const s of svc) map[s.service] = s.enabled;
      setServices(map);
    }
    if (cardRes.ok) {
      const { rows: savedRows } = await cardRes.json() as { rows: RateRow[] };
      setRows(savedRows.map((row) => ({ ...row, editorId: nextRowId.current++ })));
    }
    setLoaded(true);
  }, []);
  useEffect(() => { load(); }, [load]);

  const saveProfile = async () => {
    setSaving(true); setBanner(null); setNotice(null);
    try {
      const body = new FormData();
      body.append('payload', JSON.stringify({
        ...profile,
        gstin: profile.gstin || null, upi_id: profile.upi_id || null,
        eta_minutes: Number(profile.eta_minutes) || 20, rush_surcharge_bps: Number(profile.rush_surcharge_bps) || 0,
        services: Object.entries(services).map(([service, enabled]) => ({ service, enabled })),
      }));
      if (duplicateName && proofPhoto) body.append('proof', proofPhoto);
      const res = await fetch('/api/shop/settings', { method: 'PUT', body });
      const d = await res.json().catch(() => ({}));
      if (res.ok) {
        setDuplicateName(false); setProofPhoto(null);
        setSavedAt(new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }));
        if (d.duplicate_name) {
          setNotice('Name submitted for review. Your shop is paused until the proof is reviewed.');
          await load();
        }
        router.refresh();
      } else {
        if (d?.error?.code === 'duplicate_name_requires_proof') setDuplicateName(true);
        setBanner(d?.error?.message ?? 'Save failed');
      }
    } catch { setBanner('Could not save your details. Please try again.'); }
    finally { setSaving(false); }
  };

  const resubmitProof = async () => {
    setSaving(true); setBanner(null); setNotice(null);
    try {
      const body = new FormData();
      body.append('payload', JSON.stringify({ gstin: claimGstin.trim() || undefined }));
      if (claimPhoto) body.append('proof', claimPhoto);
      const res = await fetch('/api/shop/name-proof', { method: 'POST', body });
      const result = await res.json().catch(() => ({}));
      if (!res.ok) { setBanner(result?.error?.message ?? 'Could not submit proof.'); return; }
      setClaimPhoto(null);
      setNotice('Your proof was submitted for review. Your shop will stay paused until approved.');
      await load();
      router.refresh();
    } catch { setBanner('Could not submit proof. Please try again.'); }
    finally { setSaving(false); }
  };

  const saveRateCard = async () => {
    setSaving(true); setBanner(null);
    try {
      const res = await fetch('/api/shop/rate-card', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows: rows.map(({ editorId: _editorId, ...row }) => row) }),
      });
      if (res.ok) { setDirty(false); setSavedAt(new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })); }
      else { const d = await res.json().catch(() => ({})); setBanner(d?.error?.message ?? 'Save failed'); }
    } catch { setBanner('Could not save rates. Please check your connection and retry.'); }
    finally { setSaving(false); }
  };

  const updateRow = (editorId: number, patch: Partial<RateRow>) => {
    setRows((rs) => rs.map((r) => (r.editorId === editorId ? { ...r, ...patch } : r)));
    setDirty(true);
  };
  const removeRow = (editorId: number) => { setRows((rs) => rs.filter((r) => r.editorId !== editorId)); setDirty(true); };
  const addRow = (selection: string) => {
    const duplex = selection.endsWith('_duplex');
    const service = duplex ? selection.replace(/_duplex$/, '') : selection;
    const base: RateRow = { service, paper_size: 'A4', color: 'bw', sides: 'single', paper_gsm: 80, option: null, unit: 'page', price_paise: service === 'bind' ? 3000 : 200 };
    if (service === 'bind') base.paper_size = null, base.color = null, base.sides = null, base.paper_gsm = null, base.option = 'spiral', base.unit = 'job';
    if (service === 'laminate') base.color = null, base.sides = null, base.paper_gsm = null, base.unit = 'sheet';
    if (service === 'photocopy' || service === 'scan') base.sides = null, base.paper_gsm = null;
    if (duplex) base.sides = 'duplex';
    const editorId = nextRowId.current++;
    setRows((rs) => [...rs, { ...base, editorId }]);
    setDirty(true);
  };

  const grouped = useMemo(() => {
    const g = new Map<string, EditableRateRow[]>();
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
      {banner && <div role="alert" className="rounded-xl bg-red-50 border border-red-200 text-red-800 text-sm px-4 py-2">{banner}</div>}
      {notice && <div role="status" className="rounded-xl bg-green-50 border border-green-200 text-green-800 text-sm px-4 py-2">{notice}</div>}
      {savedAt && <div className="rounded-xl bg-green-50 border border-green-200 text-green-800 text-sm px-4 py-2 flex items-center gap-2"><CheckCircle2 size={15} />Saved at {savedAt}</div>}

      <Link href="/shop/app" className="flex items-center gap-3 rounded-2xl border border-orange-200 bg-orange-50 p-4 hover:border-orange-400">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-white text-orange-700"><Smartphone size={21} /></span>
        <span className="min-w-0 flex-1"><strong className="block text-sm">Android app</strong><span className="mt-0.5 block text-xs text-neutral-600">Download and installation guide</span></span>
        <ChevronRight size={18} className="text-orange-700" />
      </Link>

      {/* QR block */}
      <section id="shop-qr" className="card scroll-mt-24 p-5 flex flex-col sm:flex-row items-center gap-5">
        <div className="bg-white border-4 border-neutral-900 rounded-2xl p-3 shrink-0">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/api/shop/qr" alt="Shop QR code" className="w-40 h-40" />
        </div>
        <div className="text-center sm:text-left">
          <h1 className="text-xl font-extrabold flex items-center gap-2 justify-center sm:justify-start"><QrCode size={20} />Your shop QR</h1>
          <p className="text-sm text-neutral-600 mt-1">Print it, stick it on the counter or window. Customers scan → upload → pay → collect. No app, no account.</p>
          <div className="mt-2 text-xs text-neutral-600">Shop code: <b className="font-mono">{shortCode}</b></div>
          <a href={publicShopPath(shortCode)} className="mt-1 block text-xs font-mono text-orange-700 hover:underline" target="_blank" rel="noreferrer">{publicShopPath(shortCode)}</a>
          <p className="mt-1 text-[11px] text-neutral-500">This permanent code keeps your link separate, even if another shop has the same name.</p>
          <div className="mt-3 flex flex-wrap justify-center gap-2 sm:justify-start">
            <a href="/api/shop/qr?download=1" className="btn btn-dark h-10 px-4 text-sm"><Download size={15} />Download PNG</a>
            <a href="/shop/standee" className="btn btn-primary h-10 px-4 text-sm"><FileText size={15} />Create A4 standee</a>
          </div>
        </div>
      </section>

      {claim?.required && claim.status !== 'approved' && (
        <section className="rounded-2xl border border-amber-300 bg-amber-50 p-5">
          <h2 className="font-extrabold text-amber-950">Duplicate-name proof</h2>
          <p className="mt-1 text-sm text-amber-900">Your shop name matches another shop. Provide a shop photo or GSTIN for the review team. Your shop remains paused until approved.</p>
          {claim.note && <p className="mt-2 text-sm font-semibold text-amber-950">Reviewer&apos;s note: {claim.note}</p>}
          {claim.isOwner ? <>
            <label htmlFor="proof-gstin" className="label mt-3">GSTIN (or upload a photo)</label>
            <input id="proof-gstin" className="input" value={claimGstin} onChange={(e) => setClaimGstin(e.target.value)} placeholder="01ABCDE1234F1Z5" />
            <label htmlFor="proof-resubmit" className="label mt-3">Shop photo (JPEG, PNG or WebP, up to 3 MB)</label>
            <input id="proof-resubmit" className="input text-sm" type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => {
              const file = event.target.files?.[0] ?? null;
              if (file && (file.size > 3 * 1024 * 1024 || !['image/jpeg', 'image/png', 'image/webp'].includes(file.type))) {
                event.target.value = ''; setClaimPhoto(null); setBanner('Choose a JPEG, PNG or WebP photo under 3 MB.');
              } else setClaimPhoto(file);
            }} />
            <button type="button" onClick={resubmitProof} disabled={saving} className="btn btn-dark h-10 px-4 mt-3 text-sm">Submit proof for review</button>
          </> : <p className="mt-2 text-sm text-amber-900">Ask the shop owner to submit or update the evidence.</p>}
        </section>
      )}

      {/* Profile */}
      <section className="card p-5">
        <h2 className="text-sm font-extrabold uppercase tracking-widest text-neutral-500 flex items-center gap-1.5"><Store size={14} />Shop profile & UPI</h2>
        <div className="grid sm:grid-cols-2 gap-3 mt-3">
          <div className="sm:col-span-2"><label className="label">Shop name</label><input className="input" value={profile.name} onChange={(e) => { setProfile({ ...profile, name: e.target.value }); setDuplicateName(false); setProofPhoto(null); }} /></div>
          {duplicateName && (
            <div className="sm:col-span-2 rounded-2xl border border-amber-300 bg-amber-50 p-4">
              <p className="text-sm font-bold text-amber-950">That name is already in use</p>
              <p className="mt-1 text-xs text-amber-900">Provide either a shop photo or a GSTIN below. A duplicate-name change will be reviewed before your shop goes live again.</p>
              <label htmlFor="settings-proof-photo" className="label mt-3">Shop photo (JPEG, PNG or WebP, up to 3 MB)</label>
              <input id="settings-proof-photo" type="file" accept="image/jpeg,image/png,image/webp" className="input text-sm" onChange={(event) => {
                const file = event.target.files?.[0] ?? null;
                if (file && (file.size > 3 * 1024 * 1024 || !['image/jpeg', 'image/png', 'image/webp'].includes(file.type))) {
                  event.target.value = ''; setProofPhoto(null); setBanner('Choose a JPEG, PNG or WebP photo under 3 MB.');
                } else { setProofPhoto(file); }
              }} />
            </div>
          )}
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
      <section id="rate-card" className="card scroll-mt-24 p-5">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h2 className="text-sm font-extrabold uppercase tracking-widest text-neutral-500">Rate card (₹ per unit)</h2>
          <div className="flex items-center gap-2">
            <select aria-label="Add a rate" className="input h-9 w-auto text-xs" value="" onChange={(e) => e.target.value && addRow(e.target.value)}>
              <option value="">+ Add rate…</option>
              <option value="print">Print</option>
              <option value="print_duplex">Double-sided print</option>
              <option value="photocopy">Photocopy</option>
              <option value="photocopy_duplex">Double-sided photocopy</option>
              <option value="scan">Scan</option>
              <option value="bind">Binding</option>
              <option value="laminate">Lamination</option>
            </select>
            <button onClick={saveRateCard} disabled={saving || !dirty} className="btn btn-primary h-9 px-4 text-xs">{saving ? <Loader2 size={14} className="animate-spin" /> : <><Save size={14} />Save rates</>}</button>
          </div>
        </div>

        <div className="mt-3 rounded-xl border border-orange-200 bg-orange-50 p-3 text-xs leading-relaxed text-orange-950">
          <p><strong>Double-sided rates:</strong> edit an existing duplex row or add one, then choose a price per printed page or per physical sheet. Five pages use three sheets per copy; each file and copy starts a new sheet.</p>
          <p className="mt-1">Changing a unit changes the charge, so review its price before saving. Existing rates stay as they are until you edit them. Legacy “sheet” rates for print, photocopy and scan are still charged per document page.</p>
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
                      {(service === 'print' || service === 'photocopy') && <th className="py-1 pr-2">Sides</th>}
                      {(service === 'print' || service === 'photocopy') && <th className="py-1 pr-2">GSM</th>}
                      {service === 'bind' && <th className="py-1 pr-2">Type</th>}
                      <th className="py-1 pr-2">Unit</th>
                      <th className="py-1 pr-2 text-right">Price ₹</th>
                      <th className="py-1 w-8"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.map((r, index) => {
                      const key = r.editorId;
                      const rowName = `${service} rate ${index + 1}`;
                      return (
                        <tr key={key} className="border-t border-neutral-100">
                          {service !== 'bind' && (
                            <td className="py-1 pr-2">{cellSel(r.paper_size, (v) => updateRow(key, { paper_size: v || null }), ['A4', 'A3', 'A5', 'Legal'].map((v) => ({ value: v, label: v })), 'w-20')}</td>
                          )}
                          {service !== 'bind' && service !== 'laminate' && (
                            <td className="py-1 pr-2">{cellSel(r.color, (v) => updateRow(key, { color: (v || null) as RateRow['color'] }), [{ value: 'bw', label: 'B&W' }, { value: 'color', label: 'Colour' }], 'w-20')}</td>
                          )}
                          {(service === 'print' || service === 'photocopy') && (
                            <td className="py-1 pr-2">
                              <select aria-label={`Sides for ${rowName}`} className={cn(inputCls, 'w-28')} value={r.sides ?? ''} onChange={(e) => updateRow(key, { sides: e.target.value || null })}>
                                <option value="" disabled={r.unit === 'duplex_sheet'}>Any</option>
                                <option value="single" disabled={r.unit === 'duplex_sheet'}>Single</option>
                                <option value="duplex">Duplex</option>
                              </select>
                            </td>
                          )}
                          {(service === 'print' || service === 'photocopy') && (
                            <td className="py-1 pr-2">
                              <input aria-label={`Paper GSM for ${rowName}`} className={cn(inputCls, 'w-16')} type="number" min={40} max={300} placeholder="Any" value={r.paper_gsm ?? ''} onChange={(e) => updateRow(key, { paper_gsm: e.target.value === '' ? null : Number(e.target.value) })} />
                            </td>
                          )}
                          {service === 'bind' && (
                            <td className="py-1 pr-2">{cellSel(r.option, (v) => updateRow(key, { option: v || null }), [{ value: 'staple', label: 'Staple' }, { value: 'spiral', label: 'Spiral' }, { value: 'hard', label: 'Hard cover' }], 'w-28')}</td>
                          )}
                          <td className="py-1 pr-2 text-neutral-600">
                            {(service === 'print' || service === 'photocopy') && r.sides === 'duplex' ? (
                              <select aria-label={`Billing unit for ${rowName}`} className={cn(inputCls, 'w-44')} value={r.unit} onChange={(e) => updateRow(key, { unit: e.target.value as RateRow['unit'] })}>
                                <option value="page">Per printed page</option>
                                <option value="duplex_sheet">Per physical sheet</option>
                                {r.unit === 'sheet' && <option value="sheet">Legacy sheet (per page)</option>}
                                {r.unit === 'job' && <option value="job">Legacy job (per copy)</option>}
                              </select>
                            ) : unitLabel(r)}
                          </td>
                          <td className="py-1 pr-2"><input aria-label={`Price in rupees for ${rowName}`} className={cn(inputCls, 'w-20 text-right font-mono')} type="number" min={0} step="0.01" value={r.price_paise / 100} onChange={(e) => updateRow(key, { price_paise: Math.max(0, Math.round(Number(e.target.value) * 100)) })} /></td>
                          <td className="py-1"><button aria-label={`Remove ${rowName}`} onClick={() => removeRow(key)} className="p-1.5 text-neutral-300 hover:text-red-600"><Trash2 size={15} /></button></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          );
        })}
        <p className="mt-3 text-[10px] text-neutral-500 flex items-start gap-1"><Info size={11} className="mt-0.5 shrink-0" />Empty dimensions mean “any / default”; the most specific matching rate is used. For predictable duplex pricing, set its size, colour and GSM to match the intended options. Conflicting equally specific physical-sheet rates cannot be saved. To change sides on a physical-sheet row, first change its billing unit. Customers see the calculation before paying.</p>
      </section>

      <AccountPassword portal="shop" />
    </div>
  );
}
