'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Logo } from '@/components/Logo';
import { SignOutButton } from '@/components/SignOutButton';
import { cn } from '@/lib/utils';
import { SubscriptionNotice } from '@/components/SubscriptionNotice';
import type { ShopSubscription } from '@/lib/subscription';
import { useSubscriptionState } from '@/lib/use-subscription-state';
import styles from './RestrictedShopShell.module.css';

export function RestrictedShopShell({ shopName, isOpen, active, subscription, warningDays, isOwner, children }: { shopName: string; isOpen?: boolean; active: boolean; subscription: ShopSubscription | null; warningDays: number; isOwner: boolean; children: React.ReactNode }) {
  const pathname = usePathname();
  const current = useSubscriptionState(subscription, warningDays);
  return (
    <div className={styles.shell}>
      <header className={`no-print ${styles.header}`}>
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-3 sm:px-4">
          <Logo />
          <span className="min-w-0 flex-1 truncate text-sm font-bold">{shopName}</span>
          <SignOutButton portal="shop" buttonClassName="text-neutral-600 hover:bg-orange-50" />
        </div>
        <nav aria-label="Subscription and recovery" className="mx-auto flex max-w-6xl gap-1 overflow-x-auto px-2 pb-1.5">
          {[{ href: '/shop/subscription', label: 'Subscription' }, { href: '/shop/recovery', label: 'Open orders' }, { href: '/shop/app', label: 'Android app' }, { href: '/support', label: 'Support' }, ...(active && current.active ? [{ href: '/shop', label: 'Dashboard' }] : [])].map(({ href, label }) => (
            <Link key={href} href={href} className={cn('whitespace-nowrap rounded-lg px-3 py-2 text-sm font-semibold', pathname === href || pathname.startsWith(`${href}/`) ? 'bg-orange-50 text-orange-800' : 'text-neutral-600 hover:bg-neutral-100')}>{label}</Link>
          ))}
        </nav>
      </header>
      <main className="mx-auto min-w-0 max-w-6xl px-3 py-5 sm:px-4"><SubscriptionNotice subscription={subscription} warningDays={warningDays} isOwner={isOwner} lockOnExpire={false} /><div className={styles.content}>{children}</div></main>
    </div>
  );
}
