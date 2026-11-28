import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const shop = 'https://printly.example/s/p-ab234567';
const otherShop = 'https://printly.example/s/p-cd234567';
const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
let values: Map<string, string>;
let commands: string[][];

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv('PRINTLY_REDIS_REST_URL', 'https://sample.upstash.io');
  vi.stubEnv('PRINTLY_REDIS_REST_TOKEN', 'server-only-test-token');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'server-only-test-signing-secret');
  values = new Map(); commands = [];
  vi.stubGlobal('fetch', vi.fn(async (input: string, init?: RequestInit) => {
    expect(String(input)).toBe('https://sample.upstash.io');
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer server-only-test-token');
    expect(init?.cache).toBe('no-store');
    const args = JSON.parse(String(init?.body)) as string[];
    commands.push(args);
    if (args[0] === 'GET') return Response.json({ result: values.get(args[1]) ?? null });
    if (args[0] === 'SET') { values.set(args[1], args[2]); return Response.json({ result: 'OK' }); }
    throw new Error('unexpected command');
  }));
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('optional public shop QR Redis cache', () => {
  it('uses a hashed URL key, signs the PNG, and sets a one-hour expiry', async () => {
    const { cachedPublicShopQr, cachePublicShopQr } = await import('./public-qr-cache');
    expect(await cachedPublicShopQr(shop)).toBeNull();
    await cachePublicShopQr(shop, png);
    expect(await cachedPublicShopQr(shop)).toEqual(png);
    expect(commands.map((command) => command[0])).toEqual(['GET', 'SET', 'GET']);
    expect(commands[1].slice(3)).toEqual(['EX', '3600']);
    expect(commands[1][1]).toMatch(/^printly:public-shop-qr:v1:[0-9a-f]{64}$/);
    expect(commands[1][1]).not.toContain('ab234567');
    expect(commands[1][2]).not.toContain('server-only-test-signing-secret');
    expect(commands[1][2]).not.toContain('server-only-test-token');
  });

  it('rejects tampered entries and a valid entry copied to a different shop key', async () => {
    const { cachedPublicShopQr, cachePublicShopQr } = await import('./public-qr-cache');
    await cachePublicShopQr(shop, png);
    const firstKey = commands[0][1];
    const firstValue = values.get(firstKey)!;
    await cachePublicShopQr(otherShop, png);
    const secondKey = commands[1][1];
    values.set(secondKey, firstValue);
    expect(await cachedPublicShopQr(otherShop)).toBeNull();
    const tampered = JSON.parse(firstValue);
    tampered.png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 99]).toString('base64');
    values.set(firstKey, JSON.stringify(tampered));
    expect(await cachedPublicShopQr(shop)).toBeNull();
  });

  it('does not use Redis when configuration or public URL is unsafe or missing', async () => {
    const { cachedPublicShopQr, cachePublicShopQr } = await import('./public-qr-cache');
    for (const url of ['https://printly.example/s/p-ab234567?name=private', 'https://printly.example/s/customer-name', 'http://printly.example/s/p-ab234567']) {
      expect(await cachedPublicShopQr(url)).toBeNull(); await cachePublicShopQr(url, png);
    }
    for (const endpoint of ['', 'http://sample.upstash.io', 'https://sample.upstash.io.evil.test', 'https://user:pass@sample.upstash.io', 'https://sample.upstash.io/path']) {
      vi.stubEnv('PRINTLY_REDIS_REST_URL', endpoint);
      expect(await cachedPublicShopQr(shop)).toBeNull(); await cachePublicShopQr(shop, png);
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it('times out and skips further cache requests temporarily without breaking rendering', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(new Error('aborted')));
    })));
    const { cachedPublicShopQr, cachePublicShopQr } = await import('./public-qr-cache');
    const read = cachedPublicShopQr(shop);
    await vi.advanceTimersByTimeAsync(301);
    expect(await read).toBeNull();
    await cachePublicShopQr(shop, png);
    expect(fetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(30_000);
    const readAgain = cachedPublicShopQr(shop);
    await vi.advanceTimersByTimeAsync(301);
    expect(await readAgain).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('rejects oversized responses, non-PNG writes and provider errors', async () => {
    const { cachedPublicShopQr, cachePublicShopQr } = await import('./public-qr-cache');
    await cachePublicShopQr(shop, Buffer.from('not a png'));
    expect(fetch).not.toHaveBeenCalled();
    vi.mocked(fetch).mockResolvedValueOnce(new Response('x'.repeat(410_000), { status: 200 }));
    expect(await cachedPublicShopQr(shop)).toBeNull();
    expect(await cachedPublicShopQr(shop)).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(1); // circuit breaker
  });
});
