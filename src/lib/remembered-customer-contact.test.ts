// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CUSTOMER_CONTACT_AGE_MS, CUSTOMER_CONTACT_KEY, forgetCustomerContact, normaliseCustomerContact, rememberedCustomerContact, saveCustomerContact } from './remembered-customer-contact';

const now = 1_800_000_000_000;
const contact = { name: ' Aisha Khan ', phone: '97970 00000', email: ' aisha@example.com ' };

beforeEach(() => { localStorage.clear(); sessionStorage.clear(); });
afterEach(() => { vi.restoreAllMocks(); });

describe('optional browser-local customer details', () => {
  it('stores only the opted-in contact fields with a bounded expiry', () => {
    const extra = { ...contact, notes: 'private instructions', order_id: 'private order' };
    expect(saveCustomerContact(extra, now)).toBe(true);
    const raw = localStorage.getItem(CUSTOMER_CONTACT_KEY)!;
    expect(JSON.parse(raw)).toEqual({ version: 1, name: 'Aisha Khan', phone: '97970 00000', email: 'aisha@example.com', expiresAt: now + CUSTOMER_CONTACT_AGE_MS });
    expect(raw).not.toContain('private');
    expect(rememberedCustomerContact(now + 1)).toEqual({ name: 'Aisha Khan', phone: '97970 00000', email: 'aisha@example.com' });
  });

  it('does not restore malformed, oversized, invalid, expired or too-far-future records', () => {
    for (const raw of [
      '{', 'x'.repeat(2049),
      JSON.stringify({ version: 1, name: 'Aisha', phone: 'short', email: '', expiresAt: now + 1 }),
      JSON.stringify({ version: 1, name: 'Aisha', phone: '9797000000', email: '', expiresAt: now }),
      JSON.stringify({ version: 1, name: 'Aisha', phone: '9797000000', email: '', expiresAt: now + CUSTOMER_CONTACT_AGE_MS + 1 }),
      JSON.stringify({ version: 2, name: 'Aisha', phone: '9797000000', email: '', expiresAt: now + 1 }),
    ]) {
      localStorage.setItem(CUSTOMER_CONTACT_KEY, raw);
      expect(rememberedCustomerContact(now)).toBeNull();
      expect(localStorage.getItem(CUSTOMER_CONTACT_KEY)).toBeNull();
    }
  });

  it('accepts an optional email but refuses incomplete or overlong fields', () => {
    expect(normaliseCustomerContact({ ...contact, email: '' })?.email).toBe('');
    for (const value of [
      { ...contact, name: ' ' }, { ...contact, name: 'x'.repeat(81) },
      { ...contact, phone: '1234567' }, { ...contact, phone: '1'.repeat(17) },
      { ...contact, email: 'bad@' }, { ...contact, email: `${'a'.repeat(120)}@b.c` },
    ]) expect(normaliseCustomerContact(value)).toBeNull();
  });

  it('clears only the local contact record, not checkout recovery', () => {
    saveCustomerContact(contact, now);
    sessionStorage.setItem('printly-checkout-v1:p-demo1', 'recovery-reference');
    expect(forgetCustomerContact()).toBe(true);
    expect(localStorage.getItem(CUSTOMER_CONTACT_KEY)).toBeNull();
    expect(sessionStorage.getItem('printly-checkout-v1:p-demo1')).toBe('recovery-reference');
  });

  it('fails safely when browser storage is blocked', () => {
    vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => { throw new DOMException('blocked', 'SecurityError'); });
    expect(rememberedCustomerContact(now)).toBeNull();
    expect(saveCustomerContact(contact, now)).toBe(false);
    expect(forgetCustomerContact()).toBe(false);
  });
});
