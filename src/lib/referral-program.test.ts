import { describe, expect, it } from 'vitest';
import { firstPaymentBonusPaise, referralProgress } from './referral-program';

const shops = (count: number) => Array.from({ length: count }, (_, i) => ({ shopId: String(i), approved: true, ownerLoggedIn: true }));

describe('referral programme rules', () => {
  it.each([[0, 0, false, 10], [9, 0, false, 10], [10, 6, false, 15], [14, 6, false, 15], [15, 6, true, 20], [19, 6, true, 20], [20, 12, true, null], [21, 12, true, null]])
  ('calculates progress for %i qualifying shops', (count, months, unlocked, next) => {
    expect(referralProgress(shops(count))).toEqual({ qualifiedShops: count, totalFreeMonths: months, commissionUnlocked: unlocked, nextMilestone: next });
  });
  it('requires both approval and owner login and counts a shop only once', () => {
    expect(referralProgress([...shops(1), ...shops(1), { shopId: 'pending', approved: false, ownerLoggedIn: true }, { shopId: 'not-logged-in', approved: true, ownerLoggedIn: false }]).qualifiedShops).toBe(1);
  });
  it('calculates first-payment commission in whole paise', () => {
    expect(firstPaymentBonusPaise(999)).toBe(99);
    for (const invalid of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) expect(() => firstPaymentBonusPaise(invalid)).toThrow(RangeError);
  });
});
