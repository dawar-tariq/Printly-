'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Logo } from '@/components/Logo';
import { createBrowserSupabase } from '@/lib/supabase-client';
import { LayoutDashboard, Settings, Boxes, BarChart3, LogOut, ExternalLink, Hourglass, PenLine, Ban } from 'lucide-react';
import { cn } from '@/lib/utils';
import { publicShopPath } from '@/lib/shop-identity';

const TABS = [
  { href: '/shop', label: 'Orders', icon: LayoutDashboard, exact: true },
  { href: '/shop/inventory', label: 'Inventory', icon: Boxes },
  { href: '/shop/reports', label: 'Reports', icon: BarChart3 },
  { href: '/shop/settings', label: 'Settings & QR', icon: Settings },
];

export function ShopShell({ shop, reviewNote, children }: { shop: { id: string; name: string; slug: string; short_code: string; kyc_status: string; status: string }; reviewNote: string; children: React.ReactNode }) {
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
      <header className="no-print sticky top-0 z-30 bg-neutral-950 text-white">
        <div className="max-w-6xl mx-auto px-3 sm:px-4 h-14 flex items-center gap-3">
          <Logo inverse compactOnMobile />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-bold truncate leading-tight">{shop.name}</div>
            <div className="text-[10px] text-neutral-400 leading-tight">{shop.kyc_status === 'approved' ? 'Verified shop' : 'Verification pending'} · {shop.short_code} · <a className="hover:underline inline-flex items-center gap-0.5" href={publicShopPath(shop.short_code)} target="_blank" rel="noreferrer">customer page <ExternalLink size={9} /></a></div>
          </div>
          <button onClick={signOut} disabled={signingOut} className="p-2 rounded-lg hover:bg-neutral-800 text-neutral-300" aria-label="Sign out"><LogOut size={18} /></button>
        </div>
        <nav aria-label="Shop navigation" className="max-w-6xl w-full min-w-0 mx-auto px-2 sm:px-3 flex items-center gap-1 overflow-x-auto pb-1.5">
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
      <main className="max-w-6xl min-w-0 mx-auto px-3 sm:px-4 py-4">
        {shop.kyc_status === 'pending' && (
          <div className="mb-4 rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 flex items-start gap-2.5">
            <Hourglass size={16} className="mt-0.5 shrink-0" />
            <div><b>Verification in progress.</b> Our team is reviewing your application — usually within 24–48h. You can explore Inventory and Settings meanwhile; orders open once you&apos;re approved.</div>
          </div>
        )}
        {shop.kyc_status === 'changes_requested' && (
          <div className="mb-4 rounded-2xl border border-sky-300 bg-sky-50 px-4 py-3 text-sm text-sky-900 flex items-start gap-2.5">
            <PenLine size={16} className="mt-0.5 shrink-0" />
            <div><b>We need a little more info.</b> {reviewNote ? <span>Reviewer&apos;s note: {reviewNote}</span> : 'Please check Settings and update the details requested by our team.'} <Link href="/shop/settings" className="font-bold underline">Open Settings</Link></div>
          </div>
        )}
        {shop.kyc_status === 'rejected' && (
          <div className="mb-4 rounded-2xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-900 flex items-start gap-2.5">
            <Ban size={16} className="mt-0.5 shrink-0" />
            <div><b>Application not approved.</b> {reviewNote ? <span>Reviewer&apos;s note: {reviewNote}</span> : 'Please contact Printly support to understand what is needed.'}</div>
          </div>
        )}
        {children}
      </main>
    </div>
  );
}
