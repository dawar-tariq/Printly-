import { Sparkles, TicketPercent } from 'lucide-react';
import { eligibleTerms, offerEnd, promoDescription, type VisibleAnnouncement } from '@/lib/subscription-offers';
import { subscriptionDate } from '@/lib/subscription';

/** The same safely rendered, live offer details appear in both subscription surfaces. */
export function OfferBanners({ announcements, variant = 'shop' }: { announcements: VisibleAnnouncement[]; variant?: 'shop' | 'public' }) {
  if (!announcements.length) return null;
  return <section aria-label="Subscription offers and updates" className="space-y-3">
    {announcements.map((announcement) => {
      const end = offerEnd(announcement);
      return <article key={announcement.id} className={`relative overflow-hidden rounded-[1.35rem] border border-orange-200 ${variant === 'public' ? 'bg-[#fff3e7] p-6 sm:p-7' : 'bg-gradient-to-br from-[#fff6e8] via-[#fffaf3] to-white p-5 sm:p-6'}`}>
        <div aria-hidden="true" className="pointer-events-none absolute -right-12 -top-20 h-44 w-44 rounded-full bg-orange-200/30 blur-2xl" />
        <div className="relative flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-2xl">
            <p className="flex items-center gap-1.5 text-[0.68rem] font-extrabold uppercase tracking-[0.16em] text-orange-800"><Sparkles size={14} />Printly update</p>
            <h2 className="mt-2 text-lg font-extrabold tracking-tight text-[#31221a] sm:text-xl">{announcement.title}</h2>
            <p className="mt-1.5 whitespace-pre-line text-sm leading-6 text-[#765344]">{announcement.message}</p>
            {announcement.promo && <p className="mt-3 text-xs leading-5 text-[#765344]">Eligible terms: {eligibleTerms(announcement.promo.terms)}. Subject to availability and usage limits.{end ? ` Ends ${subscriptionDate(end)}.` : ''}</p>}
            {!announcement.promo && end && <p className="mt-3 text-xs text-[#765344]">Available until {subscriptionDate(end)}.</p>}
          </div>
          {announcement.promo && <div className="min-w-36 rounded-xl border border-orange-200 bg-white/85 px-4 py-3 shadow-sm">
            <p className="flex items-center gap-1.5 text-xs font-extrabold text-orange-800"><TicketPercent size={15} />{promoDescription(announcement.promo)}</p>
            <p className="mt-1 text-[0.65rem] font-semibold uppercase tracking-wider text-neutral-500">Use promo code</p>
            <p className="mt-0.5 break-all font-mono text-base font-extrabold tracking-wide text-neutral-900">{announcement.promo.code}</p>
          </div>}
        </div>
      </article>;
    })}
  </section>;
}
