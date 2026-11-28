import { describe, expect, it } from 'vitest';
import { eligibleTerms, offerEnd, planSavings, promoDescription, subscriptionQuoteSchema, subscriptionSavings, visibleAnnouncementsSchema } from './subscription-offers';

describe('subscription savings and offer display rules', () => {
  it('uses equivalent monthly pricing and keeps promo savings separate', () => {
    expect(planSavings(12500, 'six_months', 60000)).toMatchObject({ reference: 75000, termDifference: 15000, promoSavings: 0, combinedDifference: 15000 });
    expect(subscriptionSavings(60000, 75000, 6000)).toEqual({ reference: 75000, termDifference: 15000, promoSavings: 6000, combinedDifference: 21000 });
  });
  it('shows a term premium honestly and combines it with the actual promo', () => {
    expect(subscriptionSavings(70000, 60000, 5000)).toMatchObject({ termDifference: -10000, promoSavings: 5000, combinedDifference: -5000 });
    expect(subscriptionSavings(70000, 60000, 15000)).toMatchObject({ termDifference: -10000, promoSavings: 15000, combinedDifference: 5000 });
    expect(planSavings(null, 'yearly', 100000)).toMatchObject({ reference: null, termDifference: null, combinedDifference: null });
    expect(subscriptionSavings(null, 120000, 0)).toBeNull();
    expect(subscriptionSavings(10000, 12000, 10001)).toBeNull();
  });
  it('advertises a fixed discount as up to the configured value, and calculates the earliest end', () => {
    expect(promoDescription({ discount_type: 'fixed', discount_value: 2500 })).toBe('Up to ₹25 off');
    expect(promoDescription({ discount_type: 'percent', discount_value: 100 })).toBe('100% off');
    expect(eligibleTerms(['yearly', 'monthly'])).toBe('Monthly, Yearly');
    const value = { id: '11111111-1111-4111-8111-111111111111', title: 'Offer', message: 'Hello', ends_at: '2031-01-01T00:00:00Z',
      promo: { code: 'HELLO', discount_type: 'percent' as const, discount_value: 10, terms: ['yearly' as const], ends_at: '2030-01-01T00:00:00Z' } };
    expect(offerEnd(value)).toBe('2030-01-01T00:00:00Z');
    const parsed = visibleAnnouncementsSchema.parse([{ ...value, admin_secret: 'hidden', promo: { ...value.promo, max_uses: 12 } }]);
    expect(JSON.stringify(parsed)).not.toContain('admin_secret');
    expect(JSON.stringify(parsed)).not.toContain('max_uses');
  });
  it('rejects internally inconsistent quote data', () => {
    const quote = { term: 'monthly', base_paise: 10000, monthly_reference_paise: 10000, discount_paise: 2500, amount_paise: 7500,
      promo_code: 'SAVE25', promo_id: '22222222-2222-4222-8222-222222222222', promo_version: 0, plan_version: 2, access_expires_at: '2030-01-01T00:00:00.123456Z' };
    expect(subscriptionQuoteSchema.safeParse(quote).success).toBe(true);
    expect(subscriptionQuoteSchema.safeParse({ ...quote, amount_paise: 0 }).success).toBe(false);
    expect(subscriptionQuoteSchema.safeParse({ ...quote, promo_code: null }).success).toBe(false);
  });
});
