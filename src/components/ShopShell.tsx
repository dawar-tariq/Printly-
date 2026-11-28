'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Logo } from '@/components/Logo';
import { SignOutButton } from '@/components/SignOutButton';
import { LayoutDashboard, Settings, Boxes, BarChart3, CreditCard, ExternalLink, Hourglass, PenLine, Ban, MessageCircle, House, MoreHorizontal, Bell } from 'lucide-react';
import { SubscriptionNotice } from '@/components/SubscriptionNotice';
import { ShopAvailability } from '@/components/ShopAvailability';
import { OwnerAppUpdatePrompt } from '@/components/OwnerAppUpdatePrompt';
import { ShopApplicationStatus } from '@/components/ShopApplicationStatus';
import type { ShopSubscription } from '@/lib/subscription';
import { cn } from '@/lib/utils';
import { publicShopPath } from '@/lib/shop-identity';
import styles from './ShopShell.module.css';

const TABS = [
  { href: '/shop/home', label: 'Overview', icon: House },
  { href: '/shop', label: 'Orders', icon: LayoutDashboard },
  { href: '/shop/inventory', label: 'Inventory', icon: Boxes },
  { href: '/shop/reports', label: 'Reports', icon: BarChart3 },
  { href: '/shop/subscription', label: 'Subscription', icon: CreditCard },
  { href: '/shop/settings', label: 'Settings & QR', icon: Settings },
  { href: '/shop/app', label: 'Android app', icon: Bell },
  { href: '/support', label: 'Support', icon: MessageCircle },
];

const MOBILE_TABS = [
  { href: '/shop/home', label: 'Home', icon: House },
  { href: '/shop', label: 'Orders', icon: LayoutDashboard },
  { href: '/shop/inventory', label: 'Inventory', icon: Boxes },
  { href: '/shop/reports', label: 'Reports', icon: BarChart3 },
  { href: '/shop/more', label: 'More', icon: MoreHorizontal },
];

function activeTab(pathname: string, href: string): boolean {
  if (href === '/shop') return pathname === '/shop' || pathname.startsWith('/shop/orders/');
  if (href === '/shop/more') return ['/shop/more', '/shop/settings', '/shop/app', '/shop/recovery', '/shop/subscription', '/shop/standee'].some((route) => pathname === route || pathname.startsWith(`${route}/`));
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function ShopShell({ shop, reviewNote, subscription, warningDays, isOwner, children }: { shop: { id: string; name: string; slug: string; short_code: string; kyc_status: string; status: string; is_open: boolean }; reviewNote: string; subscription: ShopSubscription | null; warningDays: number; isOwner: boolean; children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className={styles.shell}>
      <header className={`no-print ${styles.header}`}>
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-4">
          <Logo />
          <div className="hidden min-w-0 flex-1 md:block">
            <div className="truncate text-sm font-bold leading-tight">{shop.name}</div>
            <div className="text-[10px] leading-tight text-neutral-500">{shop.kyc_status === 'approved' ? 'Verified shop' : 'Verification pending'} · {shop.short_code} · <a className="inline-flex items-center gap-0.5 hover:underline" href={publicShopPath(shop.short_code)} target="_blank" rel="noreferrer">customer page <ExternalLink size={9} /></a></div>
          </div>
          <div className="flex-1 md:hidden" />
          <Link href="/shop/app" aria-label="App and notification settings" className="grid h-10 w-10 place-items-center rounded-xl text-neutral-600 hover:bg-orange-50 md:hidden"><Bell size={19} /></Link>
          <SignOutButton portal="shop" buttonClassName="text-neutral-600 hover:bg-orange-50" />
        </div>
        <nav aria-label="Shop navigation" className="mx-auto hidden w-full min-w-0 max-w-6xl items-center gap-1 overflow-x-auto px-3 pb-1.5 md:flex">
          {TABS.map(({ href, label, icon: Icon }) => {
            const active = activeTab(pathname, href);
            return <Link key={href} href={href} aria-current={active ? 'page' : undefined} className={cn('flex h-9 items-center gap-1.5 whitespace-nowrap rounded-lg px-3 text-[13px] font-semibold transition-colors', active ? 'bg-orange-50 text-orange-800' : 'text-neutral-600 hover:bg-neutral-100')}><Icon size={15} />{label}</Link>;
          })}
        </nav>
      </header>
      <OwnerAppUpdatePrompt />
      <main className="mx-auto min-w-0 max-w-6xl px-4 pb-[calc(6rem+env(safe-area-inset-bottom))] pt-4 sm:px-4 md:pb-4">
        {isOwner && <ShopApplicationStatus shopId={shop.id} status={shop.kyc_status} shopStatus={shop.status} reviewNote={reviewNote} canAccessDashboard />}
        <ShopAvailability initialOpen={shop.is_open} isOwner={isOwner} />
        <SubscriptionNotice subscription={subscription} warningDays={warningDays} isOwner={isOwner} />
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
        <div className={pathname === '/shop' || pathname === '/shop/home' || pathname === '/shop/more' ? undefined : styles.workspacePages}>
          {children}
        </div>
      </main>
      <nav aria-label="Shop mobile navigation" className={`no-print ${styles.mobileNav}`}>
        {MOBILE_TABS.map(({ href, label, icon: Icon }) => {
          const active = activeTab(pathname, href);
          return <Link key={href} href={href} aria-current={active ? 'page' : undefined} className={cn('flex min-h-12 min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-xl text-[10px] font-bold', active ? 'text-orange-700' : 'text-neutral-500')}><Icon size={18} strokeWidth={active ? 2.5 : 1.9} />{label}</Link>;
        })}
      </nav>
    </div>
  );
}
