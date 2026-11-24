export type PendingCheckout = { order_id: string; method: 'upi' | 'cod'; quote_token: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const key = (slug: string) => `printly-checkout-v1:${slug}`;

/** Only an order reference and quote identity are kept, never contact details. */
export function rememberCheckout(slug: string, pending: PendingCheckout): boolean {
  try {
    window.sessionStorage.setItem(key(slug), JSON.stringify({ order_id: pending.order_id, method: pending.method, quote_token: pending.quote_token }));
    return true;
  } catch { return false; }
}

/** sessionStorage is tab-scoped and survives reload; browser restore policies vary. */
export function rememberedCheckout(slug: string): PendingCheckout | null {
  try {
    const raw = window.sessionStorage.getItem(key(slug));
    if (!raw || raw.length > 1000) return null;
    const value = JSON.parse(raw) as Partial<PendingCheckout>;
    if (typeof value.order_id !== 'string' || !UUID.test(value.order_id) ||
        (value.method !== 'upi' && value.method !== 'cod') ||
        typeof value.quote_token !== 'string' || !/^[0-9a-f]{64}$/.test(value.quote_token)) return null;
    return { order_id: value.order_id, method: value.method, quote_token: value.quote_token };
  } catch { return null; }
}

export function forgetCheckout(slug: string) {
  try { window.sessionStorage.removeItem(key(slug)); } catch { /* Storage may be disabled. */ }
}
