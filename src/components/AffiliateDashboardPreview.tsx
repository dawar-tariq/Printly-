import Link from 'next/link';
import { ArrowLeft, ArrowUpRight, BadgeIndianRupee, CircleDollarSign, Clock3, Gift, Link2, ShieldCheck, Users, Wallet } from 'lucide-react';
import { Logo } from '@/components/Logo';
import styles from './AffiliateDashboardPreview.module.css';

export function AffiliateDashboardPreview() {
  return <div className={styles.shell}>
    <header className={styles.header}><Logo /><span className={styles.tag}>AFFILIATE WORKSPACE</span><Link href="/affiliate">About the programme <ArrowUpRight size={15}/></Link></header>
    <main className={styles.main}>
      <div className={styles.notice}><strong>Design preview</strong> · All figures below are examples, not real earnings. Affiliate login and tracking are not active yet.</div>
      <div className={styles.welcome}><div><p className={styles.eyebrow}>YOUR AFFILIATE DASHBOARD</p><h1>See your impact.<br/><em>Celebrate your growth.</em></h1><p>Your referrals, subscription commissions and payouts, all in one clear view.</p></div><span className={styles.sample}>ILLUSTRATIVE EXAMPLE</span></div>
      <section className={styles.stats} aria-label="Example affiliate summary">
        <article><span><Users size={17}/> Referred shops</span><strong>12</strong><small>Example attributed shops</small></article>
        <article><span><CircleDollarSign size={17}/> Total earned</span><strong>₹6,240</strong><small>Example approved commissions</small></article>
        <article><span><Wallet size={17}/> Awaiting payout</span><strong>₹1,440</strong><small>Example unpaid balance</small></article>
        <article><span><BadgeIndianRupee size={17}/> Paid to you</span><strong>₹4,800</strong><small>Example completed payouts</small></article>
      </section>
      <div className={styles.grid}><div className={styles.stack}>
        <section className={styles.card}><div className={styles.cardTitle}><div><p className={styles.eyebrow}>SHARE & GROW</p><h2>Your referral link</h2></div><span className={styles.icon}><Link2 size={19}/></span></div><p>Share your unique link with shop owners. Approved subscription payments and renewals can earn commission.</p><div className={styles.placeholder}>Your personal link will appear here when accounts are active</div><small>Links are not available in this preview.</small></section>
        <section className={styles.card}><div className={styles.cardTitle}><div><p className={styles.eyebrow}>YOUR ACTIVITY</p><h2>Recent earnings</h2></div><span className={styles.sample}>EXAMPLE</span></div><div className={styles.list}><div><span className={styles.rowIcon}><CircleDollarSign size={17}/></span><div><b>Subscription approved</b><small>Referred shop · Example</small></div><strong>+ ₹600</strong></div><div><span className={styles.rowIcon}><Clock3 size={17}/></span><div><b>Renewal approved</b><small>Referred shop · Example</small></div><strong>+ ₹840</strong></div></div><p className={styles.hint}>Future activity will show actual transactions and payout status.</p></section>
      </div><div className={styles.stack}><section className={styles.reward}><div className={styles.cardTitle}><p className={styles.eyebrow}>EARN WITH PRINTLY</p><Gift size={20}/></div><strong>30<span>%</span></strong><h2>On approved subscriptions</h2><p>Earn on attributed shop subscriptions and renewals, once the payment is approved.</p><div className={styles.rewardFoot}>Commission programme preview <ArrowUpRight size={16}/></div></section><section className={styles.card}><div className={styles.cardTitle}><div><p className={styles.eyebrow}>GETTING PAID</p><h2>Your payout details</h2></div><span className={styles.icon}><Wallet size={19}/></span></div><p>In the finished programme, securely add your bank or UPI details for manual payment by the Printly team.</p><div className={styles.placeholder}>Payment details are not available yet</div><div className={styles.security}><ShieldCheck size={16}/> Your payment information should stay private.</div></section></div></div>
      <div className={styles.bottom}><Link href="/affiliate"><ArrowLeft size={15}/> Back to affiliate programme</Link><span>Email sign-in and registration are being built.</span></div>
    </main>
  </div>;
}
