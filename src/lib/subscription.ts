export type SubscriptionTerm = 'monthly' | 'six_months' | 'yearly';
export type EntitlementTerm = SubscriptionTerm | 'grace';
export type PurchaseStatus = 'initiated' | 'submitted' | 'approved' | 'rejected' | 'cancelled';

export const SUBSCRIPTION_TERMS: ReadonlyArray<{ value: SubscriptionTerm; label: string; duration: string }> = [
  { value: 'monthly', label: 'Monthly', duration: '1 month' },
  { value: 'six_months', label: 'Six months', duration: '6 months' },
  { value: 'yearly', label: 'Yearly', duration: '12 months' },
];

export interface ShopSubscription {
  shop_id: string;
  term: EntitlementTerm | null;
  started_at: string | null;
  expires_at: string | null;
  is_permanent: boolean;
  updated_at?: string;
}
export interface SubscriptionPlan {
  monthly_paise: number | null;
  six_months_paise: number | null;
  yearly_paise: number | null;
  upi_id: string | null;
  payee_name: string | null;
  warning_days: number;
}
export interface SubscriptionPurchase {
  id: string;
  shop_id: string;
  term: SubscriptionTerm;
  amount_paise: number;
  upi_id: string | null;
  payee_name: string | null;
  status: PurchaseStatus;
  /** Null on requests created before subscription-offer snapshots existed. */
  base_amount_paise?: number | null;
  monthly_reference_paise?: number | null;
  discount_paise?: number;
  promo_code?: string | null;
  request_key?: string | null;
  utr: string | null;
  submitted_at: string | null;
  reviewed_at: string | null;
  review_note: string;
  period_start: string | null;
  period_end: string | null;
  created_at: string;
}

export function termLabel(term: EntitlementTerm | null | undefined): string {
  return term === 'grace' ? '30-day transition' : SUBSCRIPTION_TERMS.find((item) => item.value === term)?.label ?? 'Not subscribed';
}

/** Fail closed on missing or malformed expiry. Permanent access is an explicit admin grant. */
export function subscriptionState(subscription: Pick<ShopSubscription, 'is_permanent' | 'expires_at' | 'term'> | null | undefined, warningDays = 7, now = Date.now()) {
  if (subscription?.is_permanent === true) return { active: true, status: 'permanent' as const, daysRemaining: null };
  const end = subscription?.expires_at ? Date.parse(subscription.expires_at) : NaN;
  if (!Number.isFinite(end)) return { active: false, status: 'not_subscribed' as const, daysRemaining: null };
  const remaining = end - now;
  if (remaining <= 0) return { active: false, status: 'expired' as const, daysRemaining: 0 };
  const daysRemaining = Math.ceil(remaining / 86_400_000);
  return { active: true, status: daysRemaining <= warningDays ? 'expiring' as const : 'active' as const, daysRemaining };
}

export function subscriptionDate(value: string | null | undefined): string {
  if (!value || !Number.isFinite(Date.parse(value))) return '—';
  return new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata', timeZoneName: 'short' }).format(new Date(value));
}

/** Parse currency without floating-point rounding or silently allowing free plans. */
export function rupeesToPaise(value: string): number | null {
  const match = /^(\d{1,7})(?:\.(\d{1,2}))?$/.exec(value.trim());
  if (!match) return null;
  const result = Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'));
  return result >= 1 && result <= 100_000_000 ? result : null;
}

export function paiseToInput(value: number | null | undefined): string {
  return value == null ? '' : (value / 100).toFixed(2);
}
