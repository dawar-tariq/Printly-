import { jsonOk } from '@/lib/api';
import { enforcePublicRateLimit } from '@/lib/rate-limit';

// This gate reduces ordinary UI traffic before a browser talks to Supabase.
// It is not an enforcement point for direct calls to Supabase Auth: configure
// provider-level rate limits and CAPTCHA independently as documented.
export async function POST(req: Request) {
  const limited = await enforcePublicRateLimit(req, 'login_attempt');
  return limited ?? jsonOk({ ok: true }, { headers: { 'Cache-Control': 'private, no-store' } });
}
