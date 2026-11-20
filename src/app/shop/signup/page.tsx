'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Logo } from '@/components/Logo';
import { Loader2, CheckCircle2, Store, ArrowLeft, ArrowRight, Plus, Trash2, ShieldCheck, Clock, Boxes, Printer, Building2, Check, CircleAlert } from 'lucide-react';
import { cn } from '@/lib/utils';
import { isGstinFormat, normalizeShopName } from '@/lib/shop-identity';

const STEPS = [
  { key: 'shop', label: 'Shop & owner', icon: Store, hint: 'Who you are and how to reach you' },
  { key: 'business', label: 'Business details', icon: Building2, hint: 'Type, location, hours & registration' },
  { key: 'services', label: 'Services & equipment', icon: Printer, hint: 'What you offer and what you run' },
  { key: 'inventory', label: 'Inventory & review', icon: Boxes, hint: 'Starting stock, then submit' },
] as const;

const SERVICE_OPTIONS = [
  { value: 'print', label: 'Printing', desc: 'B/W & colour prints' },
  { value: 'photocopy', label: 'Photocopy', desc: 'Xerox, single & duplex' },
  { value: 'scan', label: 'Scanning', desc: 'Document scans' },
  { value: 'bind', label: 'Binding', desc: 'Staple, spiral, hard cover' },
  { value: 'laminate', label: 'Lamination', desc: 'A4 / A3 pouches' },
] as const;

const BUSINESS_TYPES = [
  { value: 'digital_printing', label: 'Digital printing shop' },
  { value: 'photocopy', label: 'Photocopy / Xerox' },
  { value: 'stationery', label: 'Stationery' },
  { value: 'internet_cafe', label: 'Internet café / CSC' },
  { value: 'other', label: 'Other' },
] as const;

const REG_TYPES = [
  { value: 'unregistered', label: 'Not registered' },
  { value: 'gstin', label: 'GSTIN' },
  { value: 'udyam', label: 'Udyam (MSME)' },
  { value: 'shop_license', label: 'Shop licence' },
  { value: 'other', label: 'Other' },
] as const;

const INV_CATEGORIES = [
  { value: 'paper', label: 'Paper' },
  { value: 'ink', label: 'Ink / Toner' },
  { value: 'binding', label: 'Binding' },
  { value: 'laminate', label: 'Lamination' },
  { value: 'other', label: 'Other' },
] as const;

interface InvRow { name: string; category: string; qty: string; unit: string; low_stock_threshold: string }

