'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { createBrowserSupabase } from '@/lib/supabase-client';
import { portalDestination, type Portal } from '@/lib/portal-auth';
import { authAttemptError, checkLoginAttempt } from '@/lib/login-attempt';
import { Logo } from '@/components/Logo';
import { Loader2, Store, ShieldCheck } from 'lucide-react';

function LoginForm({ portal }: { portal: Portal }) {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const isAdmin = portal === 'admin';

  const signIn = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const supabase = createBrowserSupabase();
      try { await checkLoginAttempt(portal); }
      catch (err) { setError(err instanceof Error ? err.message : 'Sign-in protection is temporarily unavailable.'); return; }
      const { data, error: signInError } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (signInError || !data.user) {
        setError(authAttemptError(signInError));
        return;
      }
      const { data: profile, error: profileError } = await supabase.from('profiles').select('role').eq('id', data.user.id).maybeSingle();
      if (profileError || !profile) {
        const { error: signOutError } = await supabase.auth.signOut({ scope: 'local' });
        setError(signOutError ? 'Your account could not be verified and server sign-out could not be confirmed. Keep this device private and contact an administrator.' : 'Your account could not be verified. Please try again or contact support.');
        return;
      }
      if (isAdmin && profile.role !== 'admin') {
        const { error: signOutError } = await supabase.auth.signOut({ scope: 'local' });
        setError(signOutError ? 'This account is not an administrator and server sign-out could not be confirmed. Keep this device private and contact an administrator.' : 'This account does not have administrator access.');
        return;
      }
      // Admins who use an older shop-login link still reach their own console,
      // never an arbitrary shop. Shop accounts can never enter the admin portal.
      const actualPortal: Portal = profile.role === 'admin' ? 'admin' : 'shop';
      const next = actualPortal === portal ? params.get('next') : null;
      router.replace(portalDestination(actualPortal, next));
      router.refresh();
    } catch {
      setError('Could not reach the sign-in service. Please check your connection and try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={isAdmin ? 'min-h-screen grid place-items-center px-4 bg-indigo-50' : 'min-h-screen grid place-items-center px-4 bg-[radial-gradient(1000px_500px_at_50%_-10%,#ffedd5,transparent)]'}>
      <div className="w-full max-w-sm">
        <div className="flex justify-center"><Logo /></div>
        <form onSubmit={signIn} className="card mt-6 p-6">
          <div className="flex items-center gap-2">
            <span className={isAdmin ? 'w-9 h-9 rounded-xl bg-indigo-100 text-indigo-700 grid place-items-center' : 'w-9 h-9 rounded-xl bg-orange-100 text-orange-700 grid place-items-center'}>
              {isAdmin ? <ShieldCheck size={18} /> : <Store size={18} />}
            </span>
            <div>
              <h1 className="font-extrabold text-lg leading-tight">{isAdmin ? 'Admin sign in' : 'Shop owner sign in'}</h1>
              <p className="text-[11px] text-neutral-500">{isAdmin ? 'For Printly administrators' : 'Sign in to manage your shop'}</p>
            </div>
          </div>
          <label htmlFor="login-email" className="label mt-5">Email</label>
          <input id="login-email" value={email} onChange={(e) => setEmail(e.target.value)} className="input" type="email" autoComplete="username" placeholder="you@example.com" required />
          <label htmlFor="login-password" className="label mt-3">Password</label>
          <input id="login-password" value={password} onChange={(e) => setPassword(e.target.value)} className="input" type="password" autoComplete="current-password" placeholder="••••••••" required />
          {error && <p role="alert" className="mt-3 text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl px-3 py-2">{error}</p>}
          <button type="submit" disabled={busy || !email || !password} className="btn btn-dark w-full h-12 mt-4">{busy ? <Loader2 className="animate-spin" size={18} /> : 'Sign in'}</button>
          {!isAdmin && <div className="mt-4 text-center text-xs text-neutral-500">New shop? <Link href="/shop/signup" className="font-bold text-orange-700 hover:underline">Apply to join Printly</Link></div>}
        </form>
        <p className="text-center text-[11px] text-neutral-500 mt-4 flex items-center justify-center gap-1"><ShieldCheck size={12} /> Stay signed in on this device. Sign out on shared devices.</p>
      </div>
    </div>
  );
}

export function PortalLogin({ portal }: { portal: Portal }) {
  return <Suspense fallback={<div className="min-h-screen grid place-items-center">Loading sign in…</div>}><LoginForm portal={portal} /></Suspense>;
}
