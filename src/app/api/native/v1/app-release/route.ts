import { jsonError, jsonOk } from '@/lib/api';
import { currentNativeAppRelease } from '@/lib/native-app-update-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Public, non-secret update policy. Independent of push and shop login. */
export async function GET(): Promise<Response> {
  const release = await currentNativeAppRelease();
  const response = release ? jsonOk(release) : jsonError(503, 'unavailable', 'App update information is temporarily unavailable.');
  response.headers.set('Cache-Control', 'no-store, max-age=0');
  response.headers.set('X-Content-Type-Options', 'nosniff');
  return response;
}
