import 'server-only';
import { createHash } from 'node:crypto';
import type { Quote } from '@/lib/pricing';

/** Identifies exactly the quote shown to the customer, not an authorization. */
export function quoteToken(orderId: string, draftVersion: number, rush: boolean, quote: Quote) {
  return createHash('sha256').update(JSON.stringify({ orderId, draftVersion, rush, quote })).digest('hex');
}
