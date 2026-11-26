import { describe, expect, it } from 'vitest';
import type { NativePushTarget } from './native-push-server';
import { nativePushWorkerEnabled } from './native-push-worker-gate';

describe('isolated native notification delivery gate', () => {
  it('fails closed without an exact separate QA delivery opt-in', () => {
    for (const value of [undefined, '', '0', 'true', '01', ' 1', '1 ']) {
      expect(nativePushWorkerEnabled('isolated', { PRINTLY_ISOLATED_NATIVE_PUSH_DELIVERY_ENABLED: value })).toBe(false);
    }
    expect(nativePushWorkerEnabled('isolated', { PRINTLY_ISOLATED_NATIVE_PUSH_DELIVERY_ENABLED: '1' })).toBe(true);
  });
  it('does not change production behavior and rejects unknown targets', () => {
    expect(nativePushWorkerEnabled('production', {})).toBe(true);
    expect(nativePushWorkerEnabled('unexpected' as NativePushTarget, { PRINTLY_ISOLATED_NATIVE_PUSH_DELIVERY_ENABLED: '1' })).toBe(false);
  });
});
