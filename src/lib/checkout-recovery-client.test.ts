// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { forgetCheckout, rememberCheckout, rememberedCheckout } from './checkout-recovery-client';

const pending = { order_id: '11111111-1111-4111-8111-111111111111', method: 'upi' as const, quote_token: 'a'.repeat(64) };
beforeEach(() => { window.sessionStorage.clear(); window.localStorage.clear(); });

describe('tab-scoped checkout recovery reference', () => {
  it('stores only the order and quote identity, is shop-scoped, and can be forgotten', () => {
    expect(rememberCheckout('shop-a', { ...pending, customer_name: 'Private' } as typeof pending)).toBe(true);
    expect(rememberedCheckout('shop-a')).toEqual(pending);
    expect(rememberedCheckout('shop-b')).toBeNull();
    expect(window.sessionStorage.getItem('printly-checkout-v1:shop-a')).not.toContain('Private');
    expect(window.localStorage.length).toBe(0);
    forgetCheckout('shop-a');
    expect(rememberedCheckout('shop-a')).toBeNull();
  });
  it('ignores malformed and tampered stored references', () => {
    window.sessionStorage.setItem('printly-checkout-v1:shop-a', JSON.stringify({ ...pending, order_id: '../other', quote_token: 'not-a-token' }));
    expect(rememberedCheckout('shop-a')).toBeNull();
    window.sessionStorage.setItem('printly-checkout-v1:shop-a', '{');
    expect(rememberedCheckout('shop-a')).toBeNull();
  });
});
