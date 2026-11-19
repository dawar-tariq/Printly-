'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { createBrowserSupabase } from '@/lib/supabase-client';
import { Logo } from '@/components/Logo';
import { Loader2, Store, ShieldCheck } from 'lucide-react';

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get('next') || '/shop';
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const signIn = async () => {
    setBusy(true); setError(null);
    const supabase = createBrowserSupabase();
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    if (error) { setError(error.message); return; }
    router.push(next);
    router.refresh();
  };

  return (
    <div className="min-h-screen grid place-items-center px-4 bg-[radial-gradient(1000px_500px_at_50%_-10%,#ffedd5,transparent)]">
      <div className="w-full max-w-sm">
        <div className="flex justify-center"><Logo /></div>
        <div className="card mt-6 p-6">
          <div className="flex items-center gap-2">
            <span className="w-9 h-9 rounded-xl bg-orange-100 text-orange-700 grid place-items-center"><Store size={18} /></span>
            <div>
              <h1 className="font-extrabold text-lg leading-tight">Shop & Admin</h1>
              <p className="text-[11px] text-neutral-500">Sign in to manage your shop</p>
            </div>
          </div>
          <label className="label mt-5">Email</label>
          <input value={email} onChange={(e) => setEmail(e.target.value)} className="input" type="email" autoComplete="email" placeholder="you@shop.com" />
          <label className="label mt-3">Password</label>
          <input value={password} onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && signIn()} className="input" type="password" autoComplete="current-password" placeholder="••••••••" />
          {error && <p className="mt-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl px-3 py-2">{error}</p>}
          <button onClick={signIn} disabled={busy || !email || !password} className="btn btn-dark w-full h-12 mt-4">{busy ? <Loader2 className="animate-spin" size={18} /> : 'Sign in'}</button>
          <div className="mt-4 text-center text-xs text-neutral-500">
            New shop? <Link href="/shop/signup" className="font-bold text-orange-700 hover:underline">Apply to join Printly</Link>
          </div>
        </div>
        <p className="text-center text-[11px] text-neutral-400 mt-4 flex items-center justify-center gap-1"><ShieldCheck size={12} /> Session secured by Supabase Auth</p>
        <div className="text-center text-[10px] text-neutral-300 mt-2">Demo: demoshop@printly.test / demo1234 · admin@printly.test / demo1234</div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return <Suspense><LoginForm /></Suspense>;
}
