import Link from 'next/link';
import { ArrowRight, ArrowUpRight } from 'lucide-react';
import { Logo } from '@/components/Logo';
import styles from '@/app/landing.module.css';

const sections = [
  { title: 'Explore', links: [['How it works', '/#how-it-works'], ['For print shops', '/#features'], ['Pricing', '/pricing'], ['About Printly', '/about'], ...(process.env.PRINTLY_ISOLATED_TEST === '1' ? [['Refer & earn', '/refer']] : [])] },
  { title: 'Get started', links: [['Explore demo shop', '/s/p-demo1'], ['List your shop', '/shop/signup'], ['Shop sign in', '/login'], ['FAQs', '/faq']] },
  { title: 'Resources', links: [['Contact & help', '/contact'], ['Security', '/security'], ['Accessibility', '/accessibility'], ['Copyright', '/copyright']] },
  { title: 'The details', links: [['Privacy policy', '/privacy'], ['Terms & conditions', '/terms'], ['Refunds & cancellations', '/refunds'], ['Cookie notice', '/cookies']] },
];

export function LandingFooter() {
  return <footer className={styles.newFooter}>
    <div className={styles.footerInner}>
      <div className={styles.footerTop}>
        <div><p className={styles.footerEyebrow}><span /> A BETTER WAY TO PRINT, TOGETHER</p><h2>Good things happen<br /><em>when we print together.</em></h2></div>
        <Link className={styles.footerCta} href="/shop/signup">Bring your shop online <ArrowUpRight size={17}/></Link>
      </div>
      <div className={styles.footerMiddle}>
        <div className={styles.footerBrand}><Logo inverse /><p>Making everyday printing simpler for local shops and the people they serve.</p><Link href="/contact">Need a hand? <ArrowRight size={15}/></Link></div>
        <div className={styles.footerColumns}>{sections.map(section => <div key={section.title}><h3>{section.title}</h3><ul>{section.links.map(([label,href]) => <li key={href}><Link href={href}>{label}</Link></li>)}</ul></div>)}</div>
      </div>
      <div className={styles.footerWordmark} aria-hidden="true">printly<span>.</span></div>
      <div className={styles.footerBottom}><span>© {new Date().getFullYear()} Printly. All rights reserved.</span><span>Made for local shops, and the moments that matter.</span><Link href="#main-content">Back to top ↑</Link></div>
    </div>
  </footer>;
}
