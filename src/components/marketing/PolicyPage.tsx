import Link from 'next/link';
import { ArrowRight, BookOpen } from 'lucide-react';
import { PublicShell } from './PublicShell';
import styles from './PublicPages.module.css';

export type PolicySection = { id: string; title: string; content: React.ReactNode };

export function PolicyPage({ eyebrow = 'The details', title, description, sections }: { eyebrow?: string; title: string; description: string; sections: PolicySection[] }) {
  return <PublicShell><main id="main-content" className={styles.policy}>
    <section className={styles.policyHero}><div className={styles.wrap}><div className={styles.breadcrumb}><Link href="/">Printly</Link><span>/</span><span>Resources</span><span>/</span><span>{title}</span></div><p className={styles.eyebrow}><span /> {eyebrow}</p><h1>{title}<span>.</span></h1><p className={styles.lead}>{description}</p><div className={styles.policyMeta}><BookOpen size={15}/><span>PRINTLY RESOURCES</span><span className={styles.metaDot}/><span>Updated November 2026</span></div></div></section>
    <section className={styles.policyContent}><div className={`${styles.wrap} ${styles.policyGrid}`}>
      <nav aria-label="On this page" className={styles.toc}><p>ON THIS PAGE</p><ol>{sections.map((section,index) => <li key={section.id}><a href={`#${section.id}`}><span>{String(index + 1).padStart(2,'0')}</span>{section.title}</a></li>)}</ol></nav>
      <div className={styles.policyArticles}>{sections.map((section,index) => <section key={section.id} id={section.id} className={styles.policyArticle}><div className={styles.sectionNumber}>{String(index + 1).padStart(2,'0')} / {String(sections.length).padStart(2,'0')}</div><h2>{section.title}</h2><div className={styles.prose}>{section.content}</div></section>)}
        <div className={styles.policyHelp}><div><p>NEED A HAND?</p><h2>We’re here to help.</h2><span>Looking for help with an order or your account?</span></div><Link href="/contact">Contact &amp; help <ArrowRight size={16}/></Link></div>
      </div>
    </div></section>
  </main></PublicShell>;
}
