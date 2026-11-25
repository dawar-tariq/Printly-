'use client';

// This is separate from checkout recovery. It contains only the optional
// contact details the customer explicitly chooses to keep in this browser.
export const CUSTOMER_CONTACT_KEY = 'printly-customer-contact-v1';
export const CUSTOMER_CONTACT_AGE_MS = 90 * 24 * 60 * 60 * 1000;

export type CustomerContact = { name: string; phone: string; email: string };

/** Match checkout's size limits; never save notes, files, payment or order data. */
export function normaliseCustomerContact(input: CustomerContact): CustomerContact | null {
  const name = input.name.trim();
  const phone = input.phone.trim();
  const email = input.email.trim();
  if (!name || name.length > 80 || phone.length < 8 || phone.length > 16 || phone.replace(/\D/g, '').length < 8 ||
      email.length > 120 || (email !== '' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) return null;
  return { name, phone, email };
}

function storage(): Storage | null {
  try { return typeof window === 'undefined' ? null : window.localStorage; }
  catch { return null; }
}

/** Invalid or expired records are ignored and removed on the next visit. */
export function rememberedCustomerContact(now = Date.now()): CustomerContact | null {
  const store = storage();
  if (!store) return null;
  try {
    const raw = store.getItem(CUSTOMER_CONTACT_KEY);
    if (!raw) return null;
    if (raw.length > 2048) throw new Error('oversized');
    const data: unknown = JSON.parse(raw);
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('invalid');
    const record = data as Record<string, unknown>;
    if (record.version !== 1 || typeof record.expiresAt !== 'number' || !Number.isSafeInteger(record.expiresAt) ||
        record.expiresAt <= now || record.expiresAt > now + CUSTOMER_CONTACT_AGE_MS ||
        typeof record.name !== 'string' || typeof record.phone !== 'string' || typeof record.email !== 'string') throw new Error('expired or invalid');
    const contact = normaliseCustomerContact({ name: record.name, phone: record.phone, email: record.email });
    if (!contact) throw new Error('invalid');
    return contact;
  } catch {
    try { store.removeItem(CUSTOMER_CONTACT_KEY); } catch { /* Browser storage may be blocked. */ }
    return null;
  }
}

/** Returns false if the browser cannot store the optional details. */
export function saveCustomerContact(input: CustomerContact, now = Date.now()): boolean {
  const contact = normaliseCustomerContact(input);
  const store = storage();
  if (!contact || !store) return false;
  try {
    store.setItem(CUSTOMER_CONTACT_KEY, JSON.stringify({ version: 1, ...contact, expiresAt: now + CUSTOMER_CONTACT_AGE_MS }));
    return true;
  } catch { return false; }
}

/** Removal is independent of the current order and checkout recovery record. */
export function forgetCustomerContact(): boolean {
  const store = storage();
  if (!store) return false;
  try { store.removeItem(CUSTOMER_CONTACT_KEY); return store.getItem(CUSTOMER_CONTACT_KEY) === null; }
  catch { return false; }
}
