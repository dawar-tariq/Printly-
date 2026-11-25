import { execFileSync } from 'node:child_process';
import { afterAll, describe, expect, it, vi } from 'vitest';

// Optional integration: a disposable Redis on a Unix socket, with an in-test
// REST adapter. This tests real GET/SET/EX semantics, not Upstash networking.
const enabled = process.env.PRINTLY_DISPOSABLE_REDIS_TEST === '1';
const socket = process.env.PRINTLY_TEST_REDIS_SOCKET ?? '';
const cli = process.env.PRINTLY_TEST_REDIS_CLI ?? '';
const keys: string[] = [];
const command = (...args: string[]) => execFileSync(cli, ['-s', socket, '--raw', ...args], { encoding: 'utf8', timeout: 1000 }).trimEnd();

describe.skipIf(!enabled)('disposable Redis QR cache integration', () => {
  afterAll(() => {
    for (const key of keys) command('DEL', key);
    vi.unstubAllEnvs(); vi.unstubAllGlobals();
  });
  it('writes and reads a signed QR with Redis expiry', async () => {
    // No TCP, hosted URL, flushall or existing shop key can be targeted.
    expect(socket).toBe('/tmp/printly-redis-test/redis.sock');
    expect(cli).toBe('/tmp/printly-redis-test/redis-7.4.2/src/redis-cli');
    vi.stubEnv('PRINTLY_REDIS_REST_URL', 'https://synthetic.upstash.io');
    vi.stubEnv('PRINTLY_REDIS_REST_TOKEN', 'synthetic-token');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'synthetic-secret');
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      const args = JSON.parse(String(init?.body)) as string[];
      expect(args[0] === 'GET' || args[0] === 'SET').toBe(true);
      if (!keys.includes(args[1])) keys.push(args[1]);
      const result = command(...args);
      return Response.json({ result: args[0] === 'GET' && result === '' ? null : result });
    }));
    const { cachedPublicShopQr, cachePublicShopQr } = await import('./public-qr-cache');
    const url = 'https://printly-test.invalid/s/p-abc12345';
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 4, 5, 6]);
    expect(await cachedPublicShopQr(url)).toBeNull();
    await cachePublicShopQr(url, png);
    expect(await cachedPublicShopQr(url)).toEqual(png);
    const ttl = Number(command('TTL', keys[0]));
    expect(ttl).toBeGreaterThan(3500); expect(ttl).toBeLessThanOrEqual(3600);
  });
});
