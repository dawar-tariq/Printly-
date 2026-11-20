'use client';

import { useEffect, useState } from 'react';
import { subscriptionState, type ShopSubscription } from '@/lib/subscription';

/** Keep open screens accurate at the expiry instant, not only on navigation. */
export function useSubscriptionState(subscription: ShopSubscription | null | undefined, warningDays = 7) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, [subscription?.expires_at, subscription?.is_permanent, subscription?.term]);
  useEffect(() => {
    if (subscription?.is_permanent || !subscription?.expires_at) return;
    const wait = Date.parse(subscription.expires_at) - Date.now();
    if (!Number.isFinite(wait) || wait <= 0 || wait > 2_147_000_000) return;
    const timer = window.setTimeout(() => setNow(Date.now()), wait + 10);
    return () => window.clearTimeout(timer);
  }, [subscription?.expires_at, subscription?.is_permanent, now]);
  return subscriptionState(subscription, warningDays, now);
}
