'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { LogOut } from 'lucide-react';
import { createBrowserSupabase } from '@/lib/supabase-client';
import { cn } from '@/lib/utils';

/** Sign out this browser only; never silently claim server revocation on error. */
export function SignOutButton({ portal, className, buttonClassName }: { portal: 'shop' | 'admin'; className?: string; buttonClassName?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);

  async function signOut() {
    if (busy || uncertain) return;
    setBusy(true);
    try {
      const { error } = await createBrowserSupabase().auth.signOut({ scope: 'local' });
      if (error) { setUncertain(true); return; }
      router.replace(portal === 'admin' ? '/admin/login' : '/login');
      router.refresh();
    } catch { setUncertain(true); }
    finally { setBusy(false); }
  }

  return <div className={cn('relative', className)}>
    <button onClick={signOut} disabled={busy || uncertain} className={cn('rounded-lg p-2 text-neutral-300 hover:bg-neutral-800 disabled:opacity-50', buttonClassName)} aria-label="Sign out"><LogOut size={18} /></button>
    {uncertain && <p role="alert" className="absolute right-0 top-full z-50 w-72 rounded-xl border border-red-200 bg-white p-3 text-xs font-medium text-red-800 shadow-lg">Server sign-out could not be confirmed. Your session may still be active. Keep this device private and ask an administrator to revoke the session.</p>}
  </div>;
}
