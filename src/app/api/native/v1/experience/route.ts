import { jsonOk } from '@/lib/api';
import { nativeExperience } from '@/lib/native-experience';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Public, non-sensitive text/timing only; the app never executes server code. */
export async function GET() {
  return jsonOk(nativeExperience(), {
    headers: { 'Cache-Control': 'no-store, max-age=0', 'X-Content-Type-Options': 'nosniff' },
  });
}
