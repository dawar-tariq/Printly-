import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { portalDestination, type Portal } from '@/lib/portal-auth';
import { isAdminApi, isAdminPage, MAINTENANCE_STATUS_PATH } from '@/lib/maintenance';
import { maintenanceApiResponse, maintenancePageResponse, maintenanceStatusResponse, readMaintenanceState } from '@/lib/maintenance-server';
import { isolatedTestRequestAllowed } from '@/lib/isolated-test-environment.mjs';

// Browsers include Origin or Fetch Metadata on cross-site state-changing
// requests. Never accept a different origin, including a sibling subdomain.
// Requests without either header remain usable by non-browser API clients;
// authentication and authorization are still checked by the route itself.
function isCrossOriginMutation(req: NextRequest, path: string) {
  if (!(path === '/api' || path.startsWith('/api/')) || ['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return false;
  const site = req.headers.get('sec-fetch-site')?.toLowerCase();
  if (site === 'cross-site' || site === 'same-site') return true;
  const origin = req.headers.get('origin');
  if (!origin) return false;
  try {
    const parsed = new URL(origin);
    // Next can construct nextUrl using an internal bind address (for example
    // 0.0.0.0) rather than the public Host. Compare with the incoming Host and
    // forwarded scheme; the edge/proxy must overwrite forwarded headers.
    const host = req.headers.get('host') ?? req.nextUrl.host;
    const forwardedProto = req.headers.get('x-forwarded-proto');
    const protocol = (forwardedProto ?? req.nextUrl.protocol.slice(0, -1)).toLowerCase();
    if (!['http', 'https'].includes(protocol) || /[\s,\\/@?#]/.test(host)) return true;
    const expected = new URL(`${protocol}://${host}`);
    return expected.username !== '' || expected.password !== '' || parsed.origin !== expected.origin || origin !== parsed.origin;
  } catch { return true; }
}

export async function middleware(req: NextRequest) {
  // Fail before maintenance, Auth or any data access if the dedicated test
  // project/hostname is misconfigured or points at an unexpected backend.
  if (!isolatedTestRequestAllowed({
    PRINTLY_ISOLATED_TEST: process.env.PRINTLY_ISOLATED_TEST,
    NEXT_PUBLIC_PRINTLY_ISOLATED_TEST: process.env.NEXT_PUBLIC_PRINTLY_ISOLATED_TEST,
    NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    PRINTLY_REDIS_REST_URL: process.env.PRINTLY_REDIS_REST_URL,
    PRINTLY_REDIS_REST_TOKEN: process.env.PRINTLY_REDIS_REST_TOKEN,
    NEXT_PUBLIC_DROPBOX_APP_KEY: process.env.NEXT_PUBLIC_DROPBOX_APP_KEY,
    PRINTLY_ANDROID_APK_URL: process.env.PRINTLY_ANDROID_APK_URL,
    VERCEL_PROJECT_ID: process.env.VERCEL_PROJECT_ID,
    VERCEL_PROJECT_PRODUCTION_URL: process.env.VERCEL_PROJECT_PRODUCTION_URL,
    VERCEL_ENV: process.env.VERCEL_ENV,
  }, req.headers.get('host') ?? req.nextUrl.host)) {
    return NextResponse.json({ error: { code: 'test_environment_unavailable', message: 'The isolated test environment is not configured safely.' } }, {
      status: 503, headers: { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' },
    });
  }
  const path = req.nextUrl.pathname.replace(/\/+$/, '') || '/';
  const adminPage = isAdminPage(path);

  // Android verifies this public, non-secret association even during maintenance.
  if (path === '/.well-known/assetlinks.json') return NextResponse.next();

  // Admin sign-in, console and APIs remain available so maintenance can always
  // be turned off. Their existing authentication and authorization still apply.
  if (!adminPage && !isAdminApi(path)) {
    const maintenance = await readMaintenanceState();
    if (path === MAINTENANCE_STATUS_PATH) return maintenanceStatusResponse(maintenance);
    if (maintenance !== 'off') {
      return path === '/api' || path.startsWith('/api/')
        ? maintenanceApiResponse(maintenance)
        : maintenancePageResponse(maintenance);
    }
  }

  if (isCrossOriginMutation(req, path)) {
    return NextResponse.json({ error: { code: 'cross_origin', message: 'Cross-origin requests are not allowed.' } }, {
      status: 403, headers: { 'Cache-Control': 'no-store' },
    });
  }

  let res = NextResponse.next({ request: req });
  const isEntry = path === '/' || path === '/login' || path === '/shop/signup' || path === '/admin/login';
  const isShopPage = path === '/shop' || path.startsWith('/shop/');
  // Preserve the existing portal session checks without requiring customer or
  // API requests to be signed in after expanding the middleware matcher.
  if (!isEntry && !isShopPage && !adminPage) return res;

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return req.cookies.getAll(); },
        setAll(cookiesToSet: { name: string; value: string; options?: Record<string, unknown> }[]) {
          cookiesToSet.forEach(({ name, value }) => req.cookies.set(name, value));
          res = NextResponse.next({ request: req });
          cookiesToSet.forEach(({ name, value, options }) => res.cookies.set(name, value, options));
        },
      },
    },
  );
  // getUser validates and refreshes the session; never trust an unverified cookie alone.
  const { data: { user } } = await supabase.auth.getUser();
  const redirectWithCookies = (destination: string) => {
    const redirect = NextResponse.redirect(new URL(destination, req.url));
    res.cookies.getAll().forEach((cookie) => redirect.cookies.set(cookie));
    return redirect;
  };

  if (isEntry) {
    if (!user) return res;
    const { data: profile, error } = await supabase.from('profiles').select('role').eq('id', user.id).maybeSingle();
    if (error || !profile) return res;
    const portal: Portal = profile.role === 'admin' ? 'admin' : 'shop';
    if (path === '/admin/login' && portal !== 'admin') return res;
    // An unlinked shop account must still be able to access the application form.
    // Only redirect the public homepage for an owner/staff member of a real shop.
    if (path === '/' || path === '/shop/signup') {
      if (portal !== 'shop') return path === '/' ? res : redirectWithCookies('/admin');
      const { data: memberships, error: membershipError } = await supabase.from('shop_staff').select('shop_id').eq('user_id', user.id).limit(1);
      if (membershipError || !memberships?.length) return res;
    }
    return redirectWithCookies(portalDestination(portal, path === '/login' || path === '/admin/login' ? req.nextUrl.searchParams.get('next') : null));
  }

  if (!user) {
    const url = req.nextUrl.clone();
    url.pathname = path === '/admin' || path.startsWith('/admin/') ? '/admin/login' : '/login';
    url.search = '';
    url.searchParams.set('next', `${path}${req.nextUrl.search}`);
    return redirectWithCookies(`${url.pathname}${url.search}`);
  }
  return res;
}

// Gate public pages and APIs while leaving non-sensitive brand assets and Next's
// static files available, including on the self-contained maintenance notice.
export const config = { matcher: ['/((?!_next/static|_next/image|favicon\\.ico|icon\\.svg|apple-touch-icon\\.png|brand/).*)'] };