export default function ShopSignupPage() {
  const [step, setStep] = useState(0);
  const [form, setForm] = useState({
    shop_name: '', owner_name: '', email: '', password: '', phone: '', alternate_phone: '',
    address: '', city: '', pincode: '', gstin: '', upi_id: '',
    business_type: 'digital_printing', legal_business_name: '', year_established: '',
    registration_type: 'unregistered', registration_number: '',
    open_time: '09:00', close_time: '21:00', weekly_off: '',
    staff_count: '1', printer_count: '1', avg_daily_jobs: '', printer_details: '',
    referral_source: '',
  });
  const [services, setServices] = useState<string[]>(['print', 'photocopy', 'scan', 'bind', 'laminate']);
  const [inventory, setInventory] = useState<InvRow[]>([
    { name: 'A4 paper 80 GSM', category: 'paper', qty: '5000', unit: 'sheets', low_stock_threshold: '1000' },
    { name: 'Black toner cartridge', category: 'ink', qty: '2', unit: 'pcs', low_stock_threshold: '1' },
  ]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ message: string; code: string; path: string } | null>(null);
  const [photo, setPhoto] = useState<File | null>(null);
  const [nameCheck, setNameCheck] = useState<{ name: string; status: 'idle' | 'checking' | 'available' | 'duplicate' | 'error' }>({ name: '', status: 'idle' });
  const [nameRetry, setNameRetry] = useState(0);
  const normalizedName = normalizeShopName(form.shop_name);

  useEffect(() => {
    if (normalizedName.length < 2) { setNameCheck({ name: normalizedName, status: 'idle' }); return; }
    const controller = new AbortController();
    setNameCheck({ name: normalizedName, status: 'checking' });
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/shop/name-check?name=${encodeURIComponent(form.shop_name.trim())}`, { signal: controller.signal, cache: 'no-store' });
        if (!res.ok) throw new Error('Name check failed');
        const result = await res.json();
        setNameCheck({ name: normalizedName, status: result.duplicate ? 'duplicate' : 'available' });
      } catch {
        if (!controller.signal.aborted) setNameCheck({ name: normalizedName, status: 'error' });
      }
    }, 350);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [normalizedName, nameRetry]); // normalized names are the same key used by the server

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setForm({ ...form, [k]: e.target.value });

  const stepValid = useMemo(() => {
    const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim());
    const phoneOk = form.phone.replace(/\D/g, '').length >= 8;
    switch (step) {
      case 0: return normalizedName.length >= 2 && nameCheck.name === normalizedName &&
        (nameCheck.status === 'available' || (nameCheck.status === 'duplicate' && (!!photo || isGstinFormat(form.gstin)))) &&
        form.owner_name.trim().length >= 2 && emailOk && form.password.length >= 8 && phoneOk && form.address.trim().length >= 3 && form.city.trim().length >= 2;
      case 1: return true; // business details are optional but encouraged
      case 2: return services.length >= 1;
      case 3: return inventory.every((i) => !i.name.trim() || Number(i.qty || 0) >= 0);
      default: return true;
    }
  }, [step, form, services, inventory, nameCheck, normalizedName, photo]);

  const toggleService = (v: string) => setServices((s) => (s.includes(v) ? s.filter((x) => x !== v) : [...s, v]));
  const setInv = (idx: number, k: keyof InvRow, v: string) => setInventory((rows) => rows.map((r, i) => (i === idx ? { ...r, [k]: v } : r)));
  const addInv = () => setInventory((rows) => [...rows, { name: '', category: 'other', qty: '', unit: 'pcs', low_stock_threshold: '10' }]);
  const removeInv = (idx: number) => setInventory((rows) => rows.filter((_, i) => i !== idx));

  const submit = async () => {
    setBusy(true); setError(null);
    try {
      const payload = {
        shop_name: form.shop_name.trim(),
        owner_name: form.owner_name.trim(),
        email: form.email.trim(),
        password: form.password,
        phone: form.phone.trim(),
        alternate_phone: form.alternate_phone.trim() || undefined,
        address: form.address.trim(),
        city: form.city.trim(),
        pincode: form.pincode.trim() || undefined,
        gstin: form.gstin.trim() || undefined,
        upi_id: form.upi_id.trim() || undefined,
        business_type: form.business_type,
        legal_business_name: form.legal_business_name.trim() || undefined,
        year_established: form.year_established ? Number(form.year_established) : undefined,
        staff_count: Number(form.staff_count || 1),
        printer_count: Number(form.printer_count || 0),
        avg_daily_jobs: form.avg_daily_jobs ? Number(form.avg_daily_jobs) : undefined,
        printer_details: form.printer_details.trim() || undefined,
        registration_type: form.registration_type,
        registration_number: form.registration_number.trim() || undefined,
        business_hours: { open_time: form.open_time, close_time: form.close_time, weekly_off: form.weekly_off.trim() },
        referral_source: form.referral_source.trim() || undefined,
        services,
        inventory: inventory
          .filter((i) => i.name.trim())
          .map((i) => ({
            name: i.name.trim(),
            category: i.category,
            qty: Number(i.qty || 0),
            unit: i.unit || 'pcs',
            low_stock_threshold: Number(i.low_stock_threshold || 0),
          })),
      };
      const body = new FormData();
      body.append('payload', JSON.stringify(payload));
      // Proof is only requested/submitted for an existing name.
      if (photo && nameCheck.status === 'duplicate') body.append('proof', photo);
      const res = await fetch('/api/shop/signup', { method: 'POST', body });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (data?.error?.code === 'duplicate_name_requires_proof') {
          setNameCheck({ name: normalizedName, status: 'duplicate' });
          setStep(0);
        }
        setError(data?.error?.message ?? 'Signup failed');
        return;
      }
      setDone({ message: data.message ?? 'Application received', code: data.short_code, path: data.customer_path });
    } catch {
      setError('Could not submit your application. Please check your connection and try again.');
    } finally { setBusy(false); }
  };

  if (done) {
    return (
      <div className="min-h-screen grid place-items-center px-6">
        <div className="card max-w-md p-8 text-center">
          <CheckCircle2 size={48} className="mx-auto text-green-600" />
          <h1 className="mt-4 text-2xl font-extrabold">Application received!</h1>
          <p className="mt-2 text-sm text-neutral-600">{done.message}</p>
          <div className="mt-4 rounded-2xl border border-orange-200 bg-orange-50 p-4">
            <p className="text-xs font-semibold text-orange-900">Your unique shop code</p>
            <p className="mt-1 font-mono text-xl font-extrabold tracking-wider text-orange-900">{done.code}</p>
            <p className="mt-1 text-xs text-orange-800">Customer link: {done.path}</p>
          </div>
          <p className="mt-3 text-xs text-neutral-500">Sign in with your email to track verification. Your customer link works after approval.</p>
          <Link href="/login" className="btn btn-dark h-12 px-6 mt-6 inline-flex">Go to sign in</Link>
        </div>
      </div>
    );
  }

  const StepIcon = STEPS[step].icon;

  return (
    <div className="min-h-screen bg-[radial-gradient(1000px_500px_at_50%_-10%,#ffedd5,transparent)]">
      <header className="max-w-3xl mx-auto px-4 h-14 flex items-center"><Logo /></header>
      <main className="max-w-3xl mx-auto px-4 pb-16">
        <div className="flex items-center gap-3 mt-2">
          <span className="w-11 h-11 rounded-2xl bg-orange-100 text-orange-700 grid place-items-center"><Store size={22} /></span>
          <div>
            <h1 className="text-2xl font-extrabold tracking-tight">List your shop on Printly</h1>
            <p className="text-xs text-neutral-500">Free to join · UPI direct to your account · Verified in 24–48h</p>
          </div>
        </div>

        {/* Progress */}
        <ol className="mt-6 grid grid-cols-4 gap-2">
          {STEPS.map((s, i) => {
            const Icon = s.icon;
            const active = i === step;
            const complete = i < step;
            return (
              <li key={s.key} className={cn('rounded-2xl border p-3 text-center transition-colors', active ? 'border-orange-300 bg-orange-50' : complete ? 'border-green-200 bg-green-50' : 'border-neutral-200 bg-white')}>
                <span className={cn('mx-auto w-8 h-8 rounded-full grid place-items-center', active ? 'bg-orange-600 text-white' : complete ? 'bg-green-600 text-white' : 'bg-neutral-100 text-neutral-500')}>
                  {complete ? <Check size={15} /> : <Icon size={15} />}
                </span>
                <div className="mt-1.5 text-[11px] font-extrabold leading-tight">{s.label}</div>
                <div className="hidden sm:block text-[10px] text-neutral-400 leading-tight mt-0.5">{s.hint}</div>
              </li>
            );
          })}
        </ol>
        <div className="mt-3 h-1.5 rounded-full bg-neutral-200 overflow-hidden"><div className="h-full bg-orange-600 transition-all" style={{ width: `${((step + 1) / STEPS.length) * 100}%` }} /></div>
        <p className="mt-1.5 text-[11px] text-neutral-400">Step {step + 1} of {STEPS.length} — {STEPS[step].hint}</p>

        <div className="card mt-4 p-5 sm:p-6">
          {step === 0 && (
            <div className="grid sm:grid-cols-2 gap-4">
              <div className="sm:col-span-2">
                <label className="label" htmlFor="shop-name">Shop name *</label>
                <input id="shop-name" className="input" value={form.shop_name} onChange={set('shop_name')} placeholder="e.g. Bright Prints" maxLength={80} />
                {nameCheck.name === normalizedName && nameCheck.status === 'checking' && <p className="mt-1 text-xs text-neutral-500" role="status">Checking this name…</p>}
                {nameCheck.name === normalizedName && nameCheck.status === 'available' && <p className="mt-1 text-xs text-green-700" role="status">This name is available. No name proof is required.</p>}
                {nameCheck.name === normalizedName && nameCheck.status === 'error' && <p className="mt-1 text-xs text-red-700">Could not check this name. <button type="button" onClick={() => setNameRetry((n) => n + 1)} className="underline font-bold">Try again</button></p>}
              </div>
              {nameCheck.name === normalizedName && nameCheck.status === 'duplicate' && (
                <div className="sm:col-span-2 rounded-2xl border border-amber-300 bg-amber-50 p-4" role="status">
                  <p className="font-bold text-sm text-amber-950">Another shop already uses this name</p>
                  <p className="mt-1 text-xs text-amber-900">You can still apply. Provide either a shop photo here or a GSTIN below. Our team will review it before approval; the format alone does not verify ownership.</p>
                  <label htmlFor="signup-photo" className="label mt-3">Shop photo (JPEG, PNG or WebP, up to 3 MB)</label>
                  <input id="signup-photo" className="input text-sm" type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => {
                    const file = event.target.files?.[0] ?? null;
                    if (file && (file.size > 3 * 1024 * 1024 || !['image/jpeg', 'image/png', 'image/webp'].includes(file.type))) {
                      setPhoto(null); event.target.value = ''; setError('Choose a JPEG, PNG or WebP photo under 3 MB.');
                    } else { setPhoto(file); setError(null); }
                  }} />
                  <p className="mt-1 text-xs text-amber-900">Only the review team can see your photo. No photo is needed if you provide a GSTIN in the correct format.</p>
                </div>
              )}
              <div className="sm:col-span-2"><label className="label">Your name *</label><input className="input" value={form.owner_name} onChange={set('owner_name')} placeholder="Owner / manager name" autoComplete="name" /></div>
              <div><label className="label">Email *</label><input className="input" type="email" value={form.email} onChange={set('email')} placeholder="shop@example.com" autoComplete="email" /></div>
              <div><label className="label">Password * (min 8 chars)</label><input className="input" type="password" value={form.password} onChange={set('password')} autoComplete="new-password" placeholder="••••••••" /></div>
              <div><label className="label">Phone *</label><input className="input" value={form.phone} onChange={set('phone')} placeholder="99060 00000" inputMode="tel" autoComplete="tel" /></div>
              <div><label className="label">Alternate phone</label><input className="input" value={form.alternate_phone} onChange={set('alternate_phone')} placeholder="Optional" inputMode="tel" /></div>
              <div className="sm:col-span-2"><label className="label">Shop address *</label><input className="input" value={form.address} onChange={set('address')} placeholder="Shop number, street, landmark" /></div>
              <div><label className="label">City *</label><input className="input" value={form.city} onChange={set('city')} placeholder="Srinagar" /></div>
              <div><label className="label">PIN code</label><input className="input" value={form.pincode} onChange={set('pincode')} placeholder="190001" inputMode="numeric" /></div>
              <div><label className="label">GSTIN (optional)</label><input className="input" value={form.gstin} onChange={set('gstin')} placeholder="01ABCDE1234F1Z5" /></div>
              <div><label className="label">Your UPI ID</label><input className="input" value={form.upi_id} onChange={set('upi_id')} placeholder="name@okaxis" /></div>
              <p className="sm:col-span-2 text-[11px] text-neutral-500 -mt-1">Customers pay directly to this UPI ID. Printly never touches your money. You can change it anytime in Settings.</p>
            </div>
          )}

          {step === 1 && (
            <div className="grid sm:grid-cols-2 gap-4">
              <div><label className="label">Business type</label>
                <select className="input" value={form.business_type} onChange={set('business_type')}>
                  {BUSINESS_TYPES.map((b) => <option key={b.value} value={b.value}>{b.label}</option>)}
                </select>
              </div>
              <div><label className="label">Legal business name</label><input className="input" value={form.legal_business_name} onChange={set('legal_business_name')} placeholder="As on registration, if any" /></div>
              <div><label className="label">Year established</label><input className="input" type="number" min={1900} max={2100} value={form.year_established} onChange={set('year_established')} placeholder="e.g. 2018" /></div>
              <div><label className="label">Registration type</label>
                <select className="input" value={form.registration_type} onChange={set('registration_type')}>
                  {REG_TYPES.map((b) => <option key={b.value} value={b.value}>{b.label}</option>)}
                </select>
              </div>
              {form.registration_type !== 'unregistered' && (
                <div className="sm:col-span-2"><label className="label">Registration / GSTIN number</label><input className="input" value={form.registration_number} onChange={set('registration_number')} placeholder="Number as on the certificate" /></div>
              )}
              <div><label className="label">Opens at</label><input className="input" type="time" value={form.open_time} onChange={set('open_time')} /></div>
              <div><label className="label">Closes at</label><input className="input" type="time" value={form.close_time} onChange={set('close_time')} /></div>
              <div className="sm:col-span-2"><label className="label">Weekly off (optional)</label><input className="input" value={form.weekly_off} onChange={set('weekly_off')} placeholder="e.g. Sunday" /></div>
              <div><label className="label">How did you hear about Printly?</label><input className="input" value={form.referral_source} onChange={set('referral_source')} placeholder="Friend, Google, walk-in…" /></div>
              <p className="sm:col-span-2 text-[11px] text-neutral-500 -mt-1 flex items-center gap-1.5"><Clock size={12} />Hours shown on your customer page so people don&apos;t visit when you&apos;re closed.</p>
            </div>
          )}

          {step === 2 && (
            <div>
              <label className="label">Services you offer * (pick at least one)</label>
              <div className="grid sm:grid-cols-2 gap-2.5">
                {SERVICE_OPTIONS.map((s) => {
                  const on = services.includes(s.value);
                  return (
                    <button key={s.value} type="button" onClick={() => toggleService(s.value)} className={cn('text-left rounded-2xl border p-3.5 transition-colors', on ? 'border-orange-400 bg-orange-50' : 'border-neutral-200 bg-white hover:border-neutral-300')}>
                      <span className="flex items-center justify-between">
                        <span className="font-extrabold text-sm">{s.label}</span>
                        <span className={cn('w-5 h-5 rounded-full grid place-items-center', on ? 'bg-orange-600 text-white' : 'bg-neutral-100 text-neutral-400')}>{on && <Check size={12} />}</span>
                      </span>
                      <span className="block text-[11px] text-neutral-500 mt-0.5">{s.desc}</span>
                    </button>
                  );
                })}
              </div>
              <div className="grid sm:grid-cols-3 gap-4 mt-5">
                <div><label className="label">Staff count</label><input className="input" type="number" min={1} max={100} value={form.staff_count} onChange={set('staff_count')} /></div>
                <div><label className="label">Printers</label><input className="input" type="number" min={0} max={100} value={form.printer_count} onChange={set('printer_count')} /></div>
                <div><label className="label">Avg jobs / day</label><input className="input" type="number" min={0} value={form.avg_daily_jobs} onChange={set('avg_daily_jobs')} placeholder="e.g. 120" /></div>
              </div>
              <div className="mt-4"><label className="label">Printer / equipment details</label>
                <textarea className="input min-h-20 text-sm" value={form.printer_details} onChange={set('printer_details')} placeholder="e.g. 2× HP LaserJet Pro M404, 1× Epson L8050 colour, 1× Canon photocopier…" />
              </div>
              <p className="text-[11px] text-neutral-500 mt-2">We seed a sensible default rate card for the services you pick — you can edit every price in Settings after approval.</p>
            </div>
          )}

          {step === 3 && (
            <div>
              <label className="label">Starting inventory (optional — add what you have today)</label>
              <div className="space-y-2.5">
                {inventory.map((row, idx) => (
                  <div key={idx} className="grid grid-cols-12 gap-2 items-end rounded-2xl border border-neutral-200 p-3">
                    <div className="col-span-12 sm:col-span-4"><label className="label">Item name</label><input className="input h-10 text-sm" value={row.name} onChange={(e) => setInv(idx, 'name', e.target.value)} placeholder="e.g. A4 paper 80 GSM" /></div>
                    <div className="col-span-6 sm:col-span-3"><label className="label">Category</label>
                      <select className="input h-10 text-sm" value={row.category} onChange={(e) => setInv(idx, 'category', e.target.value)}>
                        {INV_CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                      </select>
                    </div>
                    <div className="col-span-3 sm:col-span-2"><label className="label">Qty</label><input className="input h-10 text-sm" type="number" min={0} value={row.qty} onChange={(e) => setInv(idx, 'qty', e.target.value)} placeholder="0" /></div>
                    <div className="col-span-3 sm:col-span-2"><label className="label">Unit</label><input className="input h-10 text-sm" value={row.unit} onChange={(e) => setInv(idx, 'unit', e.target.value)} placeholder="sheets" /></div>
                    <div className="col-span-12 sm:col-span-1 flex sm:justify-center"><button type="button" onClick={() => removeInv(idx)} className="p-2 text-red-600 hover:bg-red-50 rounded-lg" aria-label="Remove item"><Trash2 size={16} /></button></div>
                  </div>
                ))}
              </div>
              <button type="button" onClick={addInv} className="btn btn-ghost h-10 px-4 text-sm mt-3"><Plus size={15} />Add another item</button>

              {/* Review summary */}
              <div className="mt-6 rounded-2xl bg-neutral-50 border border-neutral-200 p-4">
                <h3 className="text-sm font-extrabold flex items-center gap-2"><ShieldCheck size={15} className="text-green-600" />Review before you submit</h3>
                <dl className="mt-2 grid sm:grid-cols-2 gap-x-6 text-sm">
                  {[['Shop', form.shop_name], ['Owner', form.owner_name], ['Email', form.email], ['Phone', form.phone], ['City', form.city], ['Business type', BUSINESS_TYPES.find((b) => b.value === form.business_type)?.label], ['Services', SERVICE_OPTIONS.filter((s) => services.includes(s.value)).map((s) => s.label).join(', ')], ['Printers', form.printer_count], ['Inventory items', String(inventory.filter((i) => i.name.trim()).length)], ['Hours', `${form.open_time} – ${form.close_time}${form.weekly_off ? ` · off ${form.weekly_off}` : ''}`]].map(([k, v]) => (
                    <div key={k} className="flex justify-between gap-3 py-1.5 border-b border-neutral-200/70 last:border-0"><dt className="text-neutral-500 text-xs">{k}</dt><dd className="font-semibold text-xs text-right">{v || '—'}</dd></div>
                  ))}
                </dl>
              </div>
            </div>
          )}

          {error && <p className="mt-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl px-3 py-2 flex items-center gap-2"><CircleAlert size={15} />{error}</p>}
          {!stepValid && step === 0 && <p className="mt-4 text-[11px] text-neutral-500">Fill shop name, your name, a valid email, password (8+ chars), phone, address and city to continue.</p>}

          <div className="flex items-center gap-3 mt-6">
            {step > 0 && <button onClick={() => setStep(step - 1)} className="btn btn-ghost h-12 px-5 text-sm"><ArrowLeft size={16} />Back</button>}
            {step < STEPS.length - 1 ? (
              <button onClick={() => setStep(step + 1)} disabled={!stepValid} className="btn btn-primary h-12 px-6 text-sm flex-1">Continue <ArrowRight size={16} /></button>
            ) : (
              <button onClick={submit} disabled={busy || !stepValid} className="btn btn-primary h-12 px-6 text-sm flex-1">
                {busy ? <Loader2 size={18} className="animate-spin" /> : <><CheckCircle2 size={18} />Submit application</>}
              </button>
            )}
          </div>
          <p className="text-center text-[11px] text-neutral-400 mt-3">We verify shops within 24–48h. Already applied? <Link href="/login" className="font-bold text-orange-700 hover:underline">Sign in</Link></p>
        </div>

        <div className="mt-4 flex items-center justify-center gap-2 text-[11px] text-neutral-400">
          <StepIcon size={12} /> Step {step + 1} of {STEPS.length} · Your details go straight to our review team — no spam, ever.
        </div>
      </main>
    </div>
  );
}
