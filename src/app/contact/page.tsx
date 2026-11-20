import type { Metadata } from 'next';
import { publicCanonical } from '@/lib/public-pages';
import Link from 'next/link';
import { ArrowRight, FileQuestion, LockKeyhole, Store } from 'lucide-react';
import { PublicShell } from '@/components/marketing/PublicShell';

export const metadata: Metadata = { alternates: publicCanonical('/contact'), title: 'Contact & help | Printly', description: 'Find the right place to get help with a Printly order, shop account or privacy question.' };

export default function ContactPage() {
  return <PublicShell><main id="main-content">
    <section className="bg-[#f8f6f1] py-16 sm:py-24"><div className="public-container"><p className="eyebrow">Let’s find the right answer</p><h1 className="mt-4 max-w-3xl text-[clamp(2.8rem,5.5vw,4.8rem)] font-extrabold leading-[1.08] tracking-[-0.06em]">A little help, right where you need it.</h1><p className="mt-5 max-w-2xl text-base leading-8 text-[#756b62]">The best place to start depends on whether your question is about a particular order or the Printly platform.</p></div></section>
    <section className="bg-white py-16 sm:py-20"><div className="public-container grid gap-5 md:grid-cols-3">{[
      { icon: Store, title: 'A customer order', body: 'For order changes, timing, print quality or refunds, contact the shop directly using the details on its shop page. Keep your tracking link and payment reference handy.' },
      { icon: FileQuestion, title: 'Using Printly', body: 'Our FAQs cover placing an order, payment, subscription access and what happens when a shop’s subscription expires.' },
      { icon: LockKeyhole, title: 'Privacy or security', body: 'For platform-related privacy, account or security requests, a public Printly support email is not currently listed. Please do not post sensitive details publicly.' },
    ].map(({ icon: Icon, title, body }) => <article key={title} className="rounded-[1.3rem] border border-[#eee7df] bg-[#fcfbf8] p-7"><span className="grid h-11 w-11 place-items-center rounded-xl bg-[#fff0e5] text-[#b93d0d]"><Icon size={20} /></span><h2 className="mt-6 text-lg font-extrabold">{title}</h2><p className="mt-3 text-sm leading-7 text-[#756b62]">{body}</p></article>)}</div><div className="public-container mt-8 flex flex-wrap gap-3"><Link href="/faq" className="public-button public-button-dark">Browse the FAQs <ArrowRight size={16} /></Link><Link href="/privacy" className="public-button public-button-light">Read our privacy policy</Link></div></section>
  </main></PublicShell>;
}
