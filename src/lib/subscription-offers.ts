import { z } from 'zod';
import { formatPaiseExact } from '@/lib/format';
import { SUBSCRIPTION_TERMS, type SubscriptionTerm } from '@/lib/subscription';

export const subscriptionTermSchema = z.enum(['monthly', 'six_months', 'yearly']);
export const promoCodeSchema = z.string().trim().min(3).max(32)
  .regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/).transform((code) => code.toUpperCase());
const price = z.number().int().min(1).max(100_000_000);
const version = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const timestamp = z.string().datetime({ offset: true }).nullable();

/** An untrusted copy of the server quote; the database recalculates and compares it at purchase time. */
export const subscriptionQuoteSchema = z.object({
  term: subscriptionTermSchema,
  base_paise: price,
  monthly_reference_paise: z.number().int().min(1).max(1_200_000_000).nullable(),
  discount_paise: z.number().int().min(0).max(100_000_000),
  amount_paise: z.number().int().min(0).max(100_000_000),
  promo_code: promoCodeSchema.nullable(),
  promo_id: z.string().uuid().nullable(),
  promo_version: version.nullable(),
  plan_version: version,
  access_expires_at: timestamp,
}).strict().refine((quote) => quote.amount_paise === quote.base_paise - quote.discount_paise &&
  (quote.promo_code === null
    ? quote.promo_id === null && quote.promo_version === null && quote.discount_paise === 0
    : quote.promo_id !== null && quote.promo_version !== null && quote.discount_paise > 0));
export type SubscriptionQuote = z.infer<typeof subscriptionQuoteSchema>;

const visiblePromoSchema = z.object({
  code: promoCodeSchema,
  discount_type: z.enum(['percent', 'fixed']),
  discount_value: z.number().int().min(1).max(100_000_000),
  terms: z.array(subscriptionTermSchema).min(1).max(3),
  ends_at: timestamp,
}).refine((promo) => promo.discount_type !== 'percent' || promo.discount_value <= 100);
export const visibleAnnouncementsSchema = z.array(z.object({
  id: z.string().uuid(),
  title: z.string().min(1).max(100),
  message: z.string().min(1).max(400),
  ends_at: timestamp,
  promo: visiblePromoSchema.nullable(),
})).max(100);
export type VisibleAnnouncement = z.infer<typeof visibleAnnouncementsSchema>[number];

export type SubscriptionPromo = {
  id: string; code: string; discount_type: 'percent' | 'fixed'; discount_value: number;
  terms: SubscriptionTerm[]; starts_at: string | null; ends_at: string | null;
  max_uses: number | null; max_uses_per_shop: number | null; enabled: boolean;
  version: number; approved_uses: number; reserved_uses: number; created_at: string;
};
export type SubscriptionAnnouncement = {
  id: string; title: string; message: string; promo_id: string | null; promo_code: string | null;
  starts_at: string | null; ends_at: string | null; enabled: boolean; public_visible: boolean;
  version: number; created_at: string;
};

export const termMonths = (term: SubscriptionTerm) => term === 'monthly' ? 1 : term === 'six_months' ? 6 : 12;

/** Positive means saving; negative means the term costs more than monthly. */
export function subscriptionSavings(base: number | null | undefined, reference: number | null | undefined, promo: number | null | undefined = 0) {
  if (typeof base !== 'number' || !Number.isSafeInteger(base) || base < 1 ||
    typeof promo !== 'number' || !Number.isSafeInteger(promo) || promo < 0 || promo > base) return null;
  const basePaise = base, promoPaise = promo;
  const monthlyReference = typeof reference === 'number' && Number.isSafeInteger(reference) && reference > 0 ? reference : null;
  return {
    reference: monthlyReference,
    termDifference: monthlyReference === null ? null : monthlyReference - basePaise,
    promoSavings: promoPaise,
    combinedDifference: monthlyReference === null ? null : monthlyReference - (basePaise - promoPaise),
  };
}

export function planSavings(monthlyPaise: number | null | undefined, term: SubscriptionTerm, termPaise: number | null | undefined) {
  const reference = typeof monthlyPaise === 'number' && Number.isSafeInteger(monthlyPaise) && monthlyPaise > 0 ? monthlyPaise * termMonths(term) : null;
  return subscriptionSavings(termPaise, reference, 0);
}

/** Fixed codes are capped by the term price, so advertise them as "up to". */
export function promoDescription(promo: Pick<SubscriptionPromo, 'discount_type' | 'discount_value'>) {
  return promo.discount_type === 'percent' ? `${promo.discount_value}% off` : `Up to ${formatPaiseExact(promo.discount_value)} off`;
}
export function eligibleTerms(terms: SubscriptionTerm[]) {
  return SUBSCRIPTION_TERMS.filter((term) => terms.includes(term.value)).map((term) => term.label).join(', ');
}

/** The earliest end is the effective end for a linked announcement. */
export function offerEnd(announcement: VisibleAnnouncement): string | null {
  const dates = [announcement.ends_at, announcement.promo?.ends_at].filter((value): value is string => !!value && Number.isFinite(Date.parse(value)));
  return dates.length ? dates.reduce((a, b) => Date.parse(a) <= Date.parse(b) ? a : b) : null;
}
