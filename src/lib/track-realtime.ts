import { createClient, type RealtimeChannel, type SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_ANON, SUPABASE_URL } from '@/lib/supabase-client';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Public broadcast carries no order data. The unguessable tracking ID is hashed
 * before use as a topic, so it is not sent to the Realtime service. Events are
 * untrusted hints only; the caller must re-fetch the rate-limited tracking API.
 * Return a synchronous cleanup even if hashing or connecting finishes later.
 */
export function subscribeTrackingUpdates(orderId: string, invalidate: () => void): () => void {
  let stopped = false;
  let client: SupabaseClient | undefined;
  let channel: RealtimeChannel | undefined;
  void (async () => {
    if (!UUID.test(orderId) || !SUPABASE_URL || !SUPABASE_ANON || !globalThis.crypto?.subtle) return;
    const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(orderId.toLowerCase()));
    if (stopped) return;
    const topic = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
    // A customer need not have an account. This separate ephemeral client must
    // not read a shop's browser session or persist tokens in local storage.
    client = createClient(SUPABASE_URL, SUPABASE_ANON, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    channel = client.channel(`printly-track:${topic}`, { config: { private: false } })
      .on('broadcast', { event: 'changed' }, () => { if (!stopped) invalidate(); })
      .subscribe((status) => { if (!stopped && status === 'SUBSCRIBED') invalidate(); });
  })().catch(() => { /* Periodic tracking refresh remains available. */ });
  return () => {
    stopped = true;
    if (client && channel) void client.removeChannel(channel);
  };
}
