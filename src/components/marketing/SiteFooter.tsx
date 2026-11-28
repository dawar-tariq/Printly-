import Link from 'next/link';
import { ArrowUpRight } from 'lucide-react';
import { Logo } from '@/components/Logo';

const columns = [
  { title: 'Explore', links: [
    ['How it works', '/#how-it-works'], ['For print shops', '/#features'], ['Pricing', '/pricing'], ['About Printly', '/about'],
  ] },
  { title: 'Get started', links: [
    ['Explore demo shop', '/s/p-demo1'], ['List your shop', '/shop/signup'], ['Shop sign in', '/login'], ['FAQs', '/faq'],
  ] },
  { title: 'Good to know', links: [
    ['Privacy policy', '/privacy'], ['Terms & conditions', '/terms'], ['Refunds & cancellations', '/refunds'], ['Cookie notice', '/cookies'],
  ] },
  { title: 'More', links: [
    ['Security', '/security'], ['Contact & help', '/contact'], ['Copyright', '/copyright'], ['Accessibility', '/accessibility'],
  ] },
];

export function SiteFooter() {
  return <footer className="bg-[#211d1a] text-[#f8f3eb]">
    <div className="public-container py-14 sm:py-16">
      <div className="grid gap-10 lg:grid-cols-[1.3fr_2fr] lg:gap-16">
        <div>
          <Logo inverse />
          <p className="mt-5 max-w-[265px] text-sm leading-7 text-[#c5bbb1]">A little less waiting. A lot more getting things done. Made for local print shops and the people they serve.</p>
          <Link href="/about" className="mt-5 inline-flex items-center gap-1.5 text-sm font-bold text-white hover:text-[#ffb48a]">Get to know us <ArrowUpRight size={15} /></Link>
        </div>
        <div className="grid grid-cols-2 gap-x-6 gap-y-9 sm:grid-cols-4">
          {columns.map((column) => <div key={column.title}>
            <h2 className="text-xs font-extrabold uppercase tracking-[0.13em] text-[#f7f1e9]">{column.title}</h2>
            <ul className="mt-5 space-y-3.5">{column.links.map(([label, href]) => <li key={href}><Link href={href} className="text-[13px] text-[#c5bbb1] transition-colors hover:text-white">{label}</Link></li>)}</ul>
          </div>)}
        </div>
      </div>
      <div className="mt-14 flex flex-wrap items-center justify-between gap-3 border-t border-white/10 pt-6 text-xs text-[#b8aca1]">
        <span>© {new Date().getFullYear()} Printly. All rights reserved.</span>
        <span>Thoughtfully made for the everyday.</span>
      </div>
    </div>
  </footer>;
}
