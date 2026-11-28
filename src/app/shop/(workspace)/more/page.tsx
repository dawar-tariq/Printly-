import Link from 'next/link';
import { ChevronRight, CreditCard, Gift, HelpCircle, LifeBuoy, QrCode, Settings2, Smartphone, TicketCheck } from 'lucide-react';
import styles from './more.module.css';

const links = [
  { href: '/shop/settings#shop-qr', title: 'Your shop QR', description: 'Share your shop with customers', icon: QrCode },
  { href: '/shop/settings', title: 'Shop settings & rates', description: 'Profile, UPI, services and pricing', icon: Settings2 },
  { href: '/shop/subscription', title: 'Subscription', description: 'Manage your access and renewals', icon: CreditCard },
  { href: '/shop/recovery', title: 'Open orders', description: 'Find orders and payment reports', icon: TicketCheck },
  { href: '/shop/app', title: 'Android app & notifications', description: 'Download, updates and device alerts', icon: Smartphone },
  { href: '/support', title: 'Help & support', description: 'Contact the Printly team', icon: LifeBuoy },
  { href: '/faq', title: 'Frequently asked questions', description: 'Learn how Printly works', icon: HelpCircle },
];

export default function OwnerMorePage() {
  return <div className={styles.page}><div className={styles.heading}><p className="text-[10px] font-extrabold uppercase tracking-[.18em] text-orange-700">YOUR WORKSPACE</p><h1 className="mt-1 text-2xl font-black tracking-[-.04em]">More for your shop</h1><p className="mt-1 text-sm text-neutral-500">Your tools and settings, all in one place.</p></div>
    <div className="mt-5 space-y-2">{(process.env.PRINTLY_ISOLATED_TEST === '1' ? [{ href: '/shop/referrals', title: 'Refer & earn · preview', description: 'Explore the upcoming rewards programme', icon: Gift }, ...links] : links).map(({ href, title, description, icon: Icon }) => <Link href={href} key={href} className={styles.link}><span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-orange-50 text-orange-700"><Icon size={19} /></span><span className="min-w-0 flex-1"><strong className="block text-sm">{title}</strong><span className="mt-0.5 block text-xs text-neutral-500">{description}</span></span><ChevronRight size={17} className="text-neutral-400" /></Link>)}</div>
  </div>;
}
