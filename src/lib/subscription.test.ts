import { describe, expect, it } from 'vitest';
import { paiseToInput, rupeesToPaise, subscriptionState, termLabel } from './subscription';

const start = Date.parse('2026-01-01T00:00:00Z');
const subscription = { is_permanent: false, term: 'monthly' as const, expires_at: '2026-01-08T00:00:00Z' };

describe('subscription display and currency rules', () => {
  it('detects an expiring subscription and expires exactly at its end', () => {
    expect(subscriptionState(subscription, 6, start)).toMatchObject({ active: true, status: 'active', daysRemaining: 7 });
    expect(subscriptionState(subscription, 7, start)).toMatchObject({ active: true, status: 'expiring', daysRemaining: 7 });
    expect(subscriptionState(subscription, 7, Date.parse(subscription.expires_at))).toMatchObject({ active: false, status: 'expired' });
    expect(subscriptionState(null).active).toBe(false);
    expect(subscriptionState({ ...subscription, expires_at: 'invalid' }).active).toBe(false);
  });
  it('never expires permanent access', () => {
    expect(subscriptionState({ ...subscription, is_permanent: true }, 7, start + 999 * 86_400_000)).toMatchObject({ active: true, status: 'permanent' });
  });
  it('recognizes each term and handles decimal rupees precisely', () => {
    expect(termLabel('six_months')).toBe('Six months');
    expect(rupeesToPaise('99.05')).toBe(9905);
    expect(rupeesToPaise('0')).toBeNull();
    expect(rupeesToPaise('1.234')).toBeNull();
    expect(paiseToInput(9905)).toBe('99.05');
  });
});
