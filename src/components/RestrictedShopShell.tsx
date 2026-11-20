'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { LogOut } from 'lucide-react';
import { Logo } from '@/components/Logo';
import { createBrowserSupabase } from '@/lib/supabase-client';
import { cn } from '@/lib/utils';
import { SubscriptionNotice } from '@/components/SubscriptionNotice';
import type { ShopSubscription } from '@/lib/subscription';
import { useSubscriptionState } from '@/lib/use-subscription-state';

export function RestrictedShopShell({ shopName, active, subscription, warningDays, isOwner, children }: { shopName: string; active: boolean; subscription: ShopSubscription | null; warningDays: number; isOwner: boolean; children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const current = useSubscriptionState(subscription, warningDays);
  return (
    <div className="min-h-screen bg-neutral-100">
      <header className="bg-neutral-950 text-white no-print">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-3 sm:px-4">
          <Logo inverse compactOnMobile />
          <span className="min-w-0 flex-1 truncate text-sm font-bold">{shopName}</span>
          <button aria-label="Sign out" className="rounded-lg p-2 text-neutral-300 hover:bg-neutral-800" onClick={async () => { await createBrowserSupabase().auth.signOut(); router.push('/login'); router.refresh(); }}><LogOut size={18} /></button>
        </div>
        <nav aria-label="Subscription and recovery" className="mx-auto flex max-w-6xl gap-1 overflow-x-auto px-2 pb-1.5">
          {[{ href: '/shop/subscription', label: 'Subscription' }, { href: '/shop/recovery', label: 'Open orders' }, ...(active && current.active ? [{ href: '/shop', label: 'Dashboard' }] : [])].map(({ href, label }) => (
            <Link key={href} href={href} className={cn('whitespace-nowrap rounded-lg px-3 py-2 text-sm font-semibold', pathname === href || pathname.startsWith(`${href}/`) ? 'bg-orange-600 text-white' : 'text-neutral-300 hover:bg-neutral-800')}>{label}</Link>
          ))}
        </nav>
      </header>
      <main className="mx-auto min-w-0 max-w-6xl px-3 py-5 sm:px-4"><SubscriptionNotice subscription={subscription} warningDays={warningDays} isOwner={isOwner} lockOnExpire={false} />{children}</main>
    </div>
  );
}
