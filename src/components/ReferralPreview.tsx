import Link from 'next/link';
import { ArrowRight, Gift, Link2, ShieldCheck, Sparkles, Users } from 'lucide-react';
import styles from './ReferralPreview.module.css';

const milestones = [
  { count: '10', title: 'Six months free', text: 'Earn six months of subscription access.' },
  { count: '15', title: 'Unlock 10% bonuses', text: 'Earn 10% of each referred shop’s first approved subscription payment, including earlier referrals.' },
  { count: '20', title: 'One year free in total', text: 'Your free subscription reward increases to 12 months total, not an additional year.' },
];

export function ReferralPreview({ owner = false }: { owner?: boolean }) {
  return <main id="main-content" className={`${styles.page} ${owner ? styles.owner : ''}`}>
    <div className={styles.notice}><Sparkles size={16}/><span>Test preview only — referrals, rewards and payouts are not active yet.</span></div>
    <section className={styles.hero}><div><p className={styles.eyebrow}>PRINTLY REFERRALS</p><h1>Good things grow<br/><em>when you share.</em></h1><p className={styles.lead}>Introduce other print shops to Printly and unlock rewards as your community grows.</p><div className={styles.actions}>{owner ? <Link href="/refer" className={styles.secondary}>How it works <ArrowRight size={16}/></Link> : <Link href="/shop/more" className={styles.primary}>Visit your workspace <ArrowRight size={16}/></Link>}</div></div><div className={styles.heroCard}><div className={styles.icon}><Gift size={25}/></div><span>THE REWARDS JOURNEY</span><strong>Share the tools.<br/>Celebrate the growth.</strong><p>Three milestones, one community of local shops.</p><div className={styles.cardFooter}><Users size={18}/> Built for shop owners</div></div></section>
    {owner && <section className={styles.previewBox}><div><p className={styles.eyebrow}>YOUR REFERRAL SPACE</p><h2>Everything in one place.</h2><p>Your personal link, qualifying shops and bonus history will appear here once the referral system is ready.</p></div><div className={styles.placeholder}><Link2 size={19}/><span>Personal referral link not available yet</span></div></section>}
    <section className={styles.section}><div className={styles.sectionTop}><div><p className={styles.eyebrow}>MILESTONES</p><h2>More shops. More to celebrate.</h2></div><p>Each milestone is based on distinct referred shops that are approved and whose owner has signed in.</p></div><div className={styles.grid}>{milestones.map((m, i) => <article className={styles.milestone} key={m.count}><div className={styles.milestoneTop}><span>0{i + 1} / 03</span><Gift size={19}/></div><strong>{m.count}<small> shops</small></strong><h3>{m.title}</h3><p>{m.text}</p></article>)}</div></section>
    <section className={styles.details}><div className={styles.icon}><ShieldCheck size={23}/></div><div><h2>Clear, simple rewards.</h2><p>A shop counts after approval and its owner’s first login. At 15 qualifying referrals, the bonus applies to the first approved subscription payment of each referred shop, including earlier referrals. Bonuses are tracked for manual payout. The 20-shop reward is 12 months total, including the six months earned at 10.</p><p>Referral tracking and payouts are still being built; this preview does not create a referral or grant a reward.</p></div></section>
  </main>;
}
