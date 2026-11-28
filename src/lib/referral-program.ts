/** Pure referral-program calculations. These do not grant access or move money. */
export const REFERRAL_MILESTONES = [
  { count: 10, totalFreeMonths: 6 },
  { count: 15, totalFreeMonths: 6 },
  { count: 20, totalFreeMonths: 12 },
] as const;

export type ReferralProgress = {
  qualifiedShops: number;
  totalFreeMonths: number;
  commissionUnlocked: boolean;
  nextMilestone: number | null;
};

/** Count only distinct shops that have been approved and whose owner has logged in. */
export function referralProgress(referrals: ReadonlyArray<{ shopId: string; approved: boolean; ownerLoggedIn: boolean }>): ReferralProgress {
  const qualified = new Set(referrals.filter(r => r.approved && r.ownerLoggedIn).map(r => r.shopId));
  const qualifiedShops = qualified.size;
  return {
    qualifiedShops,
    totalFreeMonths: qualifiedShops >= 20 ? 12 : qualifiedShops >= 10 ? 6 : 0,
    commissionUnlocked: qualifiedShops >= 15,
    nextMilestone: REFERRAL_MILESTONES.find(m => m.count > qualifiedShops)?.count ?? null,
  };
}

/** 10% of an approved first subscription payment, rounded down to whole paise. */
export function firstPaymentBonusPaise(amountPaise: number): number {
  if (!Number.isSafeInteger(amountPaise) || amountPaise <= 0) throw new RangeError('Amount must be a positive whole number of paise');
  return Math.floor(amountPaise / 10);
}
