import Link from 'next/link';
import {
  ArrowDown, ArrowRight, ArrowUpRight, BadgeCheck, Banknote, Check, CheckCircle2,
  Clock3, CreditCard, FileText, Layers3, LayoutDashboard, PackageCheck,
  QrCode, ScanLine, Settings2, ShieldCheck, Smartphone, Sparkles, Store, UploadCloud,
} from 'lucide-react';
import { BrandMark } from '@/components/BrandArtwork';
import { FaqList } from '@/components/marketing/FaqList';
import { PublicShell } from '@/components/marketing/PublicShell';
import { landingFaqs } from '@/lib/marketing-faq';

const steps = [
  { number: '01', icon: ScanLine, title: 'Find your shop', body: 'Scan a participating shop’s QR code or open its link. There’s nothing to download.' },
  { number: '02', icon: UploadCloud, title: 'Make it yours', body: 'Upload your files, choose your print options and review the quote before checkout.' },
  { number: '03', icon: Banknote, title: 'Pay your way', body: 'Pay the shop directly by UPI, or choose cash where available.' },
  { number: '04', icon: PackageCheck, title: 'Track & collect', body: 'Save your tracking link, follow the order and collect it from the shop.' },
];

const features = [
  { icon: QrCode, title: 'Your shop, one simple link', body: 'Share your own QR code and shop page so customers can start an order in seconds.' },
  { icon: LayoutDashboard, title: 'A clearer order queue', body: 'See new jobs, update their status and keep the counter moving from one dashboard.' },
  { icon: Settings2, title: 'Your services, your rates', body: 'Set the options and prices that work for your shop, with quotes shown before checkout.' },
  { icon: CreditCard, title: 'Payments, straight to you', body: 'Customers pay your shop directly. Review and confirm UPI transfers yourself.' },
  { icon: Layers3, title: 'The details in one place', body: 'Keep track of order totals, daily reports and inventory alongside your print jobs.' },
  { icon: Smartphone, title: 'Works on your devices', body: 'Use a compatible browser on a phone or shop computer—no extra hardware required.' },
];

