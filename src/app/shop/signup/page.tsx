'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Logo } from '@/components/Logo';
import { Loader2, CheckCircle2, Store } from 'lucide-react';

export default function ShopSignupPage() {
  const [form, setForm] = useState({ shop_name: '', owner_name: '', email: '', password: '', phone: '', address: '', city: '', gstin: '', upi_id: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });

  const submit = async () => {
    setBusy(true); setError(null);
    try {
      const res = await fetch('/api/shop/signup', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, gstin: form.gstin || undefined, upi_id: form.upi_id || undefined }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(data?.error?.message ?? 'Signup failed'); return; }
      setDone(data.message ?? 'Application received');
    } finally { setBusy(false); }
  };

  if (done) {
    return (
      <div className="min-h-screen grid place-items-center px-6">
        <div className="card max-w-md p-8 text-center">
          <CheckCircle2 size={48} className="mx-auto text-green-600" />
          <h1 className="mt-4 text-2xl font-extrabold">Application received!</h1>
          <p className="mt-2 text-sm text-neutral-600">{done}</p>
          <Link href="/login" className="btn btn-dark h-12 px-6 mt-6 inline-flex">Go to sign in</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[radial-gradient(1000px_500px_at_50%_-10%,#ffedd5,transparent)]">
      <header className="max-w-2xl mx-auto px-4 h-14 flex items-center"><Logo /></header>
      <main className="max-w-2xl mx-auto px-4 pb-16">
        <div className="flex items-center gap-3 mt-2">
          <span className="w-11 h-11 rounded-2xl bg-orange-100 text-orange-700 grid place-items-center"><Store size={22} /></span>
          <div>
            <h1 className="text-2xl font-extrabold tracking-tight">List your shop on Printly</h1>
            <p className="text-xs text-neutral-500">Free to join · You keep 100% of offline/cash sales · UPI direct to your account</p>
          </div>
        </div>

        <div className="card mt-5 p-5 sm:p-6 grid sm:grid-cols-2 gap-4">
          <div className="sm:col-span-2"><label className="label">Shop name *</label><input className="input" value={form.shop_name} onChange={set('shop_name')} placeholder="e.g. Bright Prints, Lal Chowk" /></div>
          <div className="sm:col-span-2"><label className="label">Your name *</label><input className="input" value={form.owner_name} onChange={set('owner_name')} placeholder="Owner / manager name" autoComplete="name" /></div>
          <div><label className="label">Email *</label><input className="input" type="email" value={form.email} onChange={set('email')} placeholder="shop@example.com" autoComplete="email" /></div>
          <div><label className="label">Password * (min 8 chars)</label><input className="input" type="password" value={form.password} onChange={set('password')} autoComplete="new-password" placeholder="••••••••" /></div>
          <div><label className="label">Phone *</label><input className="input" value={form.phone} onChange={set('phone')} placeholder="99060 00000" inputMode="numeric" autoComplete="tel" /></div>
          <div><label className="label">City *</label><input className="input" value={form.city} onChange={set('city')} placeholder="Srinagar" /></div>
          <div className="sm:col-span-2"><label className="label">Shop address *</label><input className="input" value={form.address} onChange={set('address')} placeholder="Shop number, street, landmark" /></div>
          <div><label className="label">GSTIN (optional)</label><input className="input" value={form.gstin} onChange={set('gstin')} placeholder="01ABCDE1234F1Z5" /></div>
          <div><label className="label">Your UPI ID</label><input className="input" value={form.upi_id} onChange={set('upi_id')} placeholder="name@okaxis" /></div>
          <div className="sm:col-span-2 text-[11px] text-neutral-500 -mt-1">Customers will pay directly to this UPI ID. Printly never touches your money. You can change it anytime in Settings.</div>

          {error && <p className="sm:col-span-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl px-3 py-2">{error}</p>}
          <button onClick={submit} disabled={busy} className="sm:col-span-2 btn btn-primary h-13 py-4 text-lg">
            {busy ? <Loader2 size={20} className="animate-spin" /> : 'Submit application'}
          </button>
          <p className="sm:col-span-2 text-center text-[11px] text-neutral-400">We verify shops within 24–48h. Already approved? <Link href="/login" className="font-bold text-orange-700 hover:underline">Sign in</Link></p>
        </div>
      </main>
    </div>
  );
}
