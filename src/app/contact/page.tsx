import type { Metadata } from 'next';
import { publicCanonical } from '@/lib/public-pages';
import Link from 'next/link';
import { ArrowRight, FileQuestion, LockKeyhole, Store } from 'lucide-react';
import { PublicShell } from '@/components/marketing/PublicShell';
import styles from '@/components/marketing/PublicPages.module.css';

export const metadata: Metadata = { alternates: publicCanonical('/contact'), title: 'Contact & help | Printly', description: 'Find the right place to get help with a Printly order, shop account or privacy question.' };
const options = [
  { icon: Store, title: 'A customer order', body: 'For order changes, timing, print quality or refunds, contact the shop directly using the details on its shop page. Keep your tracking link and payment reference handy.' },
  { icon: FileQuestion, title: 'Using Printly', body: 'Our FAQs cover placing an order, payment, subscription access and what happens when a shop’s subscription expires.', href: '/faq', action: 'Browse the FAQs' },
  { icon: LockKeyhole, title: 'Privacy or security', body: 'For platform, account or privacy requests, write privately to the Printly team in the support portal. Sign in to check replies, and do not send passwords or payment PINs.', href: '/support', action: 'Write to support' },
];
export default function ContactPage() {
  return <PublicShell><main id="main-content" className={styles.information}>
    <section className={styles.infoHero}><div className={styles.wrap}><p className={styles.eyebrow}><span/> LET’S FIND THE RIGHT ANSWER</p><h1>A little help,<br/><em>right where you need it.</em></h1><p>The best place to start depends on whether your question is about a particular order or the Printly platform.</p></div></section>
    <section className={styles.infoBody}><div className={styles.wrap}><div className={styles.contactIntro}><div><p className={styles.eyebrow}><span/> CHOOSE WHERE TO START</p><h2>How can we help?</h2></div><p>Find the right place for your question, so you can get back to your day.</p></div><div className={styles.contactGrid}>{options.map(({icon: Icon,title,body,href,action},index)=><article key={title}><div className={styles.contactTop}><span>0{index+1} / 03</span><Icon size={22}/></div><h3>{title}</h3><p>{body}</p>{href && <Link href={href}>{action} <ArrowRight size={15}/></Link>}</article>)}</div><div className={styles.contactFoot}><span>Looking for information about your data?</span><Link href="/privacy">Read our privacy policy <ArrowRight size={15}/></Link></div></div></section>
  </main></PublicShell>;
}
