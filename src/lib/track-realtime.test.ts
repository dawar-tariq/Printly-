import { createHash, webcrypto } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ createClient: vi.fn() }));
vi.mock('@supabase/supabase-js', () => ({ createClient: mocks.createClient }));
vi.mock('@/lib/supabase-client', () => ({ SUPABASE_URL: 'https://project.supabase.co', SUPABASE_ANON: 'public-key' }));
import { subscribeTrackingUpdates } from './track-realtime';

const id = '11111111-1111-4111-8111-111111111111';
let change: (() => void) | undefined;
let status: ((value: string) => void) | undefined;
let remove: ReturnType<typeof vi.fn>;
let channelName: string;

beforeEach(() => {
  change = undefined; status = undefined; channelName = ''; remove = vi.fn();
  vi.stubGlobal('crypto', webcrypto);
  mocks.createClient.mockImplementation(() => {
    const channel = {
      on: vi.fn((_kind, _filter, callback) => { change = callback; return channel; }),
      subscribe: vi.fn((callback) => { status = callback; return channel; }),
    };
    return { channel: vi.fn((name) => { channelName = name; return channel; }), removeChannel: remove };
  });
});
afterEach(() => { vi.unstubAllGlobals(); mocks.createClient.mockReset(); });
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

describe('customer order invalidations', () => {
  it('uses a hashed topic, receives hints only and cleans up the channel', async () => {
    const invalidate = vi.fn();
    const stop = subscribeTrackingUpdates(id.toUpperCase(), invalidate);
    await settle();
    expect(channelName).toBe(`printly-track:${createHash('sha256').update(id).digest('hex')}`);
    expect(channelName).not.toContain(id);
    expect(mocks.createClient.mock.calls[0][2].auth).toMatchObject({ persistSession: false, autoRefreshToken: false });
    status?.('SUBSCRIBED'); change?.();
    expect(invalidate).toHaveBeenCalledTimes(2);
    stop();
    expect(remove).toHaveBeenCalledTimes(1);
    change?.(); status?.('SUBSCRIBED');
    expect(invalidate).toHaveBeenCalledTimes(2);
  });
  it('does not connect for malformed IDs or after immediate cleanup', async () => {
    subscribeTrackingUpdates('not-a-tracking-id', vi.fn());
    const stop = subscribeTrackingUpdates(id, vi.fn());
    stop();
    await settle();
    expect(mocks.createClient).not.toHaveBeenCalled();
  });
});
