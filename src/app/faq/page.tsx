import type { Metadata } from 'next';
import { publicCanonical } from '@/lib/public-pages';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { FaqList } from '@/components/marketing/FaqList';
import { PublicShell } from '@/components/marketing/PublicShell';
import { faqGroups } from '@/lib/marketing-faq';

export const metadata: Metadata = { alternates: publicCanonical('/faq'), title: 'Frequently asked questions | Printly', description: 'Answers about ordering, payments, subscriptions, file privacy and using Printly as a shop or customer.' };

export default function FaqPage() {
  return <PublicShell><main id="main-content">
    <section className="bg-[#f8f6f1] py-16 sm:py-24"><div className="public-container"><p className="eyebrow">Here to help</p><h1 className="mt-4 max-w-3xl text-[clamp(2.8rem,5.5vw,4.8rem)] font-extrabold leading-[1.08] tracking-[-0.06em]">A little clarity goes a long way.</h1><p className="mt-5 max-w-xl text-base leading-8 text-[#756b62]">Answers to the things customers and shop owners ask most. Find what you need and get back to your day.</p><div className="mt-7 flex flex-wrap gap-2">{faqGroups.map((group, index) => <a key={group.title} href={`#faq-group-${index}`} className="rounded-full border border-[#e8ded4] bg-white px-4 py-2 text-xs font-bold text-[#5c5148] hover:border-[#c43d0a]">{group.title}</a>)}</div></div></section>
    <section className="bg-white py-16 sm:py-20"><div className="public-container max-w-[900px] space-y-16">{faqGroups.map((group, index) => <section key={group.title} id={`faq-group-${index}`} className="scroll-mt-28"><p className="eyebrow">{index === 0 ? 'Ordering with Printly' : 'Running your shop'}</p><h2 className="mb-7 mt-3 text-2xl font-extrabold tracking-[-0.04em] sm:text-3xl">{group.title}</h2><FaqList items={group.items} /></section>)}<div className="rounded-2xl bg-[#f7f3ed] p-6 sm:p-8"><h2 className="text-xl font-extrabold tracking-[-0.03em]">Still have a question?</h2><p className="mt-2 text-sm leading-7 text-[#756b62]">For an order, contact the shop using the details on its page. Find more guidance and our current contact information on the help page.</p><Link href="/contact" className="mt-4 inline-flex items-center gap-2 text-sm font-extrabold text-[#aa390e] hover:underline">Visit contact & help <ArrowRight size={16} /></Link></div></div></section>
  </main></PublicShell>;
}
