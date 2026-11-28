import type { Metadata } from 'next';
import styles from './landing.module.css';
import { publicCanonical } from '@/lib/public-pages';
import Link from 'next/link';
import {
  ArrowRight, ArrowUpRight, Banknote, Check, CreditCard, FileText, Layers3, LayoutDashboard, PackageCheck,
  QrCode, ScanLine, Settings2, Smartphone, UploadCloud,
} from 'lucide-react';
import { FaqList } from '@/components/marketing/FaqList';
import { LandingFooter } from '@/components/marketing/LandingFooter';
import { PublicShell } from '@/components/marketing/PublicShell';
import { landingFaqs } from '@/lib/marketing-faq';

export const metadata: Metadata = { alternates: publicCanonical('/') };

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
  // Marketing copy for the real service describes real payments. Do not show
  // it on the isolated rehearsal, where only synthetic data may be used.
  if (process.env.PRINTLY_ISOLATED_TEST === '1') return <main id="main-content" className="min-h-screen bg-[#f8f6f1] px-5 py-12 sm:py-20">
    <div className="mx-auto max-w-2xl rounded-3xl border border-orange-200 bg-white p-7 shadow-sm sm:p-10">
      <p className="text-xs font-extrabold uppercase tracking-widest text-orange-800">Printly · isolated phone test</p>
      <h1 className="mt-4 text-3xl font-extrabold tracking-tight text-neutral-900 sm:text-4xl">Test with synthetic data only.</h1>
      <p className="mt-4 text-base leading-7 text-neutral-700">This is a separate rehearsal site, not a real shop. Use only test accounts, made-up customer details and synthetic files.</p>
      <p role="status" className="mt-5 rounded-xl bg-amber-50 p-4 text-sm font-bold leading-6 text-amber-950">Never send money. Payment links and QR codes are disabled in the test interface, but this is not a payment sandbox.</p>
      <div className="mt-7 flex flex-wrap gap-3">
        <Link href="/s/p-demo1" className="btn btn-primary min-h-11 px-5">Open test shop <ArrowRight size={17} /></Link>
        <Link href="/login" className="btn btn-ghost min-h-11 px-5">Owner test sign in</Link>
        <Link href="/admin/login" className="btn btn-ghost min-h-11 px-5">Admin test sign in</Link>
      </div>
      <p className="mt-6 text-xs leading-5 text-neutral-600">Do not use real shop credentials, customer information, payment IDs or files. Dropbox import is disabled for this rehearsal.</p>
    </div>
  </main>;
  return <PublicShell className={styles.landingShell} footer={<LandingFooter />}>
    <main id="main-content" className={styles.home}>
      <section className={styles.hero}>
        <div className={styles.wrap}>
          <div className={styles.heroGrid}>
            <div className={styles.heroCopy}>
              <p className={styles.chapter}><span /> A BETTER WAY TO PRINT, TOGETHER</p>
              <h1>Good prints.<br /><em>Better days.</em></h1>
              <p className={styles.heroDescription}>Your local print shop, a little closer. Send your files, choose your options and follow your order—all from your phone.</p>
              <div className={styles.actions}><Link href="/s/p-demo1" className={styles.primary}>Explore the demo <ArrowUpRight size={18} /></Link><Link href="/shop/signup" className={styles.startButton}>Start now <ArrowUpRight size={18} /><span className="sr-only"> — list your shop</span></Link></div>
              <p className={styles.demoNote}>The demo shop has real checkout options. Avoid sensitive files and don’t pay unless you intend to place an order.</p>
              <div className={styles.heroSteps}><span><b>01</b> Upload</span><span><b>02</b> Choose</span><span><b>03</b> Collect</span></div>
            </div>
            <div className={styles.productStage} aria-label="Illustrative preview of the Printly order experience">
              <span className={styles.stageIndex}>A LITTLE LOOK INSIDE PRINTLY <b>↗</b></span>
              <div className={styles.stageRing} aria-hidden="true" />
              <div className={styles.orderWindow}><div className={styles.windowBar}><span className={styles.windowDots}><i/><i/><i/></span><span>YOUR PRINTLY ORDER</span><span>↗</span></div><div className={styles.windowBody}><div className={styles.windowHeading}><div><small>YOUR PRINT SHOP, ONLINE</small><h3>Let’s get your<br /><em>print ready.</em></h3></div><span className={styles.windowIcon}><FileText size={22}/></span></div><div className={styles.uploadCard}><div className={styles.uploadIcon}><UploadCloud size={20}/></div><div><strong>Upload your files</strong><small>Add your documents to get started</small></div><span>↗</span></div><div className={styles.windowOptions}><div><small>PAPER SIZE</small><strong>A4 <span>⌄</span></strong></div><div><small>COLOUR</small><strong>Black &amp; white <span>⌄</span></strong></div></div><div className={styles.windowButton}>Review your order <ArrowRight size={15}/></div></div></div>
              <div className={styles.stageNote}><span><Check size={17}/></span><div><small>EXAMPLE ORDER</small><strong>Ready to collect</strong><p>Check progress with your tracking link</p></div></div>
              <div className={styles.stageLabel}>PRINTING, MADE SIMPLE <span>✳</span></div>
              <div className={styles.stageCaption}>ILLUSTRATIVE PREVIEW · SAMPLE DATA</div>
            </div>
          </div>
          <div className={styles.heroBottom}><span>THE LITTLE THINGS, MADE SIMPLE</span><span>FOR EVERYDAY DOCUMENTS &amp; THE SHOPS BEHIND THEM</span><a href="#how-it-works" aria-label="Scroll to how it works">↓</a></div>
        </div>
      </section>
      <section id="how-it-works" className={styles.how}>
        <div className={styles.wrap}>
          <div className={styles.sectionIntro}><p className={styles.chapter}><span /> 01 / THE EXPERIENCE</p><div><h2>From your screen<br />to <em>the shop counter.</em></h2><p>A few easy steps for you. A more organised day for your local shop.</p></div></div>
          <div className={styles.stepGrid}>{steps.map(({number,icon: Icon,title,body}) => <article className={styles.step} key={number}><div className={styles.stepTop}><span>{number} / 04</span><Icon size={24} strokeWidth={1.5}/></div><h3>{title}</h3><p>{body}</p></article>)}</div>
        </div>
      </section>
      <section className={styles.customer}>
        <div className={`${styles.wrap} ${styles.customerGrid}`}><div className={styles.phoneStage}>
          <div className={styles.stageWords} aria-hidden="true">PRINT<br />PICK UP<br />REPEAT.</div>
          <div className={styles.phone}><div className={styles.phoneNotch}/><div className={styles.phoneHeader}><b>printly<span>.</span></b><span>☰</span></div><div className={styles.phoneContent}><span className={styles.phoneTag}>YOUR LOCAL SHOP</span><h3>Print made<br /><em>simple.</em></h3><p>Everything you need, right from your phone.</p><div className={styles.phoneFile}><FileText size={21}/><span><b>Your document</b><small>Ready to personalise</small></span><Check size={16}/></div><div className={styles.phoneOption}><span>Paper size</span><b>A4</b></div><div className={styles.phoneOption}><span>Print type</span><b>Black &amp; white</b></div><div className={styles.phoneButton}>Review your order <ArrowRight size={15}/></div><small className={styles.exampleLabel}>ILLUSTRATIVE EXAMPLE</small></div></div>
          <div className={styles.phoneBubble}><span>✳</span> PRINTING, SIMPLIFIED</div>
        </div><div className={styles.customerCopy}><p className={styles.chapter}><span /> 02 / FOR CUSTOMERS</p><h2>Less waiting.<br /><em>More doing.</em></h2><p>From notes to big ideas, send what you need to print without the back-and-forth. Your local shop takes it from there.</p><div className={styles.benefits}><div><Smartphone size={20}/><span><b>No customer app download</b><small>Start from your browser.</small></span></div><div><Banknote size={20}/><span><b>Pay the shop directly</b><small>UPI or cash where available.</small></span></div><div><PackageCheck size={20}/><span><b>Know where your order stands</b><small>Save your link and follow along.</small></span></div></div><Link href="/s/p-demo1" className={styles.underLink}>Take a look at the demo <ArrowUpRight size={17}/></Link></div></div>
      </section>
      <section id="features" className={styles.owner}>
        <div className={styles.wrap}><div className={styles.ownerIntro}><div><p className={styles.chapter}><span /> 03 / FOR PRINT SHOPS</p><h2>A little more<br /><em>room to grow.</em></h2></div><p>Built for the people behind every good print. Bring your shop online and keep the everyday moving.</p></div>
          <div className={styles.ownerGrid}><div className={styles.ownerText}><span className={styles.ownerPill}>YOUR SHOP, CONNECTED</span><h3>Good for your customers.<br />Great for your shop.</h3><p>One all-features subscription gives your shop a simpler way to receive and manage orders. From the first upload to the final pickup, you’re in control.</p><Link href="/shop/signup" className={styles.lightButton}>Apply to list your shop <ArrowUpRight size={17}/></Link><Link href="/pricing" className={styles.ownerLink}>See shop pricing <ArrowRight size={16}/></Link></div>
            <div className={styles.dashboard}><div className={styles.dashTop}><b>printly<span>.</span></b><span>SHOP WORKSPACE</span><span>•••</span></div><div className={styles.dashBody}><div className={styles.dashSide}><b>Overview</b><span>Orders</span><span>Inventory</span><span>Reports</span><span>Settings</span></div><div className={styles.dashMain}><small>YOUR WORKSPACE</small><h3>A better view of the day.</h3><div className={styles.stats}>{[['New','01'],['Printing','02'],['Ready','03']].map(([label,n])=><div key={label}><small>{label}</small><strong>{n}</strong></div>)}</div><div className={styles.dashOrder}><span><FileText size={20}/></span><div><b>Print order</b><small>Files, options and order details</small></div><strong>Ready</strong></div><p>Illustrative preview, not live shop data.</p></div></div></div>
          </div>
          <div className={styles.featureGrid}>{features.map(({icon: Icon,title,body})=><article key={title}><Icon size={24} strokeWidth={1.6}/><h3>{title}</h3><p>{body}</p></article>)}</div>
        </div>
      </section>
      <section className={styles.pricing}><div className={`${styles.wrap} ${styles.pricingInner}`}><div><p className={styles.chapter}><span /> 04 / MADE FOR YOUR SHOP</p><h2>One plan.<br /><em>Your choice of term.</em></h2><p>Every shop subscription includes the same features. Choose monthly, six-month or yearly access, with no automatic recurring billing.</p><div className={styles.priceChecks}><span><Check size={16}/> All features included</span><span><Check size={16}/> No platform commission on new orders</span></div></div><Link href="/pricing" className={styles.darkButton}>Explore pricing <ArrowUpRight size={18}/></Link></div></section>
      <section className={styles.faq}><div className={`${styles.wrap} ${styles.faqGrid}`}><div><p className={styles.chapter}><span /> 05 / THE DETAILS</p><h2>Good questions.<br /><em>Clear answers.</em></h2><p>Everything you need to know before your first order or your first day on Printly.</p><Link href="/faq" className={styles.underLink}>See all FAQs <ArrowRight size={16}/></Link></div><FaqList items={landingFaqs}/></div></section>
      <section className={styles.final}><div className={styles.wrap}><div className={styles.finalBox}><div><p>LET’S MAKE THE EVERYDAY EASIER</p><h2>Let’s make<br /><em>good things happen.</em></h2><span>Bring your print shop online with Printly.</span></div><Link href="/shop/signup" className={styles.lightButton}>Get your shop started <ArrowUpRight size={18}/></Link><div className={styles.finalMark} aria-hidden="true">✳</div></div></div></section>
    </main>
  </PublicShell>;
}
