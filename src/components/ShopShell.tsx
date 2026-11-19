'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Logo } from '@/components/Logo';
import { createBrowserSupabase } from '@/lib/supabase-client';
import { LayoutDashboard, Settings, Boxes, BarChart3, LogOut, Printer, ExternalLink } from 'lucide-react';
import { cn } from '@/lib/utils';

const TABS = [
  { href: '/shop', label: 'Orders', icon: LayoutDashboard, exact: true },
  { href: '/shop/inventory', label: 'Inventory', icon: Boxes },
  { href: '/shop/reports', label: 'Reports', icon: BarChart3 },
  { href: '/shop/settings', label: 'Settings & QR', icon: Settings },
];

export function ShopShell({ shop, children }: { shop: { id: string; name: string; slug: string; kyc_status: string; status: string }; children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);

  const signOut = async () => {
    setSigningOut(true);
    await createBrowserSupabase().auth.signOut();
    router.push('/login');
    router.refresh();
  };

  return (
    <div className="min-h-screen bg-neutral-100">
      <header className="sticky top-0 z-30 bg-neutral-950 text-white">
        <div className="max-w-6xl mx-auto px-3 sm:px-4 h-14 flex items-center gap-3">
          <Link href="/" className="flex items-center gap-2 font-extrabold shrink-0"><span className="w-7 h-7 rounded-lg bg-orange-600 grid place-items-center"><Printer size={15} /></span><span className="hidden xs:inline">Printly</span></Link>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-bold truncate leading-tight">{shop.name}</div>
            <div className="text-[10px] text-neutral-400 leading-tight">{shop.kyc_status === 'approved' ? 'Verified shop' : 'Verification pending'} · <a className="hover:underline inline-flex items-center gap-0.5" href={`/s/${shop.slug}`} target="_blank">customer page <ExternalLink size={9} /></a></div>
          </div>
          <button onClick={signOut} disabled={signingOut} className="p-2 rounded-lg hover:bg-neutral-800 text-neutral-300" aria-label="Sign out"><LogOut size={18} /></button>
        </div>
        <nav className="max-w-6xl mx-auto px-2 sm:px-3 flex items-center gap-1 overflow-x-auto pb-1.5">
          {TABS.map(({ href, label, icon: Icon, exact }) => {
            const active = exact ? pathname === href : pathname.startsWith(href);
            return (
              <Link key={href} href={href} className={cn('flex items-center gap-1.5 px-3 h-9 rounded-lg text-[13px] font-semibold whitespace-nowrap transition-colors', active ? 'bg-orange-600 text-white' : 'text-neutral-300 hover:bg-neutral-800')}>
                <Icon size={15} />{label}
              </Link>
            );
          })}
        </nav>
      </header>
      <main className="max-w-6xl mx-auto px-3 sm:px-4 py-4">{children}</main>
    </div>
  );
}
