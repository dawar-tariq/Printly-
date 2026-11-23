import type { Metadata } from 'next';
import { publicCanonical } from '@/lib/public-pages';
import Link from 'next/link';
import { ArrowRight, ArrowUpRight, Check, CreditCard, ShieldCheck, Store } from 'lucide-react';
import { PublicShell } from '@/components/marketing/PublicShell';
import { FaqList } from '@/components/marketing/FaqList';
import { OfferBanners } from '@/components/subscription/OfferBanners';
import { faqGroups } from '@/lib/marketing-faq';
import { formatPaiseExact } from '@/lib/format';
import { getPublicPricing } from '@/lib/public-pricing';
import { getPublicSubscriptionAnnouncements } from '@/lib/subscription-offers-server';
import { planSavings, termMonths } from '@/lib/subscription-offers';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { alternates: publicCanonical('/pricing'), title: 'Pricing | Printly', description: 'Explore Printly’s all-features subscription for print shops, with monthly, six-month and yearly terms.' };

const included = ['Your own shop page & QR code', 'Customer ordering and tracking', 'Order queue and status updates', 'Direct UPI and cash payment options', 'Custom services and rate card', 'Reports and inventory tools'];

export default async function PricingPage() {
  const [prices, announcements] = await Promise.all([getPublicPricing(), getPublicSubscriptionAnnouncements()]);
  const plans = [
    { value: 'monthly' as const, label: 'Monthly', period: '1 month of access', amount: prices?.monthly_paise, tone: 'bg-white' },
    { value: 'six_months' as const, label: 'Six months', period: '6 months of access', amount: prices?.six_months_paise, tone: 'bg-white' },
    { value: 'yearly' as const, label: 'Yearly', period: '12 months of access', amount: prices?.yearly_paise, tone: 'bg-[#fff7ef]' },
  ];
  return <PublicShell><main id="main-content">
    <section className="bg-[#f8f6f1] pb-16 pt-16 sm:pb-20 sm:pt-20"><div className="public-container text-center"><p className="eyebrow">Simple pricing for print shops</p><h1 className="mx-auto mt-4 max-w-3xl text-[clamp(2.6rem,5.8vw,4.8rem)] font-extrabold leading-[1.06] tracking-[-0.06em]">One plan. Plenty of possibilities.</h1><p className="mx-auto mt-5 max-w-2xl text-base leading-8 text-[#756b62]">All the tools your shop needs, whichever term you choose. No automatic recurring charge, and no platform commission on new customer orders.</p></div></section>
    <section className="bg-white pb-20"><div className="public-container -mt-4">
      {announcements && announcements.length > 0 && <div className="mb-6"><OfferBanners announcements={announcements} variant="public" /></div>}
      {announcements === null && <p className="mb-5 text-xs text-[#85796f]">Offers and updates are temporarily unavailable. Please check back later.</p>}
      {!prices && <p role="status" className="mb-5 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-900">Current prices are temporarily unavailable. Please check again or sign in to see your shop’s subscription options.</p>}
      <div className="grid gap-4 md:grid-cols-3">{plans.map((plan) => {
        const difference = planSavings(prices?.monthly_paise, plan.value, plan.amount)?.termDifference;
        return <article key={plan.label} className={`flex flex-col rounded-[1.5rem] border border-[#eae3db] ${plan.tone} p-7 shadow-[0_10px_35px_rgba(54,37,23,0.04)] sm:p-8`}>
          <p className="eyebrow">All features included</p><h2 className="mt-3 text-xl font-extrabold tracking-[-0.03em]">{plan.label}</h2><p className="mt-1 text-sm text-[#81766d]">{plan.period}</p>
          <div className="mt-8 min-h-[64px]">{!prices ? <p className="text-lg font-extrabold">Temporarily unavailable</p> : plan.amount == null ? <p className="text-lg font-extrabold">Not currently available</p> : <><p className="text-4xl font-extrabold tracking-[-0.05em]">{formatPaiseExact(plan.amount)}</p><p className="mt-2 text-xs font-semibold text-[#8d8075]">one-time base price for this term</p></>}</div>
          {plan.value !== 'monthly' && difference != null && <p className={`mt-4 text-xs font-bold ${difference > 0 ? 'text-emerald-700' : 'text-[#81766d]'}`}>{difference > 0 ? `Save ${formatPaiseExact(difference)}` : difference < 0 ? `${formatPaiseExact(-difference)} more` : 'Same price'} compared with {termMonths(plan.value)} monthly terms</p>}
          <div className="my-7 h-px bg-[#eee7df]" /><ul className="flex-1 space-y-3.5">{included.map((item) => <li key={item} className="flex items-start gap-2.5 text-sm text-[#5f554d]"><Check size={16} className="mt-0.5 shrink-0 text-[#b93d0c]" />{item}</li>)}</ul>
          <Link href="/shop/signup" className={`public-button mt-8 w-full ${plan.label === 'Yearly' ? 'public-button-orange' : 'public-button-light'}`}>Apply for your shop <ArrowRight size={16} /></Link>
        </article>;
      })}</div>
      <p className="mt-6 text-center text-xs leading-6 text-[#85796f]">Term comparisons use the current monthly price multiplied by the number of months; promo savings are calculated separately and confirmed for your shop. Prices and offer availability may change for future requests.</p>
    </div></section>
    <section className="bg-[#f5f1ea] py-20"><div className="public-container grid gap-7 md:grid-cols-3">{[
      { icon: Store, title: 'First, apply', body: 'Tell us about your shop. Approval and active subscription access are required to accept orders.' },
      { icon: CreditCard, title: 'Choose your term', body: 'The shop owner reviews the price and may apply an eligible promo code. There is no automatic renewal.' },
      { icon: ShieldCheck, title: 'Activate your access', body: 'For a balance due, pay by UPI and submit the reference for independent verification. A fully discounted term activates immediately.' },
    ].map(({ icon: Icon, title, body }, index) => <div key={title}><div className="flex items-center gap-3"><span className="grid h-11 w-11 place-items-center rounded-xl bg-white text-[#b63d0f]"><Icon size={19} /></span><span className="text-xs font-bold text-[#a89b8e]">0{index + 1}</span></div><h2 className="mt-5 text-lg font-extrabold">{title}</h2><p className="mt-2 max-w-sm text-sm leading-7 text-[#756b62]">{body}</p></div>)}</div></section>
    <section className="bg-white py-20"><div className="public-container grid gap-10 lg:grid-cols-[0.75fr_1.25fr] lg:gap-20"><div><p className="eyebrow">A little more detail</p><h2 className="mt-4 text-3xl font-extrabold tracking-[-0.05em]">Pricing questions, answered.</h2><Link href="/faq" className="mt-6 inline-flex items-center gap-2 text-sm font-extrabold text-[#aa390e] hover:underline">All FAQs <ArrowUpRight size={16} /></Link></div><FaqList items={faqGroups[1].items.filter((item) => ['subscription', 'subscription-payment', 'commission', 'expiry'].includes(item.id))} /></div></section>
  </main></PublicShell>;
}