export default function HomePage() {
  return <PublicShell>
    <main id="main-content">
      {/* Hero */}
      <section className="overflow-hidden bg-[#f8f6f1]">
        <div className="public-container grid items-center gap-12 pb-14 pt-12 sm:pb-20 sm:pt-16 lg:grid-cols-[0.96fr_1.04fr] lg:gap-16 lg:pb-24 lg:pt-20">
          <div className="max-w-[620px]">
            <p className="inline-flex items-center gap-2 rounded-full border border-[#e8d9cb] bg-white px-3 py-2 text-[11px] font-extrabold uppercase tracking-[0.12em] text-[#8f3a1c]"><span className="h-2 w-2 rounded-full bg-[#e7541a]" /> A better way to print, together</p>
            <h1 className="mt-7 text-[clamp(2.75rem,5.5vw,5.5rem)] font-extrabold leading-[1.04] tracking-[-0.06em] text-[#24201e]">Less waiting.<br /><span className="text-[#c43d0a]">More doing.</span></h1>
            <p className="mt-6 max-w-[500px] text-[17px] leading-[1.8] text-[#6b625b] sm:text-lg">Your local print shop, a little closer. Send your files, choose your options and follow your order—all from your phone.</p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/s/p-demo1" className="public-button public-button-orange">Explore the demo <ArrowUpRight size={18} /></Link>
              <Link href="#how-it-works" className="public-button public-button-light">See how it works <ArrowDown size={17} /></Link>
            </div>
            <div className="mt-8 flex flex-wrap gap-x-6 gap-y-3 text-[13px] font-bold text-[#5d554e]">
              <span className="inline-flex items-center gap-2"><Smartphone size={17} className="text-[#b43d11]" /> No app download</span>
              <span className="inline-flex items-center gap-2"><Banknote size={17} className="text-[#b43d11]" /> Pay the shop directly</span>
            </div>
            <p className="mt-5 max-w-[450px] text-[11px] leading-5 text-[#81786f]">The demo shop has real checkout options. Avoid sensitive files and don’t pay unless you intend to place an order.</p>
          </div>
          <div className="relative mx-auto w-full max-w-[600px] lg:ml-auto">
            <div className="absolute -left-6 -top-6 h-32 w-32 rounded-full border border-[#e3d8ca]" aria-hidden="true" />
            <div className="relative h-[420px] overflow-hidden rounded-[1.8rem] bg-[#e6d5c5] sm:h-[540px] lg:h-[590px]">
              <img src="/images/printly-shop-hero.webp" alt="" fetchPriority="high" className="h-full w-full object-cover object-[center_44%]" />
              <div className="absolute inset-0 bg-gradient-to-t from-[#211611]/45 via-transparent to-transparent" />
              <div className="absolute bottom-5 left-5 right-5 flex items-end justify-between gap-3 sm:bottom-7 sm:left-7 sm:right-7">
                <div className="text-white"><p className="text-[10px] font-bold uppercase tracking-[0.17em] text-white/80">For the everyday things</p><p className="display-font mt-1 text-xl font-extrabold tracking-tight sm:text-2xl">Local shops. Easier days.</p></div>
                <span className="rounded-full bg-black/30 px-2.5 py-1 text-[10px] text-white/90">Illustration</span>
              </div>
            </div>
            <div className="relative ml-auto mt-3 w-full max-w-[260px] rounded-2xl border border-[#eee6de] bg-white p-4 shadow-[0_18px_50px_rgba(45,30,20,0.16)] sm:absolute sm:-bottom-5 sm:-right-5 sm:mt-0 sm:w-[245px] lg:relative lg:bottom-auto lg:right-auto lg:mt-3 lg:w-full xl:absolute xl:-bottom-5 xl:-right-5 xl:mt-0 xl:w-[245px]">
              <div className="flex items-start justify-between"><div><p className="text-[10px] font-extrabold uppercase tracking-[0.13em] text-[#9a8d81]">Example order</p><p className="display-font mt-1 text-sm font-extrabold">Ready to collect</p></div><span className="grid h-9 w-9 place-items-center rounded-full bg-[#e8f2e8] text-[#39744c]"><Check size={17} /></span></div>
              <div className="mt-3 flex items-center gap-1.5 text-[11px] font-semibold text-[#81766d]"><span className="h-1.5 w-1.5 rounded-full bg-[#6da779]" /> Follow along with your tracking link</div>
            </div>
          </div>
        </div>
        <div className="border-y border-[#e9e3dc] bg-white/75">
          <div className="public-container flex flex-wrap items-center justify-between gap-x-8 gap-y-4 py-5 text-xs font-bold text-[#756a61] sm:text-sm">
            <span className="eyebrow !text-[#8b8077]">Made for real life</span>
            <span className="inline-flex items-center gap-2"><FileText size={16} className="text-[#c43d0a]" /> Everyday documents</span>
            <span className="inline-flex items-center gap-2"><Store size={16} className="text-[#c43d0a]" /> Local print shops</span>
            <span className="inline-flex items-center gap-2"><Sparkles size={16} className="text-[#c43d0a]" /> A smoother experience</span>
          </div>
        </div>
      </section>

      {/* How it works */}
      <section id="how-it-works" className="scroll-mt-24 bg-white py-20 sm:py-28">
        <div className="public-container">
          <div className="flex flex-wrap items-end justify-between gap-6">
            <div className="max-w-[650px]"><p className="eyebrow">A simpler kind of errand</p><h2 className="mt-4 text-[clamp(2rem,4vw,3.35rem)] font-extrabold leading-[1.1] tracking-[-0.05em]">From your screen to<br className="hidden sm:block" /> the shop counter.</h2></div>
            <p className="max-w-[330px] text-[15px] leading-7 text-[#776d64]">A few easy steps for you. A more organised day for your local shop.</p>
          </div>
          <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {steps.map(({ number, icon: Icon, title, body }) => <article key={number} className="rounded-[1.3rem] border border-[#eee8e1] bg-[#fcfbf8] p-6 sm:p-7">
              <div className="flex items-center justify-between"><span className="grid h-12 w-12 place-items-center rounded-2xl bg-[#fae9dc] text-[#b93c0c]"><Icon size={21} strokeWidth={1.8} /></span><span className="display-font text-sm font-bold text-[#c8bdb2]">{number}</span></div>
              <h3 className="mt-7 text-lg font-extrabold tracking-[-0.03em]">{title}</h3><p className="mt-2 text-sm leading-7 text-[#756b62]">{body}</p>
            </article>)}
          </div>
        </div>
      </section>

      {/* Shop story */}
      <section id="features" className="scroll-mt-24 bg-[#25211e] py-20 text-white sm:py-28">
        <div className="public-container grid items-center gap-14 lg:grid-cols-2 lg:gap-24">
          <div>
            <p className="eyebrow !text-[#f2a376]">For the shops behind it all</p>
            <h2 className="mt-4 text-[clamp(2.1rem,4.5vw,4rem)] font-extrabold leading-[1.1] tracking-[-0.055em]">A little more order.<br /><span className="text-[#f2955e]">A lot more flow.</span></h2>
            <p className="mt-6 max-w-[490px] text-[15px] leading-8 text-[#d2c8be] sm:text-base">Great print shops do a hundred things at once. Printly brings orders, payment checks and everyday tools together, so you can focus on the work in front of you.</p>
            <ul className="mt-7 space-y-3 text-sm font-semibold text-[#eee7df]">
              {['One place for your orders and print details', 'Your own QR and direct customer payments', 'One all-features subscription gives your shop the tools to manage every order'].map((item) => <li key={item} className="flex items-start gap-3"><CheckCircle2 size={18} className="mt-0.5 shrink-0 text-[#f39562]" />{item}</li>)}
            </ul>
            <div className="mt-9 flex flex-wrap gap-3"><Link href="/shop/signup" className="public-button public-button-orange">Apply to list your shop <ArrowRight size={17} /></Link><Link href="/pricing" className="public-button border border-white/25 text-white hover:bg-white/10">Explore pricing</Link></div>
          </div>
          <div className="relative rounded-[1.6rem] border border-white/10 bg-[#342e29] p-4 shadow-2xl sm:p-6">
            <div className="absolute -right-3 -top-4 grid h-14 w-14 place-items-center rounded-2xl bg-[#fae9d9] shadow-lg sm:-right-5"><BrandMark className="h-9 w-9" /></div>
            <div className="rounded-2xl bg-[#faf8f4] p-5 text-[#302923] sm:p-6">
              <div className="flex items-center justify-between gap-3"><div><p className="text-[10px] font-extrabold uppercase tracking-[0.15em] text-[#b94b22]">Your workspace</p><h3 className="mt-1 text-lg font-extrabold">A better view of the day.</h3></div><span className="rounded-full bg-[#efeae2] px-2.5 py-1 text-[10px] font-bold text-[#776a5d]">EXAMPLE</span></div>
              <div className="mt-5 grid grid-cols-3 gap-2 sm:gap-3">{[['New', '01'], ['Printing', '02'], ['Ready', '03']].map(([label, n]) => <div key={label} className="rounded-xl border border-[#ece6de] bg-white px-3 py-4"><p className="text-[10px] font-bold text-[#9c8f83]">{label}</p><p className="display-font mt-2 text-2xl font-extrabold text-[#413831]">{n}</p></div>)}</div>
              <div className="mt-4 rounded-xl border border-[#ece6de] bg-white p-4"><div className="flex items-center gap-3"><span className="grid h-10 w-10 place-items-center rounded-xl bg-[#fff0e5] text-[#ba4214]"><FileText size={18} /></span><div className="min-w-0 flex-1"><p className="text-xs font-extrabold">Print order</p><p className="mt-1 text-[11px] text-[#95887b]">Files, options and order details</p></div><span className="rounded-full bg-[#eaf4ea] px-2 py-1 text-[10px] font-bold text-[#41784f]">Ready</span></div></div>
              <p className="mt-4 text-[11px] text-[#a09487]">An illustrative preview, not live shop data.</p>
            </div>
          </div>
        </div>
      </section>

      {/* Feature grid */}
      <section className="bg-[#faf9f6] py-20 sm:py-28">
        <div className="public-container">
          <div className="mx-auto max-w-[650px] text-center"><p className="eyebrow">Thoughtful tools, all together</p><h2 className="mt-4 text-[clamp(2rem,4vw,3.35rem)] font-extrabold leading-[1.12] tracking-[-0.05em]">Everything the counter needs.</h2><p className="mx-auto mt-5 max-w-xl text-[15px] leading-7 text-[#776d64]">Practical features for the work you already do, built to make the busy parts feel a little lighter.</p></div>
          <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{features.map(({ icon: Icon, title, body }) => <article key={title} className="rounded-[1.3rem] border border-[#ece7df] bg-white p-7"><span className="grid h-11 w-11 place-items-center rounded-xl bg-[#fff0e5] text-[#bd3e0d]"><Icon size={20} strokeWidth={1.8} /></span><h3 className="mt-6 text-[17px] font-extrabold tracking-[-0.03em]">{title}</h3><p className="mt-2 text-sm leading-7 text-[#776d64]">{body}</p></article>)}</div>
        </div>
      </section>

      {/* Pricing */}
      <section className="bg-white py-20 sm:py-24">
        <div className="public-container">
          <div className="feature-grid-pattern overflow-hidden rounded-[1.8rem] border border-[#efe4d8] bg-[#fff8f1] p-7 sm:p-12 lg:p-14">
            <div className="grid items-center gap-10 lg:grid-cols-[1fr_auto]">
              <div className="max-w-[690px]"><p className="eyebrow">Simple, straightforward pricing</p><h2 className="mt-4 text-[clamp(2rem,4vw,3.2rem)] font-extrabold leading-[1.12] tracking-[-0.05em]">One plan. Your choice of term.</h2><p className="mt-5 max-w-xl text-[15px] leading-7 text-[#776d64]">Every shop subscription includes the same features. Choose monthly, six-month or yearly access, with no automatic recurring billing.</p><div className="mt-6 flex flex-wrap gap-x-6 gap-y-3 text-sm font-bold text-[#52483f]"><span className="flex items-center gap-2"><Check size={16} className="text-[#bc400e]" /> All features included</span><span className="flex items-center gap-2"><Check size={16} className="text-[#bc400e]" /> No platform commission on new orders</span></div></div>
              <Link href="/pricing" className="public-button public-button-dark justify-self-start lg:justify-self-end">See shop pricing <ArrowUpRight size={17} /></Link>
            </div>
          </div>
        </div>
      </section>

      {/* Reassurance */}
      <section className="bg-[#f4f0e9] py-20 sm:py-24"><div className="public-container grid items-center gap-10 md:grid-cols-[1fr_1fr] lg:gap-24">
        <div><p className="eyebrow">Made with care</p><h2 className="mt-4 text-[clamp(2rem,4vw,3.2rem)] font-extrabold leading-[1.12] tracking-[-0.05em]">Small details.<br />A better experience.</h2><p className="mt-5 max-w-[480px] text-[15px] leading-7 text-[#776d64]">A clear quote, a direct payment and an order you can follow. Good printing should feel this simple.</p><Link href="/security" className="mt-6 inline-flex items-center gap-2 text-sm font-extrabold text-[#a7380e] hover:underline">Read about security <ArrowRight size={16} /></Link></div>
        <div className="grid gap-3">{[
          { icon: ShieldCheck, title: 'Private file storage', body: 'Order files are stored privately and made available to authorised shop staff.' },
          { icon: BadgeCheck, title: 'Clear before you pay', body: 'See your order options and quote before checking out with the shop.' },
          { icon: Clock3, title: 'Updates at your fingertips', body: 'Save your tracking link and check the order’s progress when you need to.' },
        ].map(({ icon: Icon, title, body }) => <div key={title} className="flex gap-4 rounded-2xl border border-[#e9e2d9] bg-white p-5"><span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-[#fff0e5] text-[#bc400e]"><Icon size={20} /></span><div><h3 className="text-[15px] font-extrabold">{title}</h3><p className="mt-1 text-sm leading-6 text-[#7a7067]">{body}</p></div></div>)}</div>
      </div></section>

      {/* FAQs */}
      <section className="bg-white py-20 sm:py-28"><div className="public-container grid gap-10 lg:grid-cols-[0.72fr_1.28fr] lg:gap-24"><div><p className="eyebrow">The things you might be wondering</p><h2 className="mt-4 text-[clamp(2rem,4vw,3.2rem)] font-extrabold leading-[1.12] tracking-[-0.05em]">Good questions.<br />Clear answers.</h2><p className="mt-5 max-w-xs text-[15px] leading-7 text-[#776d64]">Everything you need to know before your first order or your first day on Printly.</p><Link href="/faq" className="mt-6 inline-flex items-center gap-2 text-sm font-extrabold text-[#aa390e] hover:underline">See all FAQs <ArrowRight size={16} /></Link></div><FaqList items={landingFaqs} /></div></section>

      {/* Final CTA */}
      <section className="bg-white pb-20 sm:pb-24"><div className="public-container"><div className="relative overflow-hidden rounded-[1.8rem] bg-[#c33d0d] px-7 py-12 text-white sm:px-14 sm:py-16"><div className="absolute -right-10 -top-24 h-72 w-72 rounded-full border-[35px] border-white/10" aria-hidden="true" /><div className="relative flex flex-wrap items-end justify-between gap-8"><div className="max-w-[680px]"><p className="text-[11px] font-extrabold uppercase tracking-[0.16em] text-[#ffdbc5]">Let’s make the everyday easier</p><h2 className="mt-4 text-[clamp(2rem,4.5vw,3.8rem)] font-extrabold leading-[1.08] tracking-[-0.05em]">Good for your customers.<br />Great for your shop.</h2><p className="mt-5 max-w-lg text-[15px] leading-7 text-[#ffe6d6]">Bring your print shop online with a simpler way to receive and manage orders.</p></div><Link href="/shop/signup" className="public-button bg-white text-[#a3340b] hover:bg-[#fff2e9]">Get your shop started <ArrowUpRight size={17} /></Link></div></div></div></section>
    </main>
  </PublicShell>;
}
