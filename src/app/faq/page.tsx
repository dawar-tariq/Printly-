import type { Metadata } from 'next';
import { publicCanonical } from '@/lib/public-pages';
import Link from 'next/link';
import { ArrowRight, MessageCircle } from 'lucide-react';
import { FaqList } from '@/components/marketing/FaqList';
import { PublicShell } from '@/components/marketing/PublicShell';
import { faqGroups } from '@/lib/marketing-faq';
import styles from '@/components/marketing/PublicPages.module.css';

export const metadata: Metadata = { alternates: publicCanonical('/faq'), title: 'Frequently asked questions | Printly', description: 'Answers about ordering, payments, subscriptions, file privacy and using Printly as a shop or customer.' };
export default function FaqPage() {
  return <PublicShell><main id="main-content" className={styles.information}>
    <section className={styles.infoHero}><div className={styles.wrap}><p className={styles.eyebrow}><span/> HERE TO HELP</p><h1>Good questions.<br/><em>Clear answers.</em></h1><p>Answers to the things customers and shop owners ask most. Find what you need and get back to your day.</p><div className={styles.infoChips}>{faqGroups.map((group,index)=><a key={group.title} href={`#faq-group-${index}`}>{group.title} <span>↓</span></a>)}</div></div></section>
    <section className={styles.infoBody}><div className={`${styles.wrap} ${styles.faqLayout}`}><div className={styles.faqAside}><p>THE DETAILS</p><h2>Everything you need<br/>to know.</h2><span>Browse by topic, or get in touch if you need a little more help.</span><Link href="/contact">Contact &amp; help <ArrowRight size={16}/></Link></div><div className={styles.faqGroups}>{faqGroups.map((group,index)=><section key={group.title} id={`faq-group-${index}`}><p className={styles.eyebrow}><span/> {index===0?'ORDERING WITH PRINTLY':'RUNNING YOUR SHOP'}</p><h2>{group.title}</h2><FaqList items={group.items}/></section>)}<div className={styles.faqHelp}><MessageCircle size={22}/><div><h3>Still have a question?</h3><p>For an order, contact the shop using the details on its page. Find more guidance and our current contact information on the help page.</p><Link href="/contact">Visit contact &amp; help <ArrowRight size={16}/></Link></div></div></div></div></section>
  </main></PublicShell>;
}
