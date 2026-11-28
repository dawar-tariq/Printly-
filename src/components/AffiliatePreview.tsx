import Link from 'next/link';
import { ArrowRight, BadgeIndianRupee, CheckCircle2, Link2, ShieldCheck, Sparkles, Users } from 'lucide-react';
import styles from './ReferralPreview.module.css';

export function AffiliatePreview({ admin = false }: { admin?: boolean }) {
  const Wrapper = admin ? 'div' : 'main';
  return <Wrapper id={admin ? undefined : 'main-content'} className={`${styles.page} ${admin ? styles.owner : ''}`}>
    <div className={styles.notice}><Sparkles size={16}/><span>Test preview only — affiliate registration, tracking, commissions and payouts are not active.</span></div>
    <section className={styles.hero}><div><p className={styles.eyebrow}>{admin ? 'AFFILIATE MANAGEMENT' : 'PRINTLY AFFILIATE PROGRAMME'}</p><h1>{admin ? <>A clearer view of<br/><em>affiliate rewards.</em></> : <>Share Printly.<br/><em>Grow together.</em></>}</h1><p className={styles.lead}>{admin ? 'A planned place to review affiliate activity, manage incentives and record payments.' : 'Help local print shops discover Printly and earn 30% on their approved subscription payments, including renewals.'}</p>{!admin && <div className={styles.actions}><Link href="/affiliate/dashboard" className={styles.primary}>Preview affiliate dashboard <ArrowRight size={16}/></Link> <Link href="/refer" className={styles.secondary}>Shop-owner referrals <ArrowRight size={16}/></Link><p className="mt-3 text-xs text-neutral-500">Email sign-up and sign-in are being built and are not yet available.</p></div>}</div><div className={styles.heroCard}><div className={styles.icon}><BadgeIndianRupee size={25}/></div><span>{admin ? 'PLANNED ADMIN WORKSPACE' : 'AFFILIATE COMMISSION'}</span><strong>30% on approved<br/>subscriptions.</strong><p>Including renewals, when an attributed shop’s payment is approved.</p><div className={styles.cardFooter}><Users size={18}/> Open to affiliates, not just shop owners</div></div></section>
    <section className={styles.section}><div className={styles.sectionTop}><div><p className={styles.eyebrow}>HOW IT IS PLANNED</p><h2>{admin ? 'Manage the whole journey.' : 'Simple steps, clear rewards.'}</h2></div><p>Everything shown here describes the planned programme; the tools themselves are not yet available.</p></div><div className={styles.grid}>
      {(admin ? [
        { title: 'Affiliates & attribution', body: 'Review affiliate accounts and attributed shops, and manage affiliate access.' },
        { title: 'Commissions & payouts', body: 'Review approved subscription commissions, view payment details securely and record manual payouts.' },
        { title: 'Milestone incentives', body: 'Configure milestones and incentives, with a clear history of changes and awards.' },
      ] : [
        { title: 'Join with email', body: 'Affiliate registration and email login are planned. Google login is not being added yet.' },
        { title: 'Share your link', body: 'Share your personal link with print shop owners. The link will connect eligible shop signups to your account.' },
        { title: 'Earn on subscriptions', body: 'Earn 30% when an attributed shop’s subscription payment or renewal is approved. Payments are made manually.' },
      ]).map((item, i) => <article className={styles.milestone} key={item.title}><div className={styles.milestoneTop}><span>0{i + 1} / 03</span><CheckCircle2 size={19}/></div><h3>{item.title}</h3><p>{item.body}</p></article>)}
    </div></section>
    <section className={styles.details}><div className={styles.icon}>{admin ? <ShieldCheck size={23}/> : <Link2 size={23}/>}</div><div><h2>{admin ? 'Designed for careful payment review.' : 'A separate programme for affiliates.'}</h2><p>{admin ? 'The intended workflow is to pay via bank or UPI outside Printly, then record the payment. Sensitive payment details require restricted access. No payment data or live ledger exists in this preview.' : 'Affiliate rewards and the shop-owner referral programme can both apply. Payment details and affiliate activity will be private to the affiliate and authorised administrators.'}</p><p>Affiliate accounts, links, milestone controls and payout records are still being built. No rewards are created by this preview.</p></div></section>
  </Wrapper>;
}
