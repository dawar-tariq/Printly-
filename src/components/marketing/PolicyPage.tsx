import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { PublicShell } from './PublicShell';

export type PolicySection = { id: string; title: string; content: React.ReactNode };

export function PolicyPage({ eyebrow = 'The details', title, description, sections }: { eyebrow?: string; title: string; description: string; sections: PolicySection[] }) {
  return <PublicShell><main id="main-content">
    <section className="bg-[#f8f6f1] py-16 sm:py-20"><div className="public-container"><p className="eyebrow">{eyebrow}</p><h1 className="mt-4 max-w-4xl text-[clamp(2.5rem,5vw,4.4rem)] font-extrabold leading-[1.08] tracking-[-0.06em]">{title}</h1><p className="mt-5 max-w-2xl text-base leading-8 text-[#756b62]">{description}</p><p className="mt-6 text-xs font-bold text-[#96887d]">Updated November 2026</p></div></section>
    <section className="bg-white py-14 sm:py-20"><div className="public-container grid items-start gap-12 lg:grid-cols-[230px_minmax(0,740px)] lg:gap-20">
      <nav aria-label="On this page" className="rounded-2xl border border-[#eee7df] bg-[#fcfaf7] p-5 lg:sticky lg:top-28"><p className="text-xs font-extrabold uppercase tracking-[0.13em] text-[#998a7e]">On this page</p><ul className="mt-4 space-y-3">{sections.map((section) => <li key={section.id}><a href={`#${section.id}`} className="text-sm font-semibold text-[#6c6056] hover:text-[#b43b0d]">{section.title}</a></li>)}</ul></nav>
      <div className="min-w-0 space-y-12">{sections.map((section) => <section key={section.id} id={section.id} className="scroll-mt-28"><h2 className="text-xl font-extrabold tracking-[-0.035em] sm:text-2xl">{section.title}</h2><div className="mt-4 space-y-4 text-[15px] leading-8 text-[#685e56] [&_a]:font-bold [&_a]:text-[#a7380e] [&_a]:underline [&_li]:ml-5 [&_li]:list-disc [&_ul]:space-y-2">{section.content}</div></section>)}
        <div className="rounded-2xl border border-[#eee5dc] bg-[#faf7f3] p-6"><p className="text-sm leading-7 text-[#6f6257]">Looking for help with an order or your account?</p><Link href="/contact" className="mt-2 inline-flex items-center gap-2 text-sm font-extrabold text-[#a7380e] hover:underline">Contact & help <ArrowRight size={16} /></Link></div>
      </div>
    </div></section>
  </main></PublicShell>;
}
