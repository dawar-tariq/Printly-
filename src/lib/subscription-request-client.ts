// A request key survives a lost response and page reload. It is scoped to a
// shop, not an authorization credential; the server still verifies the owner.
const prefix = 'printly-subscription-request-v1:';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function readSubscriptionRequestKey(shopId: string): string | null {
  try {
    const value = window.localStorage.getItem(prefix + shopId);
    return value && uuid.test(value) ? value : null;
  } catch { return null; }
}

/** Fail closed if persistent storage or a cryptographically random UUID is unavailable. */
export function ensureSubscriptionRequestKey(shopId: string): string {
  const existing = readSubscriptionRequestKey(shopId);
  if (existing) return existing;
  const next = globalThis.crypto.randomUUID();
  window.localStorage.setItem(prefix + shopId, next);
  const stored = readSubscriptionRequestKey(shopId);
  if (!stored) throw new Error('Could not store the subscription request safely.');
  return stored;
}

export function clearSubscriptionRequestKey(shopId: string, requestKey: string) {
  try {
    // Do not delete a different request started in another tab.
    if (readSubscriptionRequestKey(shopId) === requestKey) window.localStorage.removeItem(prefix + shopId);
  } catch { /* Keeping the old key is safer than inventing a new one. */ }
}
