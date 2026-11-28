import type { NativePushTarget } from '@/lib/native-push-server';

/**
 * Registration can be enabled in the isolated phone-test environment without
 * enabling any deliveries. QA delivery is a second, explicit opt-in: missing,
 * malformed or unexpected values fail closed. This does not install or start a
 * scheduler and is not a substitute for disabling database claim privileges.
 */
export function nativePushWorkerEnabled(target: NativePushTarget, env: Record<string, string | undefined> = process.env): boolean {
  if (target === 'production') return true;
  return target === 'isolated' && env.PRINTLY_ISOLATED_NATIVE_PUSH_DELIVERY_ENABLED === '1';
}
