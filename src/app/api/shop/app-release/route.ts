import { getStaffContext, jsonError, jsonOk } from '@/lib/api';
import { ownerAppRelease } from '@/lib/owner-app-release';
import { currentNativeAppRelease } from '@/lib/native-app-update-server';

export const dynamic = 'force-dynamic';

function privateResponse(response: Response): Response {
  response.headers.set('Cache-Control', 'private, no-store, max-age=0');
  response.headers.set('Vary', 'Cookie');
  response.headers.set('X-Content-Type-Options', 'nosniff');
  return response;
}

/** Advertise metadata only to a verified shop member. Release signing is checked separately. */
export async function GET() {
  const staff = await getStaffContext({ allowExpired: true });
  if (!staff) return privateResponse(jsonError(401, 'sign_in', 'Sign in to see the Android app.'));
  if (staff.membershipError) return privateResponse(jsonError(503, 'unavailable', 'Shop access could not be checked. Please try again.'));
  if (staff.isAdmin || !staff.shopIds.length) return privateResponse(jsonError(403, 'no_shop', 'No shop is linked to this account.'));
  // Preserve the legacy environment release until the managed rollout is
  // explicitly enabled; after that, an unpublish must not resurrect it.
  if (process.env.PRINTLY_NATIVE_RELEASE_MANAGER_ENABLED === '1') {
    const managed = await currentNativeAppRelease();
    return privateResponse(managed ? jsonOk(managed) : jsonError(503, 'unavailable', 'App update information is temporarily unavailable.'));
  }
  return privateResponse(jsonOk(ownerAppRelease(process.env)));
}
