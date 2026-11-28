/** Calculation helpers only. Awarding and payment require a transactional server-side ledger. */
export const DEFAULT_AFFILIATE_COMMISSION_BPS = 3000;

/** Computes commission in whole paise, rounding down. No commission is booked by this function. */
export function affiliateCommissionPaise(amountPaise: number, rateBps = DEFAULT_AFFILIATE_COMMISSION_BPS): number {
  if (!Number.isSafeInteger(amountPaise) || amountPaise <= 0 || amountPaise > 100_000_000) throw new RangeError('Invalid subscription amount');
  if (!Number.isSafeInteger(rateBps) || rateBps < 0 || rateBps > 10_000) throw new RangeError('Invalid commission rate');
  return Math.floor(amountPaise * rateBps / 10_000);
}

/** Draft milestones are validated before any future admin configuration is saved. */
export function validateAffiliateMilestones(milestones: ReadonlyArray<{ approvedPayments: number; bonusPaise: number }>): boolean {
  let previous = 0;
  for (const milestone of milestones) {
    if (!Number.isSafeInteger(milestone.approvedPayments) || milestone.approvedPayments <= previous ||
        !Number.isSafeInteger(milestone.bonusPaise) || milestone.bonusPaise <= 0 || milestone.bonusPaise > 100_000_000) return false;
    previous = milestone.approvedPayments;
  }
  return true;
}
