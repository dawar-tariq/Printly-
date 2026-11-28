import { jsonError, jsonOk } from '@/lib/api';
import { SUPABASE_ANON, SUPABASE_URL } from '@/lib/supabase-client';

export const dynamic = 'force-dynamic';

/** The URL and anon key are public client configuration, never the service key. */
export async function GET() {
  let url: URL;
  try { url = new URL(SUPABASE_URL); }
  catch { return jsonError(503, 'config', 'The app sign-in service is unavailable.'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash || !SUPABASE_ANON) {
    return jsonError(503, 'config', 'The app sign-in service is unavailable.');
  }
  return jsonOk({ api_version: 1, supabase_url: url.origin, supabase_anon_key: SUPABASE_ANON }, {
    headers: { 'Cache-Control': 'private, no-store, max-age=0', 'X-Content-Type-Options': 'nosniff' },
  });
}
