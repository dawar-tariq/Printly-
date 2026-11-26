'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Logo } from '@/components/Logo';
import { SignOutButton } from '@/components/SignOutButton';
import { LayoutDashboard, Store, ShieldAlert, CreditCard, Settings, MessageCircle, BellRing } from 'lucide-react';
import { cn } from '@/lib/utils';

const TABS = [
  { href: '/admin', label: 'Analytics', icon: LayoutDashboard, exact: true },
  { href: '/admin/shops', label: 'Shops & KYC', icon: Store },
  { href: '/admin/disputes', label: 'Disputes', icon: ShieldAlert },
  { href: '/admin/support', label: 'Support', icon: MessageCircle },
  { href: '/admin/subscriptions', label: 'Subscription', icon: CreditCard },
  { href: '/admin/notifications', label: 'Notifications & updates', icon: BellRing },
  { href: '/admin/settings', label: 'Settings', icon: Settings },
];

export function AdminShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <div className="min-h-screen bg-neutral-100">
      <header className="sticky top-0 z-30 bg-indigo-950 text-white">
        <div className="max-w-6xl mx-auto px-3 sm:px-4 h-14 flex items-center gap-3">
          <Logo href="/admin" inverse />
          <span className="chip bg-indigo-800 text-indigo-100">Admin console</span>
          <SignOutButton portal="admin" className="ml-auto" buttonClassName="text-indigo-200 hover:bg-indigo-900" />
        </div>
        <nav className="max-w-6xl mx-auto px-2 sm:px-3 flex items-center gap-1 overflow-x-auto pb-1.5">
          {TABS.map(({ href, label, icon: Icon, exact }) => {
            const active = exact ? pathname === href : pathname.startsWith(href);
            return (
              <Link key={href} href={href} className={cn('flex items-center gap-1.5 px-3 h-9 rounded-lg text-[13px] font-semibold whitespace-nowrap transition-colors', active ? 'bg-indigo-500 text-white' : 'text-indigo-200 hover:bg-indigo-900')}>
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
