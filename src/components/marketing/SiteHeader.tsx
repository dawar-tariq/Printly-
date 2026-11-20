'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowUpRight, Menu, X } from 'lucide-react';
import { Logo } from '@/components/Logo';

const navigation = [
  { href: '/#how-it-works', label: 'How it works' },
  { href: '/#features', label: 'For shops' },
  { href: '/pricing', label: 'Pricing' },
  { href: '/about', label: 'About' },
  { href: '/faq', label: 'FAQs' },
];

export function SiteHeader() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);
  return <header className="sticky top-0 z-50 border-b border-[#ebe6df] bg-[#faf9f6]/95 backdrop-blur-md">
    <div className="public-container flex h-[76px] items-center justify-between gap-5">
      <Logo />
      <nav aria-label="Main navigation" className="hidden items-center gap-7 lg:flex">
        {navigation.map((item) => <Link key={item.href} href={item.href} className="text-[13px] font-bold text-[#625a54] transition-colors hover:text-[#b9380c]">{item.label}</Link>)}
      </nav>
      <div className="hidden items-center gap-4 lg:flex">
        <Link href="/login" className="text-[13px] font-bold text-[#413b37] hover:text-[#b9380c]">Shop sign in</Link>
        <Link href="/shop/signup" className="public-button public-button-dark !min-h-[44px] !rounded-[10px] !px-4 !text-[13px]">List your shop <ArrowUpRight size={15} /></Link>
      </div>
      <div className="flex items-center gap-2 lg:hidden">
        <Link href="/login" className="rounded-lg px-2 py-3 text-xs font-bold text-[#413b37]">Shop sign in</Link>
        <button type="button" aria-label={open ? 'Close menu' : 'Open menu'} aria-expanded={open} aria-controls="mobile-navigation" onClick={() => setOpen(!open)} className="grid h-11 w-11 place-items-center rounded-xl border border-[#e6dfd7] bg-white text-[#24201e]">
          {open ? <X size={20} /> : <Menu size={20} />}
        </button>
      </div>
    </div>
    {open && <nav id="mobile-navigation" aria-label="Mobile navigation" className="border-t border-[#ebe6df] bg-[#faf9f6] px-5 pb-6 pt-3 lg:hidden">
      <div className="mx-auto grid max-w-2xl">
        {navigation.map((item) => <Link key={item.href} href={item.href} onClick={() => setOpen(false)} className="border-b border-[#eee9e2] py-3.5 text-sm font-bold text-[#403832]">{item.label}</Link>)}
        <Link href="/shop/signup" onClick={() => setOpen(false)} className="public-button public-button-orange mt-4">List your shop <ArrowUpRight size={17} /></Link>
      </div>
    </nav>}
  </header>;
}
