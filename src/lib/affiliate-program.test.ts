import { describe, expect, it } from 'vitest';
import { affiliateCommissionPaise, validateAffiliateMilestones } from './affiliate-program';

describe('affiliate calculation foundation', () => {
  it('calculates 30 percent of every approved subscription payment including renewals', () => {
    expect(affiliateCommissionPaise(10000)).toBe(3000);
    expect(affiliateCommissionPaise(10001)).toBe(3000);
    expect(affiliateCommissionPaise(100_000_000)).toBe(30_000_000);
  });
  it('accepts configured basis-point rates and rejects invalid values', () => {
    expect(affiliateCommissionPaise(10000, 0)).toBe(0);
    expect(affiliateCommissionPaise(10000, 10000)).toBe(10000);
    for (const amount of [0, -1, 1.5, NaN, Infinity, 100_000_001]) expect(() => affiliateCommissionPaise(amount)).toThrow();
    for (const rate of [-1, 10001, 1.5, NaN]) expect(() => affiliateCommissionPaise(100, rate)).toThrow();
  });
  it('requires positive, ordered, unique milestone thresholds and bonuses', () => {
    expect(validateAffiliateMilestones([])).toBe(true);
    expect(validateAffiliateMilestones([{ approvedPayments: 5, bonusPaise: 50000 }, { approvedPayments: 10, bonusPaise: 100000 }])).toBe(true);
    expect(validateAffiliateMilestones([{ approvedPayments: 5, bonusPaise: 1 }, { approvedPayments: 5, bonusPaise: 1 }])).toBe(false);
    expect(validateAffiliateMilestones([{ approvedPayments: 0, bonusPaise: 1 }])).toBe(false);
    expect(validateAffiliateMilestones([{ approvedPayments: 2, bonusPaise: 0 }])).toBe(false);
  });
});
