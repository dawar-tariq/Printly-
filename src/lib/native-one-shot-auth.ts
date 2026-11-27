import { createPublicKey, verify } from 'node:crypto';

const audience = 'printly-production-token-test-810af132';

export async function authorizedOneShot(header: string | null): Promise<boolean> {
  if (!header?.startsWith('Bearer ') || header.length > 12000) return false;
  const parts = header.slice(7).split('.');
  if (parts.length !== 3) return false;
  try {
    const h = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    const c = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    const now = Math.floor(Date.now()/1000);
    if (h.alg !== 'RS256' || typeof h.kid !== 'string' || c.iss !== 'https://token.actions.githubusercontent.com' || c.aud !== audience ||
        c.repository_id !== '1464323442' || c.ref !== 'refs/heads/arena/309fdf51-printly' || c.event_name !== 'push' ||
        c.workflow_ref !== 'dawar-tariq/Printly-/.github/workflows/native-production-once.yml@refs/heads/arena/309fdf51-printly' ||
        !Number.isInteger(c.exp) || c.exp <= now || c.exp > now+600 || !Number.isInteger(c.iat) || c.iat > now+30 || c.iat < now-600) return false;
    const response = await fetch('https://token.actions.githubusercontent.com/.well-known/jwks', { signal: AbortSignal.timeout(10000), redirect:'error', cache:'no-store' });
    if (!response.ok) return false;
    const jwks: unknown = await response.json();
    if (!jwks || typeof jwks !== 'object' || !('keys' in jwks) || !Array.isArray(jwks.keys)) return false;
    const key = jwks.keys.find((item: { kid?: string; kty?: string; use?: string }) => item.kid === h.kid && item.kty === 'RSA' && item.use === 'sig');
    return !!key && verify('RSA-SHA256', Buffer.from(`${parts[0]}.${parts[1]}`), createPublicKey({key,format:'jwk'}), Buffer.from(parts[2],'base64url'));
  } catch { return false; }
}
