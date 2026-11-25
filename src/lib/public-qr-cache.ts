import 'server-only';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

// Optional Upstash Redis REST cache for a single non-sensitive derived asset:
// the printable public shop QR. Postgres still decides membership and all
// business state. Bump this version whenever QR artwork/encoding changes.
const VERSION = 'printly:public-shop-qr:v1';
const TTL_SECONDS = 60 * 60;
const MAX_PNG_BYTES = 256 * 1024;
const MAX_RESPONSE_BYTES = 400 * 1024;
const TIMEOUT_MS = 300;
const RETRY_AFTER_FAILURE_MS = 30_000;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
let retryAfter = 0;

type CacheConfig = { endpoint: string; token: string; secret: string };
function config(): CacheConfig | null {
  const endpoint = process.env.PRINTLY_REDIS_REST_URL;
  const token = process.env.PRINTLY_REDIS_REST_TOKEN;
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!endpoint || !token || !secret || token.length > 4096 || /\s/.test(token)) return null;
  try {
    const uri = new URL(endpoint);
    // Only the documented managed Redis REST service, not arbitrary internal
    // URLs. Credentials never appear in the URL or leave the server as data.
    if (uri.protocol !== 'https:' || !uri.hostname.endsWith('.upstash.io') || uri.port ||
        uri.username || uri.password || (uri.pathname !== '/' && uri.pathname !== '') || uri.search || uri.hash) return null;
    return { endpoint: uri.origin, token, secret };
  } catch { return null; }
}

function keyFor(publicShopUrl: string): string | null {
  try {
    const uri = new URL(publicShopUrl);
    if (uri.protocol !== 'https:' || uri.username || uri.password || uri.search || uri.hash ||
        !/^\/s\/p-[a-z0-9]{4,16}$/i.test(uri.pathname)) return null;
    return `${VERSION}:${createHash('sha256').update(uri.href).digest('hex')}`;
  } catch { return null; }
}

function mac(secret: string, key: string, encoded: string): string {
  return createHmac('sha256', secret).update(`${VERSION}:${key}:${encoded}`).digest('hex');
}

async function readBoundedBody(response: Response, controller: AbortController): Promise<string> {
  const length = Number(response.headers.get('content-length') ?? 0);
  if (length > MAX_RESPONSE_BYTES) throw new Error('response too large');
  if (!response.body) throw new Error('empty response');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_RESPONSE_BYTES) { controller.abort(); throw new Error('response too large'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks).toString('utf8');
}

/** One bounded Redis REST request. Failure always falls back to local rendering. */
async function command(cfg: CacheConfig, args: string[]): Promise<unknown> {
  if (Date.now() < retryAfter) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(cfg.endpoint, {
      method: 'POST', headers: { Authorization: `Bearer ${cfg.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(args), cache: 'no-store', signal: controller.signal,
    });
    if (!response.ok) throw new Error('cache unavailable');
    const body: unknown = JSON.parse(await readBoundedBody(response, controller));
    if (!body || typeof body !== 'object' || !('result' in body) || ('error' in body && body.error)) throw new Error('invalid cache response');
    return body.result;
  } catch {
    // Per-instance circuit breaker avoids repeatedly adding the timeout while
    // Redis is unavailable. It does not affect orders or security controls.
    retryAfter = Date.now() + RETRY_AFTER_FAILURE_MS;
    return null;
  } finally { clearTimeout(timer); }
}

export async function cachedPublicShopQr(publicShopUrl: string): Promise<Buffer | null> {
  const cfg = config();
  const key = keyFor(publicShopUrl);
  if (!cfg || !key) return null;
  const raw = await command(cfg, ['GET', key]);
  if (typeof raw !== 'string' || raw.length > MAX_RESPONSE_BYTES) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object') return null;
    const entry = value as Record<string, unknown>;
    if (entry.v !== 1 || typeof entry.png !== 'string' || typeof entry.mac !== 'string' ||
        entry.png.length > Math.ceil(MAX_PNG_BYTES / 3) * 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(entry.png) ||
        !/^[0-9a-f]{64}$/.test(entry.mac)) return null;
    const expected = mac(cfg.secret, key, entry.png);
    if (!timingSafeEqual(Buffer.from(entry.mac, 'hex'), Buffer.from(expected, 'hex'))) return null;
    const png = Buffer.from(entry.png, 'base64');
    if (png.length > MAX_PNG_BYTES || png.length < PNG_SIGNATURE.length || !png.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE) ||
        png.toString('base64') !== entry.png) return null;
    return png;
  } catch { return null; }
}

export async function cachePublicShopQr(publicShopUrl: string, png: Buffer): Promise<void> {
  const cfg = config();
  const key = keyFor(publicShopUrl);
  if (!cfg || !key || png.length > MAX_PNG_BYTES || !png.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) return;
  const encoded = png.toString('base64');
  const entry = JSON.stringify({ v: 1, png: encoded, mac: mac(cfg.secret, key, encoded) });
  await command(cfg, ['SET', key, entry, 'EX', String(TTL_SECONDS)]);
}
