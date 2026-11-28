import type { Metadata } from 'next';
import { publicCanonical } from '@/lib/public-pages';
import Link from 'next/link';
import { ArrowRight, ArrowUpRight, HeartHandshake, Lightbulb, Store, FileText, Check } from 'lucide-react';
import { PublicShell } from '@/components/marketing/PublicShell';
import styles from '@/components/marketing/PublicPages.module.css';

export const metadata: Metadata = { alternates: publicCanonical('/about'), title: 'About us | Printly', description: 'Meet Printly: a simpler way for local print shops and their customers to get things done.' };

const values = [
  { icon: Store, title: 'Local first', body: 'The neighbourhood shop stays at the heart of the experience, with its own services, prices and direct customer relationships.' },
  { icon: Lightbulb, title: 'Clarity over complexity', body: 'From the order quote to the subscription term, the important details should be easy to find and understand.' },
  { icon: HeartHandshake, title: 'Useful, human tools', body: 'We build around real work: organising the queue, understanding the order and giving people time back.' },
];
export default function AboutPage() {
  return <PublicShell><main id="main-content" className={styles.about}>
    <section className={styles.aboutHero}><div className={`${styles.wrap} ${styles.aboutHeroGrid}`}><div><p className={styles.eyebrow}><span/> A LITTLE ABOUT PRINTLY</p><h1>For the shops<br/>that make <em>things happen.</em></h1><p>There’s a lot of life in a local print shop: application forms, project reports, last-minute copies and the people who make them possible. We believe the process around all of it can be simpler.</p><Link href="/shop/signup" className={styles.aboutButton}>Bring your shop on board <ArrowUpRight size={17}/></Link></div>
      <div className={styles.aboutArt} aria-label="Illustrative print order"><span>BUILT AROUND THE EVERYDAY <ArrowUpRight size={15}/></span><div className={styles.aboutArtCircle}/><div className={styles.aboutArtCard}><div className={styles.aboutArtCardTop}><span>THE LITTLE THINGS ADD UP</span><FileText size={23}/></div><strong>Good work.<br/><em>Made simpler.</em></strong><div className={styles.aboutArtRow}><span><Check size={16}/></span><div><b>One step closer</b><small>From file to finished print</small></div></div></div><small>ILLUSTRATIVE PREVIEW</small></div></div></section>
    <section className={styles.aboutPurpose}><div className={`${styles.wrap} ${styles.aboutPurposeGrid}`}><div><p className={styles.eyebrow}><span/> OUR PURPOSE</p><h2>Good work deserves<br/><em>a smoother way.</em></h2></div><div><p>Printly helps bring the convenience of a simple digital order to the neighbourhood shops people already rely on. Customers can share files, choose their options and follow an order. Shops get a clearer way to receive and manage that work.</p><p>We’re here to support the relationship between a shop and its customers—not get in the middle of it. Customers pay the shop directly for their orders, while shops choose a separate subscription for their Printly tools.</p><p>Technology should help people get on with their day. That means practical features, understandable prices and room for the human touch that makes a local shop special.</p></div></div></section>
    <section className={styles.aboutValues}><div className={styles.wrap}><p className={styles.eyebrow}><span/> WHAT MATTERS TO US</p><h2>Built around <em>the everyday.</em></h2><div className={styles.aboutValuesGrid}>{values.map(({icon: Icon,title,body},index)=><article key={title}><div><span>0{index+1} / 03</span><Icon size={22}/></div><h3>{title}</h3><p>{body}</p></article>)}</div></div></section>
    <section className={styles.aboutEnd}><div className={`${styles.wrap} ${styles.aboutEndInner}`}><div><p className={styles.eyebrow}><span/> LET’S GET STARTED</p><h2>Make a little more<br/><em>room in your day.</em></h2></div><Link href="/shop/signup" className={styles.aboutButton}>Apply to list your shop <ArrowRight size={17}/></Link></div></section>
  </main></PublicShell>;
}
